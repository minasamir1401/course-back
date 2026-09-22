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
exports.isContentDeletionAllowed = isContentDeletionAllowed;
exports.setContentDeletionAllowed = setContentDeletionAllowed;
const prisma_1 = __importDefault(require("../lib/prisma"));
let cachedDeletionAllowed = null;
let cacheExpiry = 0;
const CACHE_DURATION_MS = 15000;
function isContentDeletionAllowed() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const now = Date.now();
        if (cachedDeletionAllowed !== null && now < cacheExpiry) {
            return cachedDeletionAllowed;
        }
        try {
            if ((_a = prisma_1.default.systemSetting) === null || _a === void 0 ? void 0 : _a.findUnique) {
                const setting = yield prisma_1.default.systemSetting.findUnique({
                    where: { key: 'allow_content_deletion' }
                });
                cachedDeletionAllowed = setting ? setting.value === 'true' : false;
            }
            else {
                const rows = yield prisma_1.default.$queryRawUnsafe(`SELECT "value" FROM "SystemSetting" WHERE "key" = 'allow_content_deletion' LIMIT 1`);
                cachedDeletionAllowed = rows.length > 0 ? rows[0].value === 'true' : false;
            }
        }
        catch (_b) {
            cachedDeletionAllowed = false;
        }
        cacheExpiry = now + CACHE_DURATION_MS;
        return cachedDeletionAllowed;
    });
}
function setContentDeletionAllowed(allowed) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const stringValue = allowed ? 'true' : 'false';
        if ((_a = prisma_1.default.systemSetting) === null || _a === void 0 ? void 0 : _a.upsert) {
            yield prisma_1.default.systemSetting.upsert({
                where: { key: 'allow_content_deletion' },
                update: { value: stringValue },
                create: { key: 'allow_content_deletion', value: stringValue }
            });
        }
        else {
            yield prisma_1.default.$executeRawUnsafe(`INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
       VALUES ('allow_content_deletion', $1, CURRENT_TIMESTAMP)
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`, stringValue);
        }
        cachedDeletionAllowed = allowed;
        cacheExpiry = Date.now() + CACHE_DURATION_MS;
        return allowed;
    });
}
