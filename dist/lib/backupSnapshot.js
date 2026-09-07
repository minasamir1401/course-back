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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACKUPS_DIR = void 0;
exports.blockPublicBackups = blockPublicBackups;
exports.ensureBackupStorage = ensureBackupStorage;
exports.collectFullSnapshot = collectFullSnapshot;
exports.writeFullSnapshot = writeFullSnapshot;
exports.pruneFullSnapshots = pruneFullSnapshots;
exports.restoreSnapshot = restoreSnapshot;
const client_1 = require("@prisma/client");
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const models = client_1.Prisma.dmmf.datamodel.models;
const delegate = (name) => name[0].toLowerCase() + name.slice(1);
const keyFor = (name) => name === 'XPHistory' ? 'xpHistory' : delegate(name);
const transactionOptions = { isolationLevel: 'RepeatableRead', maxWait: 30000, timeout: 300000 };
exports.BACKUPS_DIR = path_1.default.resolve(process.env.BACKUPS_DIR || path_1.default.join(process.cwd(), 'private', 'backups'));
function blockPublicBackups(req, res, next) {
    let requested;
    try {
        requested = decodeURIComponent(req.path).replace(/\\/g, '/');
    }
    catch (_a) {
        res.setHeader('Cache-Control', 'no-store');
        return res.sendStatus(404);
    }
    const normalized = path_1.default.posix.normalize('/' + requested).toLowerCase();
    if (normalized.split('/').some(part => part.replace(/[. ]+$/, '') === 'backups')) {
        res.setHeader('Cache-Control', 'no-store');
        return res.sendStatus(404);
    }
    next();
}
function within(candidate, root) {
    const relative = path_1.default.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..' + path_1.default.sep) && relative !== '..' && !path_1.default.isAbsolute(relative));
}
/** Copy legacy backups once on startup, never overwrite or delete a user's original files. */
function ensureBackupStorage() {
    return __awaiter(this, arguments, void 0, function* (directory = exports.BACKUPS_DIR, uploads = path_1.default.join(process.cwd(), 'uploads')) {
        if (within(path_1.default.resolve(directory), path_1.default.resolve(uploads)))
            throw new Error('BACKUPS_DIR must be outside public uploads');
        yield promises_1.default.mkdir(directory, { recursive: true, mode: 0o700 });
        yield promises_1.default.mkdir(uploads, { recursive: true });
        if (within(yield promises_1.default.realpath(directory), yield promises_1.default.realpath(uploads)))
            throw new Error('BACKUPS_DIR resolves inside public uploads');
        const legacy = path_1.default.join(uploads, 'backups');
        let entries;
        try {
            entries = yield promises_1.default.readdir(legacy, { withFileTypes: true });
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !/\.(json|zip)$/i.test(entry.name))
                continue;
            try {
                yield promises_1.default.copyFile(path_1.default.join(legacy, entry.name), path_1.default.join(directory, entry.name), fs_1.constants.COPYFILE_EXCL);
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
            }
        }
    });
}
function visitSnapshot(db, consume) {
    return __awaiter(this, void 0, void 0, function* () {
        const counts = {};
        yield db.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            for (const model of models) {
                const key = keyFor(model.name);
                counts[key] = 0;
                let cursor;
                let first = true;
                do {
                    // Explicit filter defeats the application client's default soft-delete scope.
                    const where = model.fields.some(f => f.name === 'deletedAt') ? { deletedAt: {} } : undefined;
                    const rows = yield tx[delegate(model.name)].findMany(Object.assign(Object.assign({ take: 250, orderBy: { id: 'asc' }, where }, (cursor ? { cursor: { id: cursor }, skip: 1 } : {})), (['Course', 'Exam'].includes(model.name) ? { include: { schools: { select: { id: true } } } } : {})));
                    yield consume(key, rows, first);
                    first = false;
                    counts[key] += rows.length;
                    if (rows.length < 250)
                        break;
                    cursor = rows[rows.length - 1].id;
                } while (true);
            }
        }), transactionOptions);
        return counts;
    });
}
function collectFullSnapshot(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = {};
        const timestamp = new Date().toISOString();
        const counts = yield visitSnapshot(db, (key, rows) => __awaiter(this, void 0, void 0, function* () { (data[key] || (data[key] = [])).push(...rows); }));
        return { version: '2.0', type: 'FULL_SYSTEM', timestamp, data, counts };
    });
}
/** Publish only after all reads, transaction commit, file flush and close succeed. Memory is bounded by one page. */
function writeFullSnapshot(db, destination) {
    return __awaiter(this, void 0, void 0, function* () {
        yield promises_1.default.mkdir(path_1.default.dirname(destination), { recursive: true, mode: 0o700 });
        const temporary = destination + '.' + (0, crypto_1.randomUUID)() + '.tmp';
        const file = yield promises_1.default.open(temporary, 'wx', 0o600);
        const timestamp = new Date().toISOString();
        let current;
        let hasRows = false;
        try {
            yield file.writeFile(JSON.stringify({ version: '2.0', type: 'FULL_SYSTEM', timestamp }).slice(0, -1) + ',"data":{');
            const counts = yield visitSnapshot(db, (key, rows, first) => __awaiter(this, void 0, void 0, function* () {
                if (first) {
                    yield file.writeFile((current ? '],' : '') + JSON.stringify(key) + ':[');
                    current = key;
                    hasRows = false;
                }
                for (const row of rows) {
                    yield file.writeFile((hasRows ? ',' : '') + JSON.stringify(row));
                    hasRows = true;
                }
            }));
            yield file.writeFile(']},"counts":' + JSON.stringify(counts) + '}');
            yield file.sync();
            yield file.close();
            yield promises_1.default.rename(temporary, destination);
            return { timestamp, size: (yield promises_1.default.stat(destination)).size };
        }
        catch (error) {
            yield file.close().catch(() => { });
            yield promises_1.default.unlink(temporary).catch(() => { });
            throw error;
        }
    });
}
function pruneFullSnapshots() {
    return __awaiter(this, arguments, void 0, function* (directory = exports.BACKUPS_DIR, keep = 50) {
        if (!Number.isInteger(keep) || keep < 1)
            throw new Error('Retention must keep at least one full backup');
        const candidates = (yield promises_1.default.readdir(directory)).filter(name => /^backup-full-[\w-]+\.json$/.test(name));
        const files = yield Promise.all(candidates.map((name) => __awaiter(this, void 0, void 0, function* () { return ({ name, stat: yield promises_1.default.lstat(path_1.default.join(directory, name)) }); })));
        const ordered = files.filter(f => f.stat.isFile()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.name.localeCompare(a.name));
        for (const file of ordered.slice(keep))
            yield promises_1.default.unlink(path_1.default.join(directory, file.name));
    });
}
/** Merge by ID. Missing legacy fields stay unchanged; constraint failures abort the complete transaction. */
function restoreSnapshot(db, backup) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const data = (backup === null || backup === void 0 ? void 0 : backup.data) || backup;
        if (!data || !Array.isArray(data.course) || !Array.isArray(data.lesson))
            throw new Error('Incomplete backup: course and lesson arrays required');
        if (backup.version && !['1.0', '2.0'].includes(backup.version))
            throw new Error('Unsupported backup version');
        if (backup.version === '2.0') {
            for (const model of models) {
                const key = keyFor(model.name);
                if (!Array.isArray(data[key]))
                    throw new Error(`Incomplete backup: missing ${key}`);
                if (((_a = backup.counts) === null || _a === void 0 ? void 0 : _a[key]) !== data[key].length)
                    throw new Error(`Backup count mismatch: ${key}`);
            }
        }
        for (const model of models) {
            const rows = data[keyFor(model.name)];
            if (rows !== undefined && !Array.isArray(rows))
                throw new Error(`Invalid collection ${model.name}`);
            const ids = new Set();
            for (const row of rows || []) {
                if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id))
                    throw new Error(`Invalid or duplicate ${model.name} ID`);
                ids.add(row.id);
            }
        }
        // Only required foreign keys determine initial order. All nullable links are applied after every row exists.
        const ordered = [];
        const remaining = [...models];
        while (remaining.length) {
            const index = remaining.findIndex(model => model.fields.filter(f => { var _a; return f.kind === 'object' && f.isRequired && ((_a = f.relationFromFields) === null || _a === void 0 ? void 0 : _a.length); })
                .every(f => ordered.some(parent => parent.name === f.type)));
            if (index < 0)
                throw new Error('Unsupported required relation cycle in schema');
            ordered.push(remaining.splice(index, 1)[0]);
        }
        yield db.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            const deferred = [];
            for (const model of ordered) {
                const nullableFKs = new Set(model.fields.filter(f => f.kind === 'object' && !f.isRequired).flatMap(f => f.relationFromFields || []));
                for (const row of data[keyFor(model.name)] || []) {
                    const payload = {};
                    const links = {};
                    for (const field of model.fields.filter(f => f.kind !== 'object' && f.name !== 'id')) {
                        if (row[field.name] === undefined)
                            continue;
                        let value = row[field.name];
                        if (field.type === 'DateTime' && value !== null) {
                            value = new Date(value);
                            if (Number.isNaN(value.getTime()))
                                throw new Error(`Invalid ${model.name}.${field.name} date`);
                        }
                        if (field.type === 'Json' && value === null)
                            value = client_1.Prisma.DbNull;
                        if (nullableFKs.has(field.name))
                            links[field.name] = value;
                        else
                            payload[field.name] = value;
                    }
                    if (model.name === 'User' && !payload.password) {
                        const existing = yield tx.user.findUnique({ where: { id: row.id } });
                        if (!existing)
                            throw new Error('Incomplete legacy user: password missing; cannot recreate account');
                    }
                    yield tx[delegate(model.name)].upsert({ where: { id: row.id }, create: Object.assign({ id: row.id }, payload), update: payload });
                    if (Object.keys(links).length) {
                        if (payload.updatedAt !== undefined)
                            links.updatedAt = payload.updatedAt;
                        deferred.push({ model: delegate(model.name), id: row.id, fields: links });
                    }
                }
            }
            for (const row of deferred)
                yield tx[row.model].update({ where: { id: row.id }, data: row.fields });
            for (const model of ['course', 'exam']) {
                const links = data[model + 'ToSchool'] || (data[model] || []).filter((row) => row.schools !== undefined);
                for (const row of links) {
                    if (!Array.isArray(row.schools))
                        throw new Error(`Invalid ${model} school links`);
                    const schools = row.schools.map((school) => ({ id: typeof school === 'string' ? school : school.id }));
                    if (schools.some((school) => typeof school.id !== 'string' || !school.id))
                        throw new Error('Invalid school link');
                    yield tx[model].update({ where: { id: row.id }, data: Object.assign({ schools: backup.version === '2.0' ? { set: schools } : { connect: schools } }, (row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {})) });
                }
            }
        }), Object.assign(Object.assign({}, transactionOptions), { isolationLevel: 'Serializable' }));
    });
}
