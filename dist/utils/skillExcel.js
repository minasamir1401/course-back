"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSkillExcelRows = parseSkillExcelRows;
const TYPES = new Set(['MCQ', 'TRUE_FALSE', 'MULTI_SELECT', 'MATCHING', 'DRAG_DROP_FILL', 'GROUP_SORTING', 'CLOCK', 'MIND_MAP', 'VIDEO_CHECKPOINT', 'NUMBER_LINE', 'SWIPE_SORT', 'MAZE', 'WORD_SEARCH', 'GEOGEBRA', 'FLASH_CARD', 'MEMORY_GAME', 'WORD_SCRAMBLE', 'SENTENCE_REORDER', 'MATH_EQUATION', 'SEQUENCE_ORDER', 'CROSSWORD', 'COUNT_OBJECTS', 'IMAGE_LABEL', 'COLOR_MATCH']);
function parseSkillExcelRows(rows, lessonId) {
    if (!rows.length || rows.length > 1000)
        throw new Error('The file must contain between 1 and 1000 activities.');
    return rows.map((row, index) => {
        var _a, _b, _c;
        const fail = (message) => { throw new Error('Row ' + (index + 2) + ': ' + message); };
        const title = String((_a = row.title) !== null && _a !== void 0 ? _a : '').trim(), type = String((_b = row.type) !== null && _b !== void 0 ? _b : '').trim().toUpperCase();
        if (!title || !TYPES.has(type))
            fail('title and a supported type are required.');
        let options;
        try {
            options = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
        }
        catch (_d) {
            fail('options must contain valid JSON.');
        }
        if (!options || typeof options !== 'object')
            fail('options must be a JSON array or object.');
        const correctAnswer = String((_c = row.correctAnswer) !== null && _c !== void 0 ? _c : '').trim();
        if (!correctAnswer)
            fail('correctAnswer is required.');
        if (type === 'MCQ' || type === 'MULTI_SELECT') {
            const choices = Array.isArray(options) ? options : options.choices;
            if (!Array.isArray(choices) || choices.length < 2 || choices.length > 26)
                fail('MCQ requires 2 to 26 choices.');
            if (type === 'MCQ' && !choices.some((v) => String(v) === correctAnswer) && !choices.some((_, i) => String.fromCharCode(65 + i) === correctAnswer.toUpperCase()))
                fail('correctAnswer must match a choice or its letter.');
        }
        const number = (key, fallback, minimum, maximum) => {
            const value = row[key] === undefined || row[key] === '' ? fallback : Number(row[key]);
            if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
                fail(key + ' is outside the allowed range.');
            return value;
        };
        const difficulty = String(row.difficulty || 'Medium');
        if (!['Easy', 'Medium', 'Hard'].includes(difficulty))
            fail('difficulty must be Easy, Medium or Hard.');
        const data = { lessonId, title, type, options: JSON.stringify(options), correctAnswer, difficulty, points: number('points', 10, 0, 1000), xpPoints: number('xpPoints', 10, 0, 1000), estimatedTime: number('estimatedTime', 60, 0, 86400) };
        for (const field of ['titleEn', 'questionText', 'questionTextEn', 'hint', 'hintEn', 'tip', 'tipEn', 'explanation', 'explanationEn', 'keyInsight', 'keyInsightEn', 'standard', 'indicator', 'learningOutcome', 'skill', 'dok'])
            if (row[field] != null)
                data[field] = String(row[field]);
        for (const field of ['optionsEn', 'correctAnswerEn'])
            if (row[field] != null && row[field] !== '') {
                if (field === 'optionsEn') {
                    try {
                        JSON.parse(String(row[field]));
                    }
                    catch (_e) {
                        fail('optionsEn must contain valid JSON.');
                    }
                }
                data[field] = String(row[field]);
            }
        return data;
    });
}
