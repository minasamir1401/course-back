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
exports.autoRecoverMissingSlides = autoRecoverMissingSlides;
const prisma_1 = __importDefault(require("../lib/prisma"));
const pg_1 = require("pg");
function autoRecoverMissingSlides() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log('\n🤖 [Auto-Recover-Slides] Checking for lessons with missing slides...');
        try {
            // 1. Fetch all active lessons
            const activeLessons = yield prisma_1.default.lesson.findMany({
                where: { deletedAt: null },
                select: { id: true, title: true, slides: true, course: { select: { title: true } } }
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
                console.error('🤖 [Auto-Recover-Slides] Failed to fetch backup list:', e.message);
                yield cloudPool.end().catch(() => { });
                return;
            }
            if (backupRecords.length === 0) {
                console.warn('🤖 [Auto-Recover-Slides] No cloud backups found. Cannot recover.');
                yield cloudPool.end().catch(() => { });
                return;
            }
            console.log(`🤖 [Auto-Recover-Slides] Found ${backupRecords.length} backups to scan. Processing one by one...`);
            let recoveredCount = 0;
            const lessonsToRecover = activeLessons.map(l => {
                let currentLength = 0;
                if (Array.isArray(l.slides)) {
                    currentLength = l.slides.length;
                }
                else if (typeof l.slides === 'string') {
                    try {
                        const parsed = JSON.parse(l.slides);
                        if (Array.isArray(parsed))
                            currentLength = parsed.length;
                    }
                    catch (_a) { }
                }
                return Object.assign(Object.assign({}, l), { currentLength, bestSlides: null, maxLengthFound: currentLength, bestDate: null });
            });
            // 3. Search through backups one by one
            try {
                for (const record of backupRecords) {
                    // console.log(`   - Scanning backup from ${record.created_at}...`);
                    const dataResult = yield cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1', [record.id]);
                    if (dataResult.rows.length === 0)
                        continue;
                    const backupData = dataResult.rows[0].data;
                    const backupObj = (backupData === null || backupData === void 0 ? void 0 : backupData.data) || backupData;
                    const backupLessons = Array.isArray(backupObj === null || backupObj === void 0 ? void 0 : backupObj.lesson) ? backupObj.lesson : [];
                    for (const l of lessonsToRecover) {
                        const backupLesson = backupLessons.find(bl => bl.id === l.id);
                        if (backupLesson && backupLesson.slides) {
                            let parsedSlides = backupLesson.slides;
                            if (typeof backupLesson.slides === 'string') {
                                try {
                                    parsedSlides = JSON.parse(backupLesson.slides);
                                }
                                catch (_b) { }
                            }
                            if (Array.isArray(parsedSlides)) {
                                if (parsedSlides.length > l.maxLengthFound) {
                                    l.maxLengthFound = parsedSlides.length;
                                    l.bestSlides = parsedSlides;
                                    l.bestDate = record.created_at;
                                }
                            }
                        }
                    }
                }
            }
            finally {
                yield cloudPool.end().catch(() => { });
            }
            // 4. Restore the best found slides
            for (const l of lessonsToRecover) {
                if (l.bestSlides && l.maxLengthFound > l.currentLength) {
                    console.log(`🤖 [Auto-Recover-Slides] Restoring "${l.title}" (${(_a = l.course) === null || _a === void 0 ? void 0 : _a.title}): Current slides = ${l.currentLength}, Found = ${l.maxLengthFound} in backup from ${l.bestDate}`);
                    yield prisma_1.default.lesson.update({
                        where: { id: l.id },
                        data: { slides: l.bestSlides }
                    });
                    recoveredCount++;
                }
            }
            console.log(`🤖 [Auto-Recover-Slides] Completed! Recovered slides for ${recoveredCount} lessons.\n`);
        }
        catch (error) {
            console.error('🤖 [Auto-Recover-Slides] Error:', error.message);
        }
    });
}
