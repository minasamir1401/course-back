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
Object.defineProperty(exports, "__esModule", { value: true });
exports.archiveCloudBatch = archiveCloudBatch;
/** One checked-out connection owns the lock, reads and insert transaction; originals are always retained. */
function archiveCloudBatch(pool_1, compress_1) {
    return __awaiter(this, arguments, void 0, function* (pool, compress, options = { minimum: 50 }) {
        var _a;
        const client = yield pool.connect();
        try {
            yield client.query('BEGIN');
            const lock = yield client.query('SELECT pg_try_advisory_xact_lock(761093214) AS locked');
            if (!((_a = lock.rows[0]) === null || _a === void 0 ? void 0 : _a.locked)) {
                yield client.query('ROLLBACK');
                return null;
            }
            // Bound memory and lock duration. Manual bundles also use batches of at most 50.
            const result = yield client.query("SELECT id, name, created_at FROM cloud_backups WHERE type NOT IN ('ARCHIVE', 'REALTIME_SYNC') AND NOT EXISTS (SELECT 1 FROM cloud_backups a WHERE a.type = 'ARCHIVE' AND a.data->'sourceIds' ? cloud_backups.id::text) ORDER BY created_at ASC, id ASC" + (options.all ? "" : " LIMIT 50") + " FOR UPDATE");
            const rows = result.rows;
            if (rows.length < options.minimum) {
                yield client.query('ROLLBACK');
                return null;
            }
            const entries = [];
            for (const row of rows) {
                const record = yield client.query('SELECT data FROM cloud_backups WHERE id = $1', [row.id]);
                if (record.rows.length !== 1 || record.rows[0].data == null)
                    throw new Error(`Missing archive source ${row.id}`);
                entries.push({ id: row.id, name: row.name, data: record.rows[0].data });
            }
            if (entries.length !== rows.length)
                throw new Error('Archive source count mismatch');
            const zip = yield compress(entries);
            if (!zip.length)
                throw new Error('Empty archive');
            const archiveName = `archive-${new Date().toISOString()}-${rows.length}`;
            const archiveData = { isArchive: true, compression: 'zip', fileBase64: zip.toString('base64'), count: entries.length, sourceIds: entries.map(entry => entry.id) };
            const inserted = yield client.query('INSERT INTO cloud_backups (name, type, data) VALUES ($1, $2, $3) RETURNING id', [archiveName, 'ARCHIVE', JSON.stringify(archiveData)]);
            if (inserted.rowCount !== 1)
                throw new Error('Archive insert count mismatch');
            yield client.query('COMMIT');
            return { success: true, archiveName, count: entries.length };
        }
        catch (error) {
            yield client.query('ROLLBACK').catch(() => { });
            throw error;
        }
        finally {
            client.release();
        }
    });
}
