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
exports.persistQuestionUpdates = persistQuestionUpdates;
const client_1 = require("@prisma/client");
// Only server-owned field names can enter SQL. Values stay bound parameters.
const QUESTION_FIELDS = ['text', 'textEn', 'type', 'options', 'optionsEn', 'correctAnswer', 'points', 'xpPoints', 'skill',
    'learningOutcome', 'indicator', 'videoUrl', 'level', 'dok', 'cognitive', 'course', 'section', 'domain',
    'standard', 'subskill', 'microSkill', 'gradeTarget', 'errorPattern', 'estimatedTime', 'explanation', 'explanationEn',
    'imageUrl', 'moduleId', 'subExamId', 'order'];
function persistQuestionUpdates(tx, examId, updates) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!updates.length)
            return;
        const columns = client_1.Prisma.raw(QUESTION_FIELDS.map(field => `"${field}"`).join(', '));
        const selected = client_1.Prisma.raw(QUESTION_FIELDS.map(field => `r."${field}"`).join(', '));
        for (let offset = 0; offset < updates.length; offset += 250) {
            const batch = updates.slice(offset, offset + 250).map(update => ({ id: update.id,
                data: Object.fromEntries(QUESTION_FIELDS.filter(field => update.data[field] !== undefined).map(field => [field, update.data[field]])) }));
            yield tx.$executeRaw(client_1.Prisma.sql `
      UPDATE "Question" AS q
      SET (${columns}) = (SELECT ${selected} FROM jsonb_populate_record(q, patch.data) AS r), "updatedAt" = NOW()
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS patch(id text, data jsonb)
      WHERE q.id = patch.id AND q."examId" = ${examId} AND q."deletedAt" IS NULL
    `);
        }
    });
}
