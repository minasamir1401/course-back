import { Prisma } from '@prisma/client';
import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const models = Prisma.dmmf.datamodel.models;
const delegate = (name: string) => name[0].toLowerCase() + name.slice(1);
const keyFor = (name: string) => name === 'XPHistory' ? 'xpHistory' : delegate(name);
const transactionOptions = { isolationLevel: 'RepeatableRead', maxWait: 30000, timeout: 300000 };
export const BACKUPS_DIR = path.resolve(process.env.BACKUPS_DIR || path.join(process.cwd(), 'private', 'backups'));

export function blockPublicBackups(req: Request, res: Response, next: NextFunction) {
  let requested: string;
  try { requested = decodeURIComponent(req.path).replace(/\\/g, '/'); }
  catch { res.setHeader('Cache-Control', 'no-store'); return res.sendStatus(404); }
  const normalized = path.posix.normalize('/' + requested).toLowerCase();
  if (normalized.split('/').some(part => part.replace(/[. ]+$/, '') === 'backups')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendStatus(404);
  }
  next();
}

function within(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

/** Copy legacy backups once on startup, never overwrite or delete a user's original files. */
export async function ensureBackupStorage(directory = BACKUPS_DIR, uploads = path.join(process.cwd(), 'uploads')) {
  if (within(path.resolve(directory), path.resolve(uploads))) throw new Error('BACKUPS_DIR must be outside public uploads');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.mkdir(uploads, { recursive: true });
  if (within(await fs.realpath(directory), await fs.realpath(uploads))) throw new Error('BACKUPS_DIR resolves inside public uploads');
  const legacy = path.join(uploads, 'backups');
  let entries;
  try { entries = await fs.readdir(legacy, { withFileTypes: true }); }
  catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|zip)$/i.test(entry.name)) continue;
    try { await fs.copyFile(path.join(legacy, entry.name), path.join(directory, entry.name), constants.COPYFILE_EXCL); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
}

async function visitSnapshot(db: any, consume: (key: string, rows: any[], first: boolean) => Promise<void>) {
  const counts: Record<string, number> = {};
  await db.$transaction(async (tx: any) => {
    for (const model of models) {
      const key = keyFor(model.name);
      counts[key] = 0;
      let cursor: string | undefined;
      let first = true;
      do {
        // Explicit filter defeats the application client's default soft-delete scope.
        const where = model.fields.some(f => f.name === 'deletedAt') ? { deletedAt: {} } : undefined;
        const rows = await tx[delegate(model.name)].findMany({
          take: 250, orderBy: { id: 'asc' }, where,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          ...(['Course', 'Exam'].includes(model.name) ? { include: { schools: { select: { id: true } } } } : {})
        });
        await consume(key, rows, first);
        first = false;
        counts[key] += rows.length;
        if (rows.length < 250) break;
        cursor = rows[rows.length - 1].id;
      } while (true);
    }
  }, transactionOptions);
  return counts;
}

export async function collectFullSnapshot(db: any) {
  const data: Record<string, any[]> = {};
  const timestamp = new Date().toISOString();
  const counts = await visitSnapshot(db, async (key, rows) => { (data[key] ||= []).push(...rows); });
  return { version: '2.0', type: 'FULL_SYSTEM', timestamp, data, counts };
}

/** Publish only after all reads, transaction commit, file flush and close succeed. Memory is bounded by one page. */
export async function writeFullSnapshot(db: any, destination: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = destination + '.' + randomUUID() + '.tmp';
  const file = await fs.open(temporary, 'wx', 0o600);
  const timestamp = new Date().toISOString();
  let current: string | undefined;
  let hasRows = false;
  try {
    await file.writeFile(JSON.stringify({ version: '2.0', type: 'FULL_SYSTEM', timestamp }).slice(0, -1) + ',"data":{');
    const counts = await visitSnapshot(db, async (key, rows, first) => {
      if (first) {
        await file.writeFile((current ? '],' : '') + JSON.stringify(key) + ':[');
        current = key; hasRows = false;
      }
      for (const row of rows) {
        await file.writeFile((hasRows ? ',' : '') + JSON.stringify(row));
        hasRows = true;
      }
    });
    await file.writeFile(']},"counts":' + JSON.stringify(counts) + '}');
    await file.sync();
    await file.close();
    await fs.rename(temporary, destination);
    return { timestamp, size: (await fs.stat(destination)).size };
  } catch (error) {
    await file.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function pruneFullSnapshots(directory = BACKUPS_DIR, keep = 50) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Retention must keep at least one full backup');
  const candidates = (await fs.readdir(directory)).filter(name => /^backup-full-[\w-]+\.json$/.test(name));
  const files = await Promise.all(candidates.map(async name => ({name, stat: await fs.lstat(path.join(directory, name))})));
  const ordered = files.filter(f => f.stat.isFile()).sort((a,b) => b.stat.mtimeMs - a.stat.mtimeMs || b.name.localeCompare(a.name));
  for (const file of ordered.slice(keep)) await fs.unlink(path.join(directory, file.name));
}

/** Merge by ID. Missing legacy fields stay unchanged; constraint failures abort the complete transaction. */
export async function restoreSnapshot(db: any, backup: any) {
  const data = backup?.data || backup;
  if (!data || !Array.isArray(data.course) || !Array.isArray(data.lesson)) throw new Error('Incomplete backup: course and lesson arrays required');
  if (backup.version && !['1.0', '2.0'].includes(backup.version)) throw new Error('Unsupported backup version');
  if (backup.version === '2.0') {
    for (const model of models) {
      const key = keyFor(model.name);
      if (!Array.isArray(data[key])) throw new Error(`Incomplete backup: missing ${key}`);
      if (backup.counts?.[key] !== data[key].length) throw new Error(`Backup count mismatch: ${key}`);
    }
  }
  for (const model of models) {
    const rows = data[keyFor(model.name)];
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`Invalid collection ${model.name}`);
    const ids = new Set();
    for (const row of rows || []) {
      if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error(`Invalid or duplicate ${model.name} ID`);
      ids.add(row.id);
    }
  }
  // Only required foreign keys determine initial order. All nullable links are applied after every row exists.
  const ordered: typeof models[number][] = [];
  const remaining = [...models];
  while (remaining.length) {
    const index = remaining.findIndex(model => model.fields.filter(f => f.kind === 'object' && f.isRequired && f.relationFromFields?.length)
      .every(f => ordered.some(parent => parent.name === f.type)));
    if (index < 0) throw new Error('Unsupported required relation cycle in schema');
    ordered.push(remaining.splice(index, 1)[0]);
  }
  await db.$transaction(async (tx: any) => {
    const deferred: { model: string; id: string; fields: any }[] = [];
    for (const model of ordered) {
      const nullableFKs = new Set(model.fields.filter(f => f.kind === 'object' && !f.isRequired).flatMap(f => f.relationFromFields || []));
      for (const row of data[keyFor(model.name)] || []) {
        const payload: any = {};
        const links: any = {};
        for (const field of model.fields.filter(f => f.kind !== 'object' && f.name !== 'id')) {
          if (row[field.name] === undefined) continue;
          let value = row[field.name];
          if (field.type === 'DateTime' && value !== null) {
            value = new Date(value);
            if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${model.name}.${field.name} date`);
          }
          if (field.type === 'Json' && value === null) value = Prisma.DbNull;
          if (nullableFKs.has(field.name)) links[field.name] = value;
          else payload[field.name] = value;
        }
        if (model.name === 'User' && !payload.password) {
          const existing = await tx.user.findUnique({ where: { id: row.id } });
          if (!existing) throw new Error('Incomplete legacy user: password missing; cannot recreate account');
        }
        await tx[delegate(model.name)].upsert({ where: { id: row.id }, create: { id: row.id, ...payload }, update: payload });
        if (Object.keys(links).length) {
          if (payload.updatedAt !== undefined) links.updatedAt = payload.updatedAt;
          deferred.push({ model: delegate(model.name), id: row.id, fields: links });
        }
      }
    }
    for (const row of deferred) await tx[row.model].update({ where: { id: row.id }, data: row.fields });
    for (const model of ['course', 'exam']) {
      const links = data[model + 'ToSchool'] || (data[model] || []).filter((row: any) => row.schools !== undefined);
      for (const row of links) {
        if (!Array.isArray(row.schools)) throw new Error(`Invalid ${model} school links`);
        const schools = row.schools.map((school: any) => ({ id: typeof school === 'string' ? school : school.id }));
        if (schools.some((school: any) => typeof school.id !== 'string' || !school.id)) throw new Error('Invalid school link');
        await tx[model].update({ where: { id: row.id }, data: { schools: backup.version === '2.0' ? { set: schools } : { connect: schools }, ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}) } });
      }
    }
  }, { ...transactionOptions, isolationLevel: 'Serializable' });
}
