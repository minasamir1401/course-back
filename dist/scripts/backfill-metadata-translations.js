"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const metadataTranslationPlan_1 = require("../utils/metadataTranslationPlan");
const translation_service_1 = require("../services/translation.service");
const db = new client_1.PrismaClient();
const prepare = process.argv.includes('--prepare') || process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const outputArg = (_a = process.argv.find(arg => arg.startsWith('--output='))) === null || _a === void 0 ? void 0 : _a.slice(9);
const output = node_path_1.default.resolve(outputArg || '../artifacts/metadata-translation-plan.json');
const translations = new Map();
const translate = (text, from, to) => {
    const key = `${from}:${to}:${text}`;
    if (!translations.has(key))
        translations.set(key, (0, translation_service_1.translateSingleText)(text, from, to));
    return translations.get(key);
};
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (process.argv.includes('--apply-plan')) {
            const saved = JSON.parse(node_fs_1.default.readFileSync(output, 'utf8'));
            const models = ['question', 'lesson', 'examModule', 'interactiveActivity', 'skillLesson'];
            let applied = 0, conflicts = 0;
            for (const change of saved.plan) {
                if (!models.includes(change.model))
                    throw new Error('Invalid plan model');
                const allowed = [...bilingualMetadata_1.QUESTION_METADATA_FIELDS.flatMap(field => [field, `${field}En`]), ...bilingualMetadata_1.LESSON_METADATA_FIELDS.flatMap(field => [field, `${field}En`]), 'slides', 'questions', 'assignments', 'description'];
                if (Object.keys(change.patch).some(key => !allowed.includes(key)))
                    throw new Error('Invalid plan field');
                const result = yield db[change.model].updateMany({ where: { id: change.id, updatedAt: new Date(change.updatedAt) }, data: change.patch });
                if (result.count)
                    applied++;
                else
                    conflicts++;
            }
            console.log(JSON.stringify({ mode: 'apply-plan', applied, conflicts, output }));
            return;
        }
        const plan = [];
        const counts = {};
        for (const [model, fields] of [['question', bilingualMetadata_1.QUESTION_METADATA_FIELDS], ['lesson', bilingualMetadata_1.LESSON_METADATA_FIELDS], ['examModule', bilingualMetadata_1.LESSON_METADATA_FIELDS], ['interactiveActivity', ['standard', 'indicator', 'learningOutcome', 'skill']], ['skillLesson', []]]) {
            let cursor;
            let scanned = 0, missing = 0;
            while (true) {
                const rows = yield db[model].findMany(Object.assign({ orderBy: { id: 'asc' }, take: 100 }, (cursor ? { cursor: { id: cursor }, skip: 1 } : {})));
                if (!rows.length)
                    break;
                for (const row of rows) {
                    scanned++;
                    missing += (0, metadataTranslationPlan_1.missingMetadataTranslations)(row, fields).length;
                    if (model === 'lesson')
                        for (const key of ['slides', 'questions', 'assignments']) {
                            let content = row[key];
                            if (typeof content === 'string') {
                                try {
                                    content = JSON.parse(content);
                                }
                                catch (_b) {
                                    content = [];
                                }
                            }
                            if (Array.isArray(content))
                                for (const item of content)
                                    missing += (0, metadataTranslationPlan_1.missingMetadataTranslations)(item, bilingualMetadata_1.QUESTION_METADATA_FIELDS).length;
                        }
                    let skillMetadata = null;
                    if (model === 'skillLesson') {
                        try {
                            skillMetadata = JSON.parse(row.description || '');
                        }
                        catch ( /* A normal lesson description is not metadata. */_c) { /* A normal lesson description is not metadata. */ }
                        if (skillMetadata && typeof skillMetadata === 'object')
                            for (const field of ['standards', 'indicators', 'outcomes']) {
                                if (Array.isArray(skillMetadata[field]))
                                    missing += skillMetadata[field].filter((value) => { var _a, _b; return typeof value === 'string' && (0, metadataTranslationPlan_1.missingMetadataTranslations)({ value, valueEn: (_b = (_a = skillMetadata.translations) === null || _a === void 0 ? void 0 : _a[value]) === null || _b === void 0 ? void 0 : _b.en }, ['value']).length; }).length;
                            }
                    }
                    if (!prepare)
                        continue;
                    const patch = yield (0, metadataTranslationPlan_1.planMetadataTranslation)(row, fields, translate);
                    if (model === 'lesson')
                        for (const key of ['slides', 'questions', 'assignments']) {
                            let content = row[key];
                            const wasString = typeof content === 'string';
                            if (wasString) {
                                try {
                                    content = JSON.parse(content);
                                }
                                catch (_d) {
                                    continue;
                                }
                            }
                            if (!Array.isArray(content))
                                continue;
                            const next = [];
                            for (const item of content)
                                next.push(Object.assign(Object.assign({}, item), yield (0, metadataTranslationPlan_1.planMetadataTranslation)(item, bilingualMetadata_1.QUESTION_METADATA_FIELDS, translate)));
                            if (JSON.stringify(next) !== JSON.stringify(content))
                                patch[key] = wasString ? JSON.stringify(next) : next;
                        }
                    if (skillMetadata && typeof skillMetadata === 'object') {
                        const updated = Object.assign(Object.assign({}, skillMetadata), { translations: Object.assign({}, (skillMetadata.translations || {})) });
                        for (const field of ['standards', 'indicators', 'outcomes']) {
                            if (!Array.isArray(skillMetadata[field]))
                                continue;
                            updated[field] = [];
                            const english = [];
                            for (const value of skillMetadata[field]) {
                                if (typeof value !== 'string') {
                                    updated[field].push(value);
                                    continue;
                                }
                                const pair = ((_a = skillMetadata.translations) === null || _a === void 0 ? void 0 : _a[value]) || {};
                                const planned = yield (0, metadataTranslationPlan_1.planMetadataTranslation)({ value, valueEn: pair.en }, ['value'], translate);
                                const ar = planned.value || pair.ar || value, en = planned.valueEn || pair.en || value;
                                updated[field].push(ar);
                                english.push(en);
                                updated.translations[ar] = { ar, en };
                                updated.translations[value] = { ar, en };
                            }
                            updated[field + 'En'] = english;
                        }
                        if (JSON.stringify(updated) !== JSON.stringify(skillMetadata))
                            patch.description = JSON.stringify(updated);
                    }
                    if (Object.keys(patch).length)
                        plan.push({ model, id: row.id, updatedAt: row.updatedAt, before: Object.fromEntries(Object.keys(patch).map(key => { var _a; return [key, (_a = row[key]) !== null && _a !== void 0 ? _a : null]; })), patch });
                }
                cursor = rows.at(-1).id;
            }
            counts[model + 'Scanned'] = scanned;
            counts[model + 'MissingFields'] = missing;
            console.log(JSON.stringify({ model, scanned, missing, prepared: plan.length }));
        }
        if (prepare) {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(output), { recursive: true });
            node_fs_1.default.writeFileSync(output, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), counts, plan }, null, 2));
        }
        let applied = 0, conflicts = 0;
        if (apply)
            for (const change of plan) {
                // Optimistic concurrency prevents overwriting edits made during translation.
                const result = yield db[change.model].updateMany({ where: { id: change.id, updatedAt: change.updatedAt }, data: change.patch });
                if (result.count)
                    applied++;
                else
                    conflicts++;
            }
        console.log(JSON.stringify(Object.assign({ mode: apply ? 'apply' : prepare ? 'prepare' : 'scan', counts, changes: plan.length, applied, conflicts }, (prepare ? { output } : {}))));
    });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
