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
exports.backfillExplanationTranslations = backfillExplanationTranslations;
const prisma_1 = __importDefault(require("../lib/prisma"));
const translation_service_1 = require("../services/translation.service");
const bilingualExplanation_1 = require("../utils/bilingualExplanation");
const applyChanges = process.argv.includes('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const parsedLimit = Number((limitArg === null || limitArg === void 0 ? void 0 : limitArg.split('=')[1]) || 0);
const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
function backfillExplanationTranslations() {
    return __awaiter(this, void 0, void 0, function* () {
        const questions = yield prisma_1.default.question.findMany(Object.assign({ where: {
                deletedAt: null,
                explanation: { not: null },
                OR: [{ explanationEn: null }, { explanationEn: '' }],
            }, select: { id: true, explanation: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, (limit ? { take: limit } : {})));
        let translated = 0;
        let skipped = 0;
        for (const question of questions) {
            const explanationEn = yield (0, bilingualExplanation_1.buildEnglishExplanation)(question.explanation || '', translation_service_1.translateSingleText);
            if (!explanationEn) {
                skipped += 1;
                console.warn(`[translation-backfill] Skipped ${question.id}: translation provider returned no usable English result.`);
                continue;
            }
            translated += 1;
            if (applyChanges) {
                yield prisma_1.default.question.update({ where: { id: question.id }, data: { explanationEn } });
            }
        }
        console.log(JSON.stringify({ mode: applyChanges ? 'apply' : 'preview', scanned: questions.length, translated, skipped }));
        return { scanned: questions.length, translated, skipped, applied: applyChanges ? translated : 0 };
    });
}
if (require.main === module) {
    backfillExplanationTranslations()
        .catch((error) => {
        console.error('[translation-backfill] Failed:', error);
        process.exitCode = 1;
    })
        .finally(() => __awaiter(void 0, void 0, void 0, function* () { return prisma_1.default.$disconnect(); }));
}
