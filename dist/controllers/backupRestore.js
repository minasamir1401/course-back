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
exports.restoreExamWithHierarchy = restoreExamWithHierarchy;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
function restoreExamWithHierarchy(tx, e, backupData, targetCourseId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36;
        const toDate = (v) => (v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null);
        const resolvedCourseId = targetCourseId !== undefined ? targetCourseId : ((_a = e.courseId) !== null && _a !== void 0 ? _a : null);
        const ePayload = {
            title: (_b = e.title) !== null && _b !== void 0 ? _b : 'Untitled',
            description: (_c = e.description) !== null && _c !== void 0 ? _c : null,
            type: (_d = e.type) !== null && _d !== void 0 ? _d : 'Quiz',
            duration: typeof e.duration === 'number' ? e.duration : (parseInt(e.duration, 10) || 30),
            passingScore: typeof e.passingScore === 'number' ? e.passingScore : (parseInt(e.passingScore, 10) || 50),
            isCentral: (_e = e.isCentral) !== null && _e !== void 0 ? _e : false,
            showAnswers: e.showAnswers !== false,
            resultVisibility: (_f = e.resultVisibility) !== null && _f !== void 0 ? _f : 'SHOW_SCORE',
            password: (_g = e.password) !== null && _g !== void 0 ? _g : null,
            startDate: toDate(e.startDate),
            endDate: toDate(e.endDate),
            attemptsAllowed: typeof e.attemptsAllowed === 'number' ? e.attemptsAllowed : (parseInt(e.attemptsAllowed, 10) || 1),
            status: (_h = e.status) !== null && _h !== void 0 ? _h : 'PUBLISHED',
            category: (_j = e.category) !== null && _j !== void 0 ? _j : null,
            grade: (_k = e.grade) !== null && _k !== void 0 ? _k : null,
            grades: (_l = e.grades) !== null && _l !== void 0 ? _l : null,
            subjects: (_m = e.subjects) !== null && _m !== void 0 ? _m : null,
            schoolId: (_o = e.schoolId) !== null && _o !== void 0 ? _o : null,
            courseId: resolvedCourseId,
            folderId: (_p = e.folderId) !== null && _p !== void 0 ? _p : null,
            courseName: (_q = e.courseName) !== null && _q !== void 0 ? _q : null,
            section: (_r = e.section) !== null && _r !== void 0 ? _r : null,
            domain: (_s = e.domain) !== null && _s !== void 0 ? _s : null,
            learningOutcomes: (_t = e.learningOutcomes) !== null && _t !== void 0 ? _t : null,
            indicators: (_u = e.indicators) !== null && _u !== void 0 ? _u : null,
            skills: (_v = e.skills) !== null && _v !== void 0 ? _v : null,
            skill: (_w = e.skill) !== null && _w !== void 0 ? _w : null,
            gradeTarget: (_x = e.gradeTarget) !== null && _x !== void 0 ? _x : null,
            level: (_y = e.level) !== null && _y !== void 0 ? _y : 'Medium',
            creatorId: (_z = e.creatorId) !== null && _z !== void 0 ? _z : null,
            deletedAt: null,
            createdAt: (_0 = toDate(e.createdAt)) !== null && _0 !== void 0 ? _0 : new Date(),
            updatedAt: (_1 = toDate(e.updatedAt)) !== null && _1 !== void 0 ? _1 : new Date()
        };
        yield tx.exam.upsert({
            where: { id: e.id },
            update: ePayload,
            create: Object.assign({ id: e.id }, ePayload)
        });
        // 1. Gather all ExamModules
        const backupModules = Array.isArray(backupData.examModule) ? backupData.examModule : [];
        const embeddedModules = Array.isArray(e.modules) ? e.modules : [];
        const allModulesMap = new Map();
        for (const m of backupModules) {
            if ((m === null || m === void 0 ? void 0 : m.examId) === e.id)
                allModulesMap.set(m.id, m);
        }
        for (const m of embeddedModules) {
            if (m === null || m === void 0 ? void 0 : m.id)
                allModulesMap.set(m.id, Object.assign(Object.assign({}, m), { examId: e.id }));
            if (Array.isArray(m.subModules)) {
                for (const sm of m.subModules) {
                    if (sm === null || sm === void 0 ? void 0 : sm.id)
                        allModulesMap.set(sm.id, Object.assign(Object.assign({}, sm), { examId: e.id, parentModuleId: m.id }));
                }
            }
        }
        const modulesList = Array.from(allModulesMap.values());
        const parentModules = modulesList.filter((m) => !m.parentModuleId);
        const childModules = modulesList.filter((m) => !!m.parentModuleId);
        for (const m of parentModules) {
            const mPayload = Object.assign(Object.assign({ examId: e.id, parentModuleId: null, title: m.title || 'Untitled Module', description: (_2 = m.description) !== null && _2 !== void 0 ? _2 : null, order: typeof m.order === 'number' ? m.order : 0, duration: m.duration !== undefined && m.duration !== null ? Number(m.duration) : null, passingScore: m.passingScore !== undefined && m.passingScore !== null ? Number(m.passingScore) : null }, (0, bilingualMetadata_1.moduleMetadata)(m)), { gradeTarget: (_3 = m.gradeTarget) !== null && _3 !== void 0 ? _3 : null, publishDate: toDate(m.publishDate), cutOffDate: toDate(m.cutOffDate), createdAt: (_4 = toDate(m.createdAt)) !== null && _4 !== void 0 ? _4 : new Date(), updatedAt: (_5 = toDate(m.updatedAt)) !== null && _5 !== void 0 ? _5 : new Date() });
            yield tx.examModule.upsert({
                where: { id: m.id },
                update: mPayload,
                create: Object.assign({ id: m.id }, mPayload)
            });
        }
        for (const m of childModules) {
            const mPayload = Object.assign(Object.assign({ examId: e.id, parentModuleId: m.parentModuleId, title: m.title || 'Untitled Submodule', description: (_6 = m.description) !== null && _6 !== void 0 ? _6 : null, order: typeof m.order === 'number' ? m.order : 0, duration: m.duration !== undefined && m.duration !== null ? Number(m.duration) : null, passingScore: m.passingScore !== undefined && m.passingScore !== null ? Number(m.passingScore) : null }, (0, bilingualMetadata_1.moduleMetadata)(m)), { gradeTarget: (_7 = m.gradeTarget) !== null && _7 !== void 0 ? _7 : null, publishDate: toDate(m.publishDate), cutOffDate: toDate(m.cutOffDate), createdAt: (_8 = toDate(m.createdAt)) !== null && _8 !== void 0 ? _8 : new Date(), updatedAt: (_9 = toDate(m.updatedAt)) !== null && _9 !== void 0 ? _9 : new Date() });
            yield tx.examModule.upsert({
                where: { id: m.id },
                update: mPayload,
                create: Object.assign({ id: m.id }, mPayload)
            });
        }
        // 2. Gather and restore SubExams
        const backupSubExams = Array.isArray(backupData.subExam) ? backupData.subExam : [];
        const allSubExamsMap = new Map();
        for (const se of backupSubExams) {
            if (allModulesMap.has(se.moduleId))
                allSubExamsMap.set(se.id, se);
        }
        for (const m of modulesList) {
            if (Array.isArray(m.subExams)) {
                for (const se of m.subExams) {
                    if (se === null || se === void 0 ? void 0 : se.id)
                        allSubExamsMap.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                }
            }
        }
        for (const se of allSubExamsMap.values()) {
            const sePayload = {
                moduleId: se.moduleId,
                title: se.title || 'Untitled SubExam',
                password: (_10 = se.password) !== null && _10 !== void 0 ? _10 : null,
                duration: se.duration !== undefined && se.duration !== null ? Number(se.duration) : null,
                passingScore: se.passingScore !== undefined && se.passingScore !== null ? Number(se.passingScore) : null,
                attemptsAllowed: typeof se.attemptsAllowed === 'number' ? se.attemptsAllowed : 1,
                order: typeof se.order === 'number' ? se.order : 0,
                publishDate: toDate(se.publishDate),
                cutOffDate: toDate(se.cutOffDate),
                createdAt: (_11 = toDate(se.createdAt)) !== null && _11 !== void 0 ? _11 : new Date(),
                updatedAt: (_12 = toDate(se.updatedAt)) !== null && _12 !== void 0 ? _12 : new Date()
            };
            yield tx.subExam.upsert({
                where: { id: se.id },
                update: sePayload,
                create: Object.assign({ id: se.id }, sePayload)
            });
        }
        // 3. Gather and restore Questions (with bilingual fields)
        const backupQuestions = Array.isArray(backupData.question) ? backupData.question : [];
        const embeddedQuestions = Array.isArray(e.questions) ? e.questions : [];
        const allQuestionsMap = new Map();
        for (const q of backupQuestions) {
            if ((q === null || q === void 0 ? void 0 : q.examId) === e.id)
                allQuestionsMap.set(q.id, q);
        }
        for (const q of embeddedQuestions) {
            if (q === null || q === void 0 ? void 0 : q.id)
                allQuestionsMap.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id }));
        }
        for (const m of modulesList) {
            if (Array.isArray(m.questions)) {
                for (const q of m.questions) {
                    if (q === null || q === void 0 ? void 0 : q.id)
                        allQuestionsMap.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id, moduleId: m.id }));
                }
            }
        }
        for (const se of allSubExamsMap.values()) {
            if (Array.isArray(se.questions)) {
                for (const q of se.questions) {
                    if (q === null || q === void 0 ? void 0 : q.id)
                        allQuestionsMap.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id, subExamId: se.id, moduleId: se.moduleId }));
                }
            }
        }
        for (const q of allQuestionsMap.values()) {
            const optionsStr = typeof q.options === 'string'
                ? q.options
                : JSON.stringify(Array.isArray(q.options) ? q.options : []);
            const optionsEnStr = q.optionsEn
                ? (typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(Array.isArray(q.optionsEn) ? q.optionsEn : []))
                : null;
            const correctAnswerStr = Array.isArray(q.correctAnswer)
                ? JSON.stringify(q.correctAnswer)
                : String((_13 = q.correctAnswer) !== null && _13 !== void 0 ? _13 : '');
            const qPayload = Object.assign(Object.assign({ examId: e.id, text: (_15 = (_14 = q.text) !== null && _14 !== void 0 ? _14 : q.content) !== null && _15 !== void 0 ? _15 : '', textEn: (_16 = q.textEn) !== null && _16 !== void 0 ? _16 : null, type: q.type || q.questionType || 'MCQ', options: optionsStr, optionsEn: optionsEnStr, correctAnswer: correctAnswerStr, points: Number(q.points) || 1, xpPoints: Number(q.xpPoints) || 10 }, (0, bilingualMetadata_1.metadataTranslations)(q)), { skill: (_17 = q.skill) !== null && _17 !== void 0 ? _17 : null, learningOutcome: (_18 = q.learningOutcome) !== null && _18 !== void 0 ? _18 : null, indicator: (_19 = q.indicator) !== null && _19 !== void 0 ? _19 : null, videoUrl: (_20 = q.videoUrl) !== null && _20 !== void 0 ? _20 : null, level: (_21 = q.level) !== null && _21 !== void 0 ? _21 : 'Medium', dok: (_22 = q.dok) !== null && _22 !== void 0 ? _22 : null, cognitive: (_23 = q.cognitive) !== null && _23 !== void 0 ? _23 : null, course: (_24 = q.course) !== null && _24 !== void 0 ? _24 : null, section: (_25 = q.section) !== null && _25 !== void 0 ? _25 : null, domain: (_26 = q.domain) !== null && _26 !== void 0 ? _26 : null, standard: (_27 = q.standard) !== null && _27 !== void 0 ? _27 : null, subskill: (_28 = q.subskill) !== null && _28 !== void 0 ? _28 : null, microSkill: (_29 = q.microSkill) !== null && _29 !== void 0 ? _29 : null, gradeTarget: (_30 = q.gradeTarget) !== null && _30 !== void 0 ? _30 : null, errorPattern: (_31 = q.errorPattern) !== null && _31 !== void 0 ? _31 : null, estimatedTime: q.estimatedTime ? String(q.estimatedTime) : null, explanation: (_32 = q.explanation) !== null && _32 !== void 0 ? _32 : null, explanationEn: (_33 = q.explanationEn) !== null && _33 !== void 0 ? _33 : null, imageUrl: (_34 = q.imageUrl) !== null && _34 !== void 0 ? _34 : null, order: Number(q.order) || 0, deletedAt: null, moduleId: (q.moduleId && allModulesMap.has(q.moduleId)) ? q.moduleId : null, subExamId: (q.subExamId && allSubExamsMap.has(q.subExamId)) ? q.subExamId : null, createdAt: (_35 = toDate(q.createdAt)) !== null && _35 !== void 0 ? _35 : new Date(), updatedAt: (_36 = toDate(q.updatedAt)) !== null && _36 !== void 0 ? _36 : new Date() });
            yield tx.question.upsert({
                where: { id: q.id },
                update: qPayload,
                create: Object.assign({ id: q.id }, qPayload)
            });
        }
    });
}
