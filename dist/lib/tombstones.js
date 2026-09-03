"use strict";
/**
 * ============================================================
 * 🔒 TOMBSTONES — Persistent Deletion Markers
 * ============================================================
 * Stores explicit user-deletion markers in PostgreSQL so that
 * the auto-recovery script (recover-deleted-lessons.ts) never
 * re-creates items that were intentionally deleted — even after
 * a Dokploy container redeploy (which would wipe local files).
 *
 * Falls back to a local JSON file ONLY if the DB is unreachable,
 * so startup is never blocked by a tombstone lookup failure.
 * ============================================================
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.recordDeletedLesson = recordDeletedLesson;
exports.recordDeletedCourse = recordDeletedCourse;
exports.isLessonDeleted = isLessonDeleted;
exports.isCourseDeleted = isCourseDeleted;
exports.unmarkLessonDeleted = unmarkLessonDeleted;
exports.unmarkCourseDeleted = unmarkCourseDeleted;
const client_1 = require("@prisma/client");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Re-use existing Prisma singleton when imported from the server context,
// but create a short-lived client when used from the standalone recovery script.
let _prisma = null;
function getPrisma() {
    if (!_prisma)
        _prisma = new client_1.PrismaClient();
    return _prisma;
}
// ── Local-file fallback (used only when DB is unreachable) ─────────────────
const FALLBACK_FILE = path.join(process.cwd(), 'uploads', 'deleted_tombstones.json');
function loadFallback() {
    try {
        if (fs.existsSync(FALLBACK_FILE)) {
            const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
            const p = JSON.parse(raw);
            return { lessons: p.lessons || {}, courses: p.courses || {} };
        }
    }
    catch ( /* ignore */_a) { /* ignore */ }
    return { lessons: {}, courses: {} };
}
function saveFallback(store) {
    try {
        fs.writeFileSync(FALLBACK_FILE, JSON.stringify(store, null, 2), 'utf-8');
    }
    catch ( /* ignore */_a) { /* ignore */ }
}
// ── DB helpers ─────────────────────────────────────────────────────────────
function dbMarkDeleted(type, id, title) {
    return __awaiter(this, void 0, void 0, function* () {
        yield getPrisma().deletedTombstone.upsert({
            where: { entityType_entityId: { entityType: type, entityId: id } },
            create: { entityType: type, entityId: id, entityTitle: title },
            update: { entityTitle: title, deletedAt: new Date() },
        });
    });
}
function dbIsDeleted(type, id) {
    return __awaiter(this, void 0, void 0, function* () {
        const row = yield getPrisma().deletedTombstone.findUnique({
            where: { entityType_entityId: { entityType: type, entityId: id } },
            select: { id: true },
        });
        return !!row;
    });
}
function dbUnmark(type, id) {
    return __awaiter(this, void 0, void 0, function* () {
        yield getPrisma().deletedTombstone.deleteMany({
            where: { entityType: type, entityId: id },
        });
    });
}
// ── Public API ─────────────────────────────────────────────────────────────
/** Record that a lesson was explicitly deleted by the user. */
function recordDeletedLesson(id, title) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield dbMarkDeleted('lesson', id, title);
            console.log(`🔒 [Tombstone] Marked lesson "${title || id}" as EXPLICITLY DELETED (DB).`);
        }
        catch (err) {
            console.warn(`⚠️ [Tombstone] DB unavailable, using fallback file: ${err.message}`);
            const store = loadFallback();
            store.lessons[id] = { deletedAt: new Date().toISOString(), title };
            saveFallback(store);
        }
    });
}
/** Record that a course was explicitly deleted by the user. */
function recordDeletedCourse(id, title) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield dbMarkDeleted('course', id, title);
            console.log(`🔒 [Tombstone] Marked course "${title || id}" as EXPLICITLY DELETED (DB).`);
        }
        catch (err) {
            console.warn(`⚠️ [Tombstone] DB unavailable, using fallback file: ${err.message}`);
            const store = loadFallback();
            store.courses[id] = { deletedAt: new Date().toISOString(), title };
            saveFallback(store);
        }
    });
}
/** Check if a lesson was explicitly deleted by the user. */
function isLessonDeleted(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield dbIsDeleted('lesson', id);
        }
        catch (err) {
            console.warn(`⚠️ [Tombstone] DB unavailable, checking fallback: ${err.message}`);
            return !!loadFallback().lessons[id];
        }
    });
}
/** Check if a course was explicitly deleted by the user. */
function isCourseDeleted(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield dbIsDeleted('course', id);
        }
        catch (err) {
            console.warn(`⚠️ [Tombstone] DB unavailable, checking fallback: ${err.message}`);
            return !!loadFallback().courses[id];
        }
    });
}
/** Remove lesson from tombstones (e.g. when user explicitly restores it). */
function unmarkLessonDeleted(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield dbUnmark('lesson', id);
            console.log(`🔓 [Tombstone] Unmarked lesson ${id} from deleted list.`);
        }
        catch (err) {
            console.warn(`⚠️ [Tombstone] DB unavailable for unmark: ${err.message}`);
            const store = loadFallback();
            delete store.lessons[id];
            saveFallback(store);
        }
    });
}
/** Remove course from tombstones (e.g. when user explicitly restores it). */
function unmarkCourseDeleted(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield dbUnmark('course', id);
            console.log(`🔓 [Tombstone] Unmarked course ${id} from deleted list.`);
        }
        catch (err) {
            console.warn(`⚠️ [Tombstone] DB unavailable for unmark: ${err.message}`);
            const store = loadFallback();
            delete store.courses[id];
            saveFallback(store);
        }
    });
}
