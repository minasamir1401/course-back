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
exports.autoRecoverMissingLessonData = autoRecoverMissingLessonData;
const prisma_1 = __importDefault(require("../lib/prisma"));
const pg_1 = require("pg");
function autoRecoverMissingLessonData() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('\n🤖 [Auto-Recover-Lesson-Data] Checking for lessons with missing questions, assignments, or attachments...');
        try {
            // 1. Fetch all active lessons
            const activeLessons = yield prisma_1.default.lesson.findMany({
                where: { deletedAt: null },
                select: { id: true, title: true, questions: true, assignments: true, attachments: true, course: { select: { title: true } } }
            });
            // 2. Fetch recent cloud backups IDs (up to 100)
            const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
            const cloudPool = new pg_1.Pool({ connectionString: BACKUP_DB_URL, max: 1, connectionTimeoutMillis: 8000 });
            let backupRecords = [];
            try {
                const result = yield cloudPool.query('SELECT id, created_at FROM cloud_backups ORDER BY created_at DESC LIMIT 100');
                backupRecords = result.rows;
            }
            catch (e) {
                console.error('🤖 [Auto-Recover] Failed to fetch backup list:', e.message);
                yield cloudPool.end().catch(() => { });
                return;
            }
            if (backupRecords.length === 0) {
                console.warn('🤖 [Auto-Recover] No cloud backups found. Cannot recover.');
                yield cloudPool.end().catch(() => { });
                return;
            }
            console.log(`🤖 [Auto-Recover] Found ${backupRecords.length} backups to scan. Processing one by one...`);
            let recoveredCount = 0;
            const parseLength = (val) => {
                if (Array.isArray(val))
                    return val.length;
                if (typeof val === 'string') {
                    try {
                        const p = JSON.parse(val);
                        if (Array.isArray(p))
                            return p.length;
                    }
                    catch (_a) { }
                }
                return 0;
            };
            const parseVal = (val) => {
                if (typeof val === 'string') {
                    try {
                        return JSON.parse(val);
                    }
                    catch (_a) {
                        return val;
                    }
                }
                return val;
            };
            const lessonsToRecover = activeLessons.map(l => (Object.assign(Object.assign({}, l), { currentQ: parseLength(l.questions), currentA: parseLength(l.assignments), currentAtt: parseLength(l.attachments), bestQ: null, maxQ: parseLength(l.questions), bestDateQ: null, bestA: null, maxA: parseLength(l.assignments), bestDateA: null, bestAtt: null, maxAtt: parseLength(l.attachments), bestDateAtt: null })));
            // 3. Search through backups one by one
            try {
                for (const record of backupRecords) {
                    const dataResult = yield cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1', [record.id]);
                    if (dataResult.rows.length === 0)
                        continue;
                    const backupData = dataResult.rows[0].data;
                    const backupObj = (backupData === null || backupData === void 0 ? void 0 : backupData.data) || backupData;
                    const backupLessons = Array.isArray(backupObj === null || backupObj === void 0 ? void 0 : backupObj.lesson) ? backupObj.lesson : [];
                    for (const l of lessonsToRecover) {
                        const bl = backupLessons.find(bl => bl.id === l.id);
                        if (!bl)
                            continue;
                        // Check questions
                        if (bl.questions) {
                            const parsed = parseVal(bl.questions);
                            if (Array.isArray(parsed) && parsed.length > l.maxQ) {
                                l.maxQ = parsed.length;
                                l.bestQ = parsed;
                                l.bestDateQ = record.created_at;
                            }
                        }
                        // Check assignments
                        if (bl.assignments) {
                            const parsed = parseVal(bl.assignments);
                            if (Array.isArray(parsed) && parsed.length > l.maxA) {
                                l.maxA = parsed.length;
                                l.bestA = parsed;
                                l.bestDateA = record.created_at;
                            }
                        }
                        // Check attachments
                        if (bl.attachments) {
                            const parsed = parseVal(bl.attachments);
                            if (Array.isArray(parsed) && parsed.length > l.maxAtt) {
                                l.maxAtt = parsed.length;
                                l.bestAtt = parsed;
                                l.bestDateAtt = record.created_at;
                            }
                        }
                    }
                }
            }
            finally {
                yield cloudPool.end().catch(() => { });
            }
            // 4. Restore the best found data
            for (const l of lessonsToRecover) {
                const updateData = {};
                let willUpdate = false;
                if (l.bestQ && l.maxQ > l.currentQ) {
                    updateData.questions = l.bestQ;
                    willUpdate = true;
                    console.log(`🤖 [Auto-Recover] Restoring Q for "${l.title}": ${l.currentQ} -> ${l.maxQ} from ${l.bestDateQ}`);
                }
                if (l.bestA && l.maxA > l.currentA) {
                    updateData.assignments = l.bestA;
                    willUpdate = true;
                    console.log(`🤖 [Auto-Recover] Restoring A for "${l.title}": ${l.currentA} -> ${l.maxA} from ${l.bestDateA}`);
                }
                if (l.bestAtt && l.maxAtt > l.currentAtt) {
                    updateData.attachments = l.bestAtt;
                    willUpdate = true;
                    console.log(`🤖 [Auto-Recover] Restoring Att for "${l.title}": ${l.currentAtt} -> ${l.maxAtt} from ${l.bestDateAtt}`);
                }
                if (willUpdate) {
                    yield prisma_1.default.lesson.update({
                        where: { id: l.id },
                        data: updateData
                    });
                    recoveredCount++;
                }
            }
            console.log(`🤖 [Auto-Recover] Completed! Recovered data for ${recoveredCount} lessons.\n`);
        }
        catch (error) {
            console.error('🤖 [Auto-Recover] Error:', error.message);
        }
    });
}
// ─── ENTRY POINT GUARD ───────────────────────────────────────────────────────
// This script must NEVER run automatically on server startup or when imported.
// Run manually ONLY when intentionally recovering data:
//   npx tsx src/scripts/recover-lesson-data.ts
//
// ⚠️  IMPORTANT: Before running, compare current DB state with the backup.
//     "More records in backup" does NOT mean the backup is more correct.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    autoRecoverMissingLessonData().then(() => process.exit(0));
}
