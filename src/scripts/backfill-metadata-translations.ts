import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { QUESTION_METADATA_FIELDS, LESSON_METADATA_FIELDS } from '../utils/bilingualMetadata';
import { missingMetadataTranslations, planMetadataTranslation, TranslateMetadata } from '../utils/metadataTranslationPlan';
import { translateSingleText } from '../services/translation.service';

const db = new PrismaClient();
const prepare = process.argv.includes('--prepare') || process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const output = path.resolve(outputArg || '../artifacts/metadata-translation-plan.json');
const translations = new Map<string, Promise<string>>();
const translate: TranslateMetadata = (text, from, to) => {
  const key = `${from}:${to}:${text}`;
  if (!translations.has(key)) translations.set(key, translateSingleText(text, from, to));
  return translations.get(key)!;
};
type Change = { model: string; id: string; updatedAt: Date; before: Record<string, any>; patch: Record<string, any> };
async function main() {
  if (process.argv.includes('--apply-plan')) {
    const saved = JSON.parse(fs.readFileSync(output, 'utf8'));
    const models = ['question', 'lesson', 'examModule', 'interactiveActivity', 'skillLesson'];
    let applied = 0, conflicts = 0;
    for (const change of saved.plan as Change[]) {
      if (!models.includes(change.model)) throw new Error('Invalid plan model');
      const allowed = [...QUESTION_METADATA_FIELDS.flatMap(field => [field, `${field}En`]), ...LESSON_METADATA_FIELDS.flatMap(field => [field, `${field}En`]), 'slides', 'questions', 'assignments', 'description'];
      if (Object.keys(change.patch).some(key => !allowed.includes(key))) throw new Error('Invalid plan field');
      const result = await (db as any)[change.model].updateMany({ where: { id: change.id, updatedAt: new Date(change.updatedAt) }, data: change.patch });
      if (result.count) applied++; else conflicts++;
    }
    console.log(JSON.stringify({ mode: 'apply-plan', applied, conflicts, output }));
    return;
  }
  const plan: Change[] = [];
  const counts: Record<string, number> = {};
  for (const [model, fields] of [['question', QUESTION_METADATA_FIELDS], ['lesson', LESSON_METADATA_FIELDS], ['examModule', LESSON_METADATA_FIELDS], ['interactiveActivity', ['standard', 'indicator', 'learningOutcome', 'skill']], ['skillLesson', []]] as const) {
    let cursor: string | undefined;
    let scanned = 0, missing = 0;
    while (true) {
      const rows: any[] = await (db as any)[model].findMany({ orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) break;
      for (const row of rows) {
        scanned++;
        missing += missingMetadataTranslations(row, fields).length;
        if (model === 'lesson') for (const key of ['slides', 'questions', 'assignments']) {
          let content = row[key];
          if (typeof content === 'string') { try { content = JSON.parse(content); } catch { content = []; } }
          if (Array.isArray(content)) for (const item of content) missing += missingMetadataTranslations(item, QUESTION_METADATA_FIELDS).length;
        }
        let skillMetadata: any = null;
        if (model === 'skillLesson') {
          try { skillMetadata = JSON.parse(row.description || ''); } catch { /* A normal lesson description is not metadata. */ }
          if (skillMetadata && typeof skillMetadata === 'object') for (const field of ['standards', 'indicators', 'outcomes']) {
            if (Array.isArray(skillMetadata[field])) missing += skillMetadata[field].filter((value: any) => typeof value === 'string' && missingMetadataTranslations({ value, valueEn: skillMetadata.translations?.[value]?.en }, ['value']).length).length;
          }
        }
        if (!prepare) continue;
        const patch: Record<string, any> = await planMetadataTranslation(row, fields, translate);
        if (model === 'lesson') for (const key of ['slides', 'questions', 'assignments']) {
          let content = row[key]; const wasString = typeof content === 'string';
          if (wasString) { try { content = JSON.parse(content); } catch { continue; } }
          if (!Array.isArray(content)) continue;
          const next = [];
          for (const item of content) next.push({ ...item, ...await planMetadataTranslation(item, QUESTION_METADATA_FIELDS, translate) });
          if (JSON.stringify(next) !== JSON.stringify(content)) patch[key] = wasString ? JSON.stringify(next) : next;
        }
        if (skillMetadata && typeof skillMetadata === 'object') {
          const updated = { ...skillMetadata, translations: { ...(skillMetadata.translations || {}) } };
          for (const field of ['standards', 'indicators', 'outcomes']) {
            if (!Array.isArray(skillMetadata[field])) continue;
            updated[field] = []; const english: string[] = [];
            for (const value of skillMetadata[field]) {
              if (typeof value !== 'string') { updated[field].push(value); continue; }
              const pair = skillMetadata.translations?.[value] || {};
              const planned = await planMetadataTranslation({ value, valueEn: pair.en }, ['value'], translate);
              const ar = planned.value || pair.ar || value, en = planned.valueEn || pair.en || value;
              updated[field].push(ar); english.push(en);
              updated.translations[ar] = { ar, en };
              updated.translations[value] = { ar, en };
            }
            updated[field + 'En'] = english;
          }
          if (JSON.stringify(updated) !== JSON.stringify(skillMetadata)) patch.description = JSON.stringify(updated);
        }
        if (Object.keys(patch).length) plan.push({ model, id: row.id, updatedAt: row.updatedAt, before: Object.fromEntries(Object.keys(patch).map(key => [key, row[key] ?? null])), patch });
      }
      cursor = rows.at(-1).id;
    }
    counts[model + 'Scanned'] = scanned; counts[model + 'MissingFields'] = missing;
    console.log(JSON.stringify({ model, scanned, missing, prepared: plan.length }));
  }
  if (prepare) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), counts, plan }, null, 2));
  }
  let applied = 0, conflicts = 0;
  if (apply) for (const change of plan) {
    // Optimistic concurrency prevents overwriting edits made during translation.
    const result = await (db as any)[change.model].updateMany({ where: { id: change.id, updatedAt: change.updatedAt }, data: change.patch });
    if (result.count) applied++; else conflicts++;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : prepare ? 'prepare' : 'scan', counts, changes: plan.length, applied, conflicts, ...(prepare ? { output } : {}) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
