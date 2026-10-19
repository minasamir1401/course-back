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
exports.cleanDuplicatesHandler = exports.postExamHandler26 = exports.postMoveSingleQuestionHandler = exports.postExamHandler25 = exports.deleteExamHandler24 = exports.putExamHandler23 = exports.postExamHandler22 = exports.getExamHandler21 = exports.postExamHandler32 = exports.getExamHandler31 = exports.postMoveModuleHandler = exports.postMoveAllSubExamsHandler = exports.postMoveSubExamHandler = exports.deleteExamHandler30 = void 0;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const prisma_1 = __importDefault(require("../lib/prisma"));
const clean_duplicates_and_empty_1 = require("../scripts/clean-duplicates-and-empty");
const systemSettings_service_1 = require("../services/systemSettings.service");
const shared_1 = require("../shared");
const examControllerSupport_1 = require("./examControllerSupport");
const deleteExamHandler30 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id, moduleId, subExamId } = req.params;
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
            const allowed = yield (0, systemSettings_service_1.isContentDeletionAllowed)();
            if (!allowed) {
                return res.status(403).json({ error: 'حذف الاختبارات والمحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.' });
            }
        }
        const parent = yield prisma_1.default.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.question.updateMany({
                where: { examId: id, subExamId },
                data: { subExamId: null },
            });
            yield tx.subExam.delete({
                where: { id: subExamId },
            });
        }));
        res.json({ message: 'Exam deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting child exam:', error);
        res.status(500).json({ error: 'Failed to delete exam inside module' });
    }
});
exports.deleteExamHandler30 = deleteExamHandler30;
const postMoveSubExamHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId, subExamId } = req.params;
        const { targetModuleId, newModuleTitle, targetExamId } = req.body || {};
        const trimmedNewTitle = newModuleTitle ? String(newModuleTitle).trim() : '';
        if (!targetModuleId && !trimmedNewTitle) {
            return res.status(400).json({ error: 'Either targetModuleId or newModuleTitle is required.' });
        }
        const sourceModule = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true, title: true }
        });
        if (!sourceModule) {
            return res.status(404).json({ error: 'Source module not found in this exam.' });
        }
        const subExam = yield prisma_1.default.subExam.findFirst({
            where: { id: subExamId, moduleId },
            include: {
                _count: {
                    select: { questions: { where: { deletedAt: null } } }
                }
            }
        });
        if (!subExam) {
            return res.status(404).json({ error: 'Exam not found inside source module.' });
        }
        let destinationModuleId = targetModuleId ? String(targetModuleId).trim() : '';
        let destinationExamId = id;
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            if (trimmedNewTitle) {
                const destExamId = targetExamId ? String(targetExamId).trim() : id;
                destinationExamId = destExamId;
                if (destExamId !== id) {
                    const destExam = yield tx.exam.findUnique({
                        where: { id: destExamId },
                        include: { schools: { select: { id: true } } }
                    });
                    if (!destExam) {
                        throw new Error('Destination exam not found.');
                    }
                    if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, destExam))) {
                        throw new Error('Access denied: You do not have permission to add modules to destination exam.');
                    }
                }
                const lastModule = yield tx.examModule.findFirst({
                    where: { examId: destExamId },
                    orderBy: { order: 'desc' },
                    select: { order: true }
                });
                const nextOrder = ((_a = lastModule === null || lastModule === void 0 ? void 0 : lastModule.order) !== null && _a !== void 0 ? _a : -1) + 1;
                const createdModule = yield tx.examModule.create({
                    data: {
                        examId: destExamId,
                        title: (0, shared_1.sanitizeHtml)(trimmedNewTitle),
                        order: nextOrder,
                    }
                });
                destinationModuleId = createdModule.id;
            }
            else {
                const targetMod = yield tx.examModule.findUnique({
                    where: { id: destinationModuleId },
                    include: { exam: { include: { schools: { select: { id: true } } } } }
                });
                if (!targetMod) {
                    throw new Error('Destination module not found.');
                }
                if (targetMod.id === moduleId) {
                    throw new Error('Destination module cannot be the same as the current module.');
                }
                destinationExamId = targetMod.examId;
                if (destinationExamId !== id) {
                    if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, targetMod.exam))) {
                        throw new Error('Access denied: You do not have permission to move to destination exam.');
                    }
                }
            }
            const destSubExamsCount = yield tx.subExam.count({
                where: { moduleId: destinationModuleId }
            });
            const updatedSubExam = yield tx.subExam.update({
                where: { id: subExamId },
                data: {
                    moduleId: destinationModuleId,
                    order: destSubExamsCount,
                }
            });
            const updatedQuestions = yield tx.question.updateMany({
                where: {
                    examId: id,
                    subExamId: subExamId,
                },
                data: {
                    examId: destinationExamId,
                    moduleId: destinationModuleId,
                }
            });
            const destinationModule = yield tx.examModule.findUnique({
                where: { id: destinationModuleId },
                include: {
                    subExams: {
                        orderBy: { order: 'asc' }
                    }
                }
            });
            return {
                subExam: updatedSubExam,
                destinationModule,
                destinationExamId,
                movedQuestionsCount: updatedQuestions.count,
                isNewModule: Boolean(trimmedNewTitle),
                isCrossExam: destinationExamId !== id,
            };
        }));
        res.json(Object.assign({ success: true, message: 'Exam and its questions moved successfully.' }, result));
    }
    catch (error) {
        console.error('Error moving subExam to module:', error);
        res.status(400).json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to move exam to destination module.' });
    }
});
exports.postMoveSubExamHandler = postMoveSubExamHandler;
const postMoveAllSubExamsHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId } = req.params;
        const { targetModuleId, newModuleTitle, targetExamId } = req.body || {};
        const trimmedNewTitle = newModuleTitle ? String(newModuleTitle).trim() : '';
        if (!targetModuleId && !trimmedNewTitle) {
            return res.status(400).json({ error: 'Either targetModuleId or newModuleTitle is required.' });
        }
        const sourceModule = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true, title: true }
        });
        if (!sourceModule) {
            return res.status(404).json({ error: 'Source module not found in this exam.' });
        }
        const subExams = yield prisma_1.default.subExam.findMany({
            where: { moduleId },
            orderBy: { order: 'asc' },
            select: { id: true, title: true }
        });
        if (subExams.length === 0) {
            return res.status(400).json({ error: 'No sub-exams found in this module to move.' });
        }
        const subExamIds = subExams.map((s) => s.id);
        let destinationModuleId = targetModuleId ? String(targetModuleId).trim() : '';
        let destinationExamId = id;
        let targetMod = null;
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            if (trimmedNewTitle) {
                const destExamId = targetExamId ? String(targetExamId).trim() : id;
                destinationExamId = destExamId;
                if (destExamId !== id) {
                    const destExam = yield tx.exam.findUnique({
                        where: { id: destExamId },
                        include: { schools: { select: { id: true } } }
                    });
                    if (!destExam) {
                        throw new Error('Destination exam not found.');
                    }
                    if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, destExam))) {
                        throw new Error('Access denied: You do not have permission to add modules to destination exam.');
                    }
                }
                const lastModule = yield tx.examModule.findFirst({
                    where: { examId: destExamId },
                    orderBy: { order: 'desc' },
                    select: { order: true }
                });
                const nextOrder = ((_a = lastModule === null || lastModule === void 0 ? void 0 : lastModule.order) !== null && _a !== void 0 ? _a : -1) + 1;
                const createdModule = yield tx.examModule.create({
                    data: {
                        examId: destExamId,
                        title: (0, shared_1.sanitizeHtml)(trimmedNewTitle),
                        order: nextOrder,
                    }
                });
                destinationModuleId = createdModule.id;
            }
            else {
                targetMod = yield tx.examModule.findUnique({
                    where: { id: destinationModuleId },
                    include: { exam: { include: { schools: { select: { id: true } } } } }
                });
                if (!targetMod) {
                    throw new Error('Destination module not found.');
                }
                if (targetMod.id === moduleId) {
                    throw new Error('Destination module cannot be the same as the current module.');
                }
                destinationExamId = targetMod.examId;
                if (destinationExamId !== id) {
                    if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, targetMod.exam))) {
                        throw new Error('Access denied: You do not have permission to move to destination exam.');
                    }
                }
            }
            const destSubExamsCount = yield tx.subExam.count({
                where: { moduleId: destinationModuleId }
            });
            const destModule = targetMod || (yield tx.examModule.findUnique({ where: { id: destinationModuleId } }));
            const targetModSettings = Object.assign(Object.assign({ publishDate: (_b = destModule === null || destModule === void 0 ? void 0 : destModule.publishDate) !== null && _b !== void 0 ? _b : null, cutOffDate: (_c = destModule === null || destModule === void 0 ? void 0 : destModule.cutOffDate) !== null && _c !== void 0 ? _c : null }, ((destModule === null || destModule === void 0 ? void 0 : destModule.duration) !== null && (destModule === null || destModule === void 0 ? void 0 : destModule.duration) !== undefined ? { duration: destModule.duration } : {})), ((destModule === null || destModule === void 0 ? void 0 : destModule.passingScore) !== null && (destModule === null || destModule === void 0 ? void 0 : destModule.passingScore) !== undefined ? { passingScore: destModule.passingScore } : {}));
            // Update each subExam to destinationModuleId maintaining their sequential order and inheriting parent settings
            for (let i = 0; i < subExams.length; i++) {
                yield tx.subExam.update({
                    where: { id: subExams[i].id },
                    data: Object.assign({ moduleId: destinationModuleId, order: destSubExamsCount + i }, targetModSettings)
                });
            }
            // Update all questions attached to these subExams
            const updatedQuestions = yield tx.question.updateMany({
                where: {
                    examId: id,
                    subExamId: { in: subExamIds },
                },
                data: Object.assign({ examId: destinationExamId, moduleId: destinationModuleId }, ((destModule === null || destModule === void 0 ? void 0 : destModule.gradeTarget) ? { gradeTarget: destModule.gradeTarget } : {}))
            });
            // If cross-exam transfer, update exam submissions
            if (destinationExamId !== id) {
                yield tx.examSubmission.updateMany({
                    where: {
                        subExamId: { in: subExamIds }
                    },
                    data: {
                        examId: destinationExamId
                    }
                });
                const remainingModules = yield tx.examModule.count({ where: { examId: id } });
                const remainingQuestions = yield tx.question.count({ where: { examId: id, deletedAt: null } });
                if (remainingModules === 0 && remainingQuestions === 0) {
                    yield tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
                }
            }
            const destinationModule = yield tx.examModule.findUnique({
                where: { id: destinationModuleId },
                include: {
                    subExams: {
                        orderBy: { order: 'asc' }
                    }
                }
            });
            return {
                movedSubExamsCount: subExams.length,
                movedQuestionsCount: updatedQuestions.count,
                destinationModule,
                destinationExamId,
                isNewModule: Boolean(trimmedNewTitle),
                isCrossExam: destinationExamId !== id,
            };
        }));
        res.json(Object.assign({ success: true, message: 'All sub-exams and their questions moved successfully.' }, result));
    }
    catch (error) {
        console.error('Error moving all subExams to module:', error);
        res.status(400).json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to move all sub-exams to destination module.' });
    }
});
exports.postMoveAllSubExamsHandler = postMoveAllSubExamsHandler;
const postMoveModuleHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId } = req.params;
        const { targetExamId, targetParentModuleId, newParentModuleTitle } = req.body || {};
        const sourceModule = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            include: {
                subExams: true,
                questions: { where: { deletedAt: null } },
                subModules: true,
            }
        });
        if (!sourceModule) {
            return res.status(404).json({ error: 'Source module not found in this exam.' });
        }
        let destinationExamId = targetExamId ? String(targetExamId).trim() : id;
        let destinationParentModuleId = targetParentModuleId ? String(targetParentModuleId).trim() : null;
        if (destinationParentModuleId === moduleId) {
            return res.status(400).json({ error: 'Cannot move a module inside itself.' });
        }
        // Verify destination exam access if moving cross-exam
        if (destinationExamId !== id) {
            const destExam = yield prisma_1.default.exam.findUnique({
                where: { id: destinationExamId },
                include: { schools: { select: { id: true } } }
            });
            if (!destExam) {
                return res.status(404).json({ error: 'Destination exam not found.' });
            }
            if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, destExam))) {
                return res.status(403).json({ error: 'Access denied: You do not have permission to move to destination exam.' });
            }
        }
        const trimmedNewTitle = newParentModuleTitle ? String(newParentModuleTitle).trim() : '';
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            let inheritedSettings = {};
            // If user wants to create a new Main Module to receive this module
            if (trimmedNewTitle) {
                const lastMod = yield tx.examModule.findFirst({
                    where: { examId: destinationExamId, parentModuleId: null },
                    orderBy: { order: 'desc' },
                    select: { order: true }
                });
                const nextOrder = ((_a = lastMod === null || lastMod === void 0 ? void 0 : lastMod.order) !== null && _a !== void 0 ? _a : -1) + 1;
                const destExam = yield tx.exam.findUnique({ where: { id: destinationExamId } });
                const createdParent = yield tx.examModule.create({
                    data: {
                        examId: destinationExamId,
                        title: (0, shared_1.sanitizeHtml)(trimmedNewTitle),
                        order: nextOrder,
                        parentModuleId: null,
                        duration: (_b = destExam === null || destExam === void 0 ? void 0 : destExam.duration) !== null && _b !== void 0 ? _b : null,
                        passingScore: (_c = destExam === null || destExam === void 0 ? void 0 : destExam.passingScore) !== null && _c !== void 0 ? _c : null,
                        gradeTarget: (_d = destExam === null || destExam === void 0 ? void 0 : destExam.grade) !== null && _d !== void 0 ? _d : null,
                        publishDate: (_e = destExam === null || destExam === void 0 ? void 0 : destExam.startDate) !== null && _e !== void 0 ? _e : null,
                        cutOffDate: (_f = destExam === null || destExam === void 0 ? void 0 : destExam.endDate) !== null && _f !== void 0 ? _f : null,
                    }
                });
                destinationParentModuleId = createdParent.id;
                inheritedSettings = {
                    duration: createdParent.duration,
                    passingScore: createdParent.passingScore,
                    gradeTarget: createdParent.gradeTarget,
                    publishDate: createdParent.publishDate,
                    cutOffDate: createdParent.cutOffDate,
                };
            }
            else if (destinationParentModuleId) {
                // Verify target parent module exists
                const targetParent = yield tx.examModule.findUnique({
                    where: { id: destinationParentModuleId }
                });
                if (!targetParent) {
                    throw new Error('Destination parent module not found.');
                }
                // Check cycle: ensure destinationParentModuleId is not a child of sourceModule
                let checkParent = targetParent;
                while (checkParent && checkParent.parentModuleId) {
                    if (checkParent.parentModuleId === moduleId) {
                        throw new Error('Cannot move a module into one of its own sub-modules (cycle detected).');
                    }
                    checkParent = yield tx.examModule.findUnique({ where: { id: checkParent.parentModuleId } });
                }
                destinationExamId = targetParent.examId;
                inheritedSettings = {
                    duration: targetParent.duration,
                    passingScore: targetParent.passingScore,
                    gradeTarget: targetParent.gradeTarget,
                    publishDate: targetParent.publishDate,
                    cutOffDate: targetParent.cutOffDate,
                };
            }
            // Calculate next order in destination parent
            const lastSibling = yield tx.examModule.findFirst({
                where: {
                    examId: destinationExamId,
                    parentModuleId: destinationParentModuleId
                },
                orderBy: { order: 'desc' },
                select: { order: true }
            });
            const nextSiblingOrder = ((_g = lastSibling === null || lastSibling === void 0 ? void 0 : lastSibling.order) !== null && _g !== void 0 ? _g : -1) + 1;
            // Update sourceModule with destination and inherited parent settings
            const updatedModule = yield tx.examModule.update({
                where: { id: moduleId },
                data: Object.assign({ examId: destinationExamId, parentModuleId: destinationParentModuleId, order: nextSiblingOrder }, inheritedSettings)
            });
            // Collect all descendant module IDs recursively
            const collectModuleIds = (mId) => __awaiter(void 0, void 0, void 0, function* () {
                const children = yield tx.examModule.findMany({ where: { parentModuleId: mId }, select: { id: true } });
                const childIds = children.map(c => c.id);
                let allDescendants = [...childIds];
                for (const cId of childIds) {
                    allDescendants = allDescendants.concat(yield collectModuleIds(cId));
                }
                return allDescendants;
            });
            const allModuleIds = [moduleId, ...(yield collectModuleIds(moduleId))];
            // If moving as a sub-module, update all descendant modules and sub-exams to inherit parent settings
            if (destinationParentModuleId) {
                if (allModuleIds.length > 1) {
                    yield tx.examModule.updateMany({
                        where: { id: { in: allModuleIds.filter(mid => mid !== moduleId) } },
                        data: Object.assign({}, inheritedSettings)
                    });
                }
                yield tx.subExam.updateMany({
                    where: { moduleId: { in: allModuleIds } },
                    data: Object.assign(Object.assign({ publishDate: inheritedSettings.publishDate, cutOffDate: inheritedSettings.cutOffDate }, (inheritedSettings.duration !== null && inheritedSettings.duration !== undefined ? { duration: inheritedSettings.duration } : {})), (inheritedSettings.passingScore !== null && inheritedSettings.passingScore !== undefined ? { passingScore: inheritedSettings.passingScore } : {}))
                });
                if (inheritedSettings.gradeTarget) {
                    yield tx.question.updateMany({
                        where: { moduleId: { in: allModuleIds } },
                        data: { gradeTarget: inheritedSettings.gradeTarget }
                    });
                }
            }
            // If cross-exam transfer, update all nested entities
            if (destinationExamId !== id) {
                // Update all descendant modules examId
                yield tx.examModule.updateMany({
                    where: { id: { in: allModuleIds } },
                    data: { examId: destinationExamId }
                });
                // Find all subExams under these modules
                const affectedSubExams = yield tx.subExam.findMany({
                    where: { moduleId: { in: allModuleIds } },
                    select: { id: true }
                });
                const subExamIds = affectedSubExams.map(s => s.id);
                // Update questions
                yield tx.question.updateMany({
                    where: {
                        OR: [
                            { moduleId: { in: allModuleIds } },
                            { subExamId: { in: subExamIds } }
                        ]
                    },
                    data: { examId: destinationExamId }
                });
                // Update student submissions
                if (subExamIds.length > 0) {
                    yield tx.examSubmission.updateMany({
                        where: { subExamId: { in: subExamIds } },
                        data: { examId: destinationExamId }
                    });
                }
                // If source exam is now empty, clean it up so no orphaned shell card remains
                const remainingModules = yield tx.examModule.count({ where: { examId: id } });
                const remainingQuestions = yield tx.question.count({ where: { examId: id, deletedAt: null } });
                if (remainingModules === 0 && remainingQuestions === 0) {
                    yield tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
                }
            }
            return {
                module: updatedModule,
                destinationExamId,
                destinationParentModuleId,
                isCrossExam: destinationExamId !== id,
            };
        }));
        res.json(Object.assign({ success: true, message: 'Module moved successfully.' }, result));
    }
    catch (error) {
        console.error('Error moving module:', error);
        res.status(400).json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to move module.' });
    }
});
exports.postMoveModuleHandler = postMoveModuleHandler;
const getExamHandler31 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId, subExamId } = req.params;
        const parent = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true, title: true, examId: true }
        });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        const subExam = yield prisma_1.default.subExam.findFirst({
            where: { id: subExamId, moduleId },
            include: {
                questions: {
                    where: { deletedAt: null },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                }
            }
        });
        if (!subExam)
            return res.status(404).json({ error: 'Exam not found inside module' });
        const payload = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            module: {
                id: parent.id,
                title: parent.title,
            },
            exam: {
                title: subExam.title,
                password: subExam.password,
                duration: subExam.duration,
                passingScore: subExam.passingScore,
                attemptsAllowed: subExam.attemptsAllowed,
                publishDate: subExam.publishDate ? subExam.publishDate.toISOString() : null,
                cutOffDate: subExam.cutOffDate ? subExam.cutOffDate.toISOString() : null,
            },
            questions: subExam.questions.map((question) => {
                var _a, _b, _c, _d;
                return (Object.assign(Object.assign({ text: question.text, textEn: question.textEn, type: question.type, options: question.options, optionsEn: question.optionsEn, correctAnswer: question.correctAnswer, points: question.points, xpPoints: question.xpPoints }, (0, bilingualMetadata_1.metadataTranslations)(question, shared_1.sanitizeHtml)), { skill: question.skill, learningOutcome: (_b = (_a = question.learningOutcome) !== null && _a !== void 0 ? _a : question.standard) !== null && _b !== void 0 ? _b : null, indicator: question.indicator, videoUrl: question.videoUrl, level: question.level, dok: (0, examControllerSupport_1.normalizeBackendDok)(question.dok), cognitive: question.cognitive, course: question.course, section: question.section, domain: question.domain, standard: (_d = (_c = question.standard) !== null && _c !== void 0 ? _c : question.learningOutcome) !== null && _d !== void 0 ? _d : null, subskill: question.subskill, microSkill: question.microSkill, gradeTarget: question.gradeTarget, errorPattern: question.errorPattern, estimatedTime: question.estimatedTime, explanation: question.explanation, explanationEn: question.explanationEn, hint: question.hint, hintEn: question.hintEn, imageUrl: question.imageUrl, order: question.order }));
            }),
        };
        const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
        const fileName = `${String(subExam.title || 'exam').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'exam'}_backup.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    }
    catch (error) {
        console.error('Error exporting module exam JSON:', error);
        res.status(500).json({ error: 'Failed to export exam JSON' });
    }
});
exports.getExamHandler31 = getExamHandler31;
const postExamHandler32 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id, moduleId } = req.params;
        const rawPayload = (_a = req.body) === null || _a === void 0 ? void 0 : _a.exportData;
        const parsedPayload = typeof rawPayload === 'string'
            ? JSON.parse(rawPayload)
            : rawPayload;
        if (!((_b = parsedPayload === null || parsedPayload === void 0 ? void 0 : parsedPayload.exam) === null || _b === void 0 ? void 0 : _b.title)) {
            return res.status(400).json({ error: 'Invalid exam JSON payload' });
        }
        const parent = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true }
        });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        const questions = Array.isArray(parsedPayload.questions) ? parsedPayload.questions : [];
        const createdSubExam = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const created = yield tx.subExam.create({
                data: {
                    moduleId,
                    title: (0, shared_1.sanitizeHtml)(String(parsedPayload.exam.title).trim()),
                    password: parsedPayload.exam.password ? (0, shared_1.sanitizeHtml)(String(parsedPayload.exam.password).trim()) : null,
                    duration: parsedPayload.exam.duration ? parseInt(parsedPayload.exam.duration) : null,
                    passingScore: parsedPayload.exam.passingScore ? parseInt(parsedPayload.exam.passingScore) : null,
                    attemptsAllowed: parsedPayload.exam.attemptsAllowed ? parseInt(parsedPayload.exam.attemptsAllowed) || 1 : 1,
                    order: yield tx.subExam.count({ where: { moduleId } }),
                    publishDate: parsedPayload.exam.publishDate ? new Date(parsedPayload.exam.publishDate) : null,
                    cutOffDate: parsedPayload.exam.cutOffDate ? new Date(parsedPayload.exam.cutOffDate) : null,
                }
            });
            for (let index = 0; index < questions.length; index++) {
                const question = (0, shared_1.sanitizeDeep)(questions[index] || {});
                yield tx.question.create({
                    data: Object.assign(Object.assign({ examId: id, moduleId, subExamId: created.id, text: (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(question.text || '')), textEn: question.textEn ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(question.textEn)) : null, type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(question.type) ? (0, shared_1.sanitizeHtml)(question.type) : 'MCQ', options: (0, shared_1.extractAndSaveBase64Images)(typeof question.options === 'string' ? question.options : JSON.stringify(question.options || [])), optionsEn: question.optionsEn ? (0, shared_1.extractAndSaveBase64Images)(typeof question.optionsEn === 'string' ? question.optionsEn : JSON.stringify(question.optionsEn || [])) : null, correctAnswer: (0, examControllerSupport_1.formatCorrectAnswer)(question), points: parseInt(question.points) || 1, xpPoints: parseInt(question.xpPoints) || 10 }, (0, bilingualMetadata_1.metadataTranslations)(question, shared_1.sanitizeHtml)), { skill: question.skill ? (0, shared_1.sanitizeHtml)(question.skill) : null, learningOutcome: ((_a = question.learningOutcome) !== null && _a !== void 0 ? _a : question.standard) ? (0, shared_1.sanitizeHtml)((_b = question.learningOutcome) !== null && _b !== void 0 ? _b : question.standard) : null, indicator: question.indicator ? (0, shared_1.sanitizeHtml)(question.indicator) : null, videoUrl: question.videoUrl ? (0, shared_1.sanitizeHtml)(question.videoUrl) : null, level: question.level ? (0, shared_1.sanitizeHtml)(question.level) : 'Medium', dok: (0, examControllerSupport_1.normalizeBackendDok)(question.dok), cognitive: question.cognitive ? (0, shared_1.sanitizeHtml)(question.cognitive) : null, course: question.course ? (0, shared_1.sanitizeHtml)(question.course) : null, section: question.section ? (0, shared_1.sanitizeHtml)(question.section) : null, domain: question.domain ? (0, shared_1.sanitizeHtml)(question.domain) : null, standard: ((_c = question.standard) !== null && _c !== void 0 ? _c : question.learningOutcome) ? (0, shared_1.sanitizeHtml)((_d = question.standard) !== null && _d !== void 0 ? _d : question.learningOutcome) : null, subskill: question.subskill ? (0, shared_1.sanitizeHtml)(question.subskill) : null, microSkill: question.microSkill ? (0, shared_1.sanitizeHtml)(question.microSkill) : null, gradeTarget: question.gradeTarget ? (0, shared_1.sanitizeHtml)(question.gradeTarget) : null, errorPattern: question.errorPattern ? (0, shared_1.sanitizeHtml)(question.errorPattern) : null, estimatedTime: question.estimatedTime ? (0, shared_1.sanitizeHtml)(question.estimatedTime) : null, explanation: (0, examControllerSupport_1.formatExplanation)(question), explanationEn: question.explanationEn ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(question.explanationEn)) : null, hint: question.hint ? (0, shared_1.sanitizeHtml)(question.hint) : null, hintEn: question.hintEn ? (0, shared_1.sanitizeHtml)(question.hintEn) : null, imageUrl: question.imageUrl ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(question.imageUrl)) : null, order: question.order !== undefined ? parseInt(question.order) : index })
                });
            }
            return tx.subExam.findUnique({
                where: { id: created.id },
                include: {
                    _count: { select: { questions: { where: { deletedAt: null } } } },
                    questions: {
                        where: { deletedAt: null },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                    }
                }
            });
        }));
        res.status(201).json(createdSubExam);
    }
    catch (error) {
        console.error('Error importing module exam JSON:', error);
        res.status(500).json({ error: 'Failed to import exam JSON' });
    }
});
exports.postExamHandler32 = postExamHandler32;
const getExamHandler21 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { isCentral, status, grade, search, courseId, folderId } = req.query;
        const where = { deletedAt: null };
        if (folderId) {
            where.folderId = folderId;
        }
        if (req.user.role === 'SUPER_ADMIN') {
            if (isCentral === 'true')
                where.isCentral = true;
            if (isCentral === 'false') {
                where.isCentral = false;
                if (req.query.schoolId)
                    where.schoolId = req.query.schoolId;
            }
        }
        else if (req.user.role === 'SCHOOL_ADMIN') {
            where.OR = [
                { isCentral: true },
                { schoolId: req.user.schoolId }
            ];
        }
        else if (req.user.role === 'TEACHER') {
            where.OR = [
                { creatorId: req.user.id }
            ];
        }
        else if (req.user.role === 'STUDENT') {
            where.OR = [
                { isCentral: true },
                { schoolId: req.user.schoolId }
            ];
            if (grade) {
                where.grade = grade;
            }
        }
        const folders = yield prisma_1.default.examFolder.findMany({
            where,
            include: {
                exams: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(folders);
    }
    catch (error) {
        console.error('Error fetching exam folders:', error);
        res.status(500).json({ error: 'Failed to fetch exam folders' });
    }
});
exports.getExamHandler21 = getExamHandler21;
const postExamHandler22 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, description, grade, subject, isCentral, schoolId } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }
        const folder = yield prisma_1.default.examFolder.create({
            data: {
                title,
                description,
                grade,
                subject,
                isCentral: req.user.role === 'SUPER_ADMIN' ? !!isCentral : false,
                creatorId: req.user.id,
                schoolId: req.user.role === 'SCHOOL_ADMIN' ? req.user.schoolId : (isCentral ? null : schoolId)
            }
        });
        res.json(folder);
    }
    catch (error) {
        console.error('Error creating exam folder:', error);
        res.status(500).json({ error: 'Failed to create exam folder' });
    }
});
exports.postExamHandler22 = postExamHandler22;
const putExamHandler23 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, grade, subject } = req.body;
        const existingFolder = yield prisma_1.default.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
        if (!existingFolder)
            return res.status(404).json({ error: 'Exam folder not found' });
        if (req.user.role !== 'SUPER_ADMIN') {
            const isOwner = existingFolder.schoolId === req.user.schoolId ||
                existingFolder.isCentral ||
                existingFolder.creatorId === req.user.id;
            if (!isOwner)
                return res.status(403).json({ error: 'Access denied: You do not have permission to edit this folder.' });
        }
        const folder = yield prisma_1.default.examFolder.update({
            where: { id },
            data: { title, description, grade, subject }
        });
        res.json(folder);
    }
    catch (error) {
        console.error('Error updating exam folder:', error);
        res.status(500).json({ error: 'Failed to update exam folder' });
    }
});
exports.putExamHandler23 = putExamHandler23;
const deleteExamHandler24 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existingFolder = yield prisma_1.default.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
        if (!existingFolder)
            return res.status(404).json({ error: 'Exam folder not found' });
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied: Only Super Admin can delete exam folders.' });
        }
        yield prisma_1.default.examFolder.update({
            where: { id },
            data: { deletedAt: new Date() }
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting exam folder:', error);
        res.status(500).json({ error: 'Failed to delete exam folder' });
    }
});
exports.deleteExamHandler24 = deleteExamHandler24;
const postExamHandler25 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { targetExamId, targetModuleId, targetSubExamId } = req.body;
        if (!targetExamId) {
            return res.status(400).json({ error: 'targetExamId is required' });
        }
        // 1. Get source exam
        const sourceExam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { schools: { select: { id: true } } }
        });
        if (!sourceExam) {
            return res.status(404).json({ error: 'Source exam not found' });
        }
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, sourceExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move questions from this exam.' });
        }
        // 2. Get target exam
        const targetExam = yield prisma_1.default.exam.findUnique({
            where: { id: targetExamId },
            include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
        });
        if (!targetExam) {
            return res.status(404).json({ error: 'Target exam not found' });
        }
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, targetExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
        }
        const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            let finalModuleId = targetModuleId;
            // If no specific module is provided, create a new one
            if (!finalModuleId) {
                // 3. Create a new module in target exam using source exam title
                const newModule = yield tx.examModule.create({
                    data: {
                        examId: targetExam.id,
                        title: sourceExam.title,
                        order: newOrder,
                        description: sourceExam.description
                    }
                });
                finalModuleId = newModule.id;
            }
            // 4. Move all STANDALONE questions to the module/subexam in the target exam
            yield tx.question.updateMany({
                where: {
                    examId: id,
                    moduleId: null
                },
                data: Object.assign({ examId: targetExam.id, moduleId: finalModuleId }, (targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {}))
            });
        }));
        res.json({ message: 'Standalone questions moved successfully' });
    }
    catch (error) {
        console.error('Error moving standalone questions:', error);
        res.status(500).json({ error: 'Failed to move standalone questions' });
    }
});
exports.postExamHandler25 = postExamHandler25;
const postMoveSingleQuestionHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, questionId } = req.params;
        const { targetExamId, targetModuleId, targetSubExamId } = req.body;
        if (!targetExamId) {
            return res.status(400).json({ error: 'targetExamId is required' });
        }
        const sourceExam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { schools: { select: { id: true } } }
        });
        if (!sourceExam) {
            return res.status(404).json({ error: 'Source exam not found' });
        }
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, sourceExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move questions from this exam.' });
        }
        const question = yield prisma_1.default.question.findFirst({
            where: { id: questionId, examId: id, deletedAt: null }
        });
        if (!question) {
            return res.status(404).json({ error: 'Question not found in source exam' });
        }
        const targetExam = yield prisma_1.default.exam.findUnique({
            where: { id: targetExamId },
            include: { schools: { select: { id: true } } }
        });
        if (!targetExam) {
            return res.status(404).json({ error: 'Target exam not found' });
        }
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, targetExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
        }
        let finalModuleId = targetModuleId || null;
        let finalSubExamId = targetSubExamId || null;
        if (finalModuleId) {
            const moduleExists = yield prisma_1.default.examModule.findFirst({
                where: { id: finalModuleId, examId: targetExamId }
            });
            if (!moduleExists) {
                return res.status(400).json({ error: 'Target module not found in target exam' });
            }
        }
        if (finalSubExamId) {
            const subExamExists = yield prisma_1.default.subExam.findFirst({
                where: Object.assign({ id: finalSubExamId }, (finalModuleId ? { moduleId: finalModuleId } : { module: { examId: targetExamId } }))
            });
            if (!subExamExists) {
                return res.status(400).json({ error: 'Target sub-exam not found in target exam or module' });
            }
            if (!finalModuleId) {
                finalModuleId = subExamExists.moduleId;
            }
        }
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const lastQuestion = yield tx.question.findFirst({
                where: {
                    examId: targetExamId,
                    moduleId: finalModuleId,
                    subExamId: finalSubExamId,
                    deletedAt: null
                },
                orderBy: { order: 'desc' },
                select: { order: true }
            });
            const newOrder = ((_a = lastQuestion === null || lastQuestion === void 0 ? void 0 : lastQuestion.order) !== null && _a !== void 0 ? _a : -1) + 1;
            return tx.question.update({
                where: { id: questionId },
                data: {
                    examId: targetExamId,
                    moduleId: finalModuleId,
                    subExamId: finalSubExamId,
                    order: newOrder
                }
            });
        }));
        res.json({
            success: true,
            message: 'Question moved successfully',
            question: result
        });
    }
    catch (error) {
        console.error('Error moving single question:', error);
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to move question' });
    }
});
exports.postMoveSingleQuestionHandler = postMoveSingleQuestionHandler;
const postExamHandler26 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { targetExamId, targetModuleId, targetSubExamId } = req.body;
        if (!targetExamId) {
            return res.status(400).json({ error: 'targetExamId is required' });
        }
        // 1. Get source exam
        const sourceExam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { questions: { where: { deletedAt: null } }, schools: { select: { id: true } } }
        });
        if (!sourceExam) {
            return res.status(404).json({ error: 'Source exam not found' });
        }
        // Ownership check on SOURCE exam — prevent stealing/deleting another school's exam
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, sourceExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move this exam.' });
        }
        // 2. Get target exam
        const targetExam = yield prisma_1.default.exam.findUnique({
            where: { id: targetExamId },
            include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
        });
        if (!targetExam) {
            return res.status(404).json({ error: 'Target exam not found' });
        }
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, targetExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
        }
        const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            let finalModuleId = targetModuleId;
            // If no specific module is provided, create a new one
            if (!finalModuleId) {
                // 3. Create a new module in target exam
                const newModule = yield tx.examModule.create({
                    data: {
                        examId: targetExam.id,
                        title: sourceExam.title,
                        order: newOrder,
                        description: sourceExam.description
                    }
                });
                finalModuleId = newModule.id;
            }
            // 4. Move all questions to the module/subexam in the target exam
            yield tx.question.updateMany({
                where: { examId: id },
                data: Object.assign({ examId: targetExam.id, moduleId: finalModuleId }, (targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {}))
            });
            // 5. Soft Delete the old exam
            yield tx.exam.update({
                where: { id },
                data: { deletedAt: new Date() }
            });
        }));
        res.json({ success: true, message: 'Exam content successfully moved to module.' });
    }
    catch (error) {
        console.error('Error moving exam to module:', error);
        res.status(500).json({ error: 'Failed to move exam to module' });
    }
});
exports.postExamHandler26 = postExamHandler26;
const cleanDuplicatesHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const userRole = (_a = req.user) === null || _a === void 0 ? void 0 : _a.role;
        let examId = undefined;
        if (req.params.id) {
            if (((_b = req.body) === null || _b === void 0 ? void 0 : _b.examId) && String(req.body.examId) !== String(req.params.id)) {
                return res.status(400).json({ error: 'Mismatched exam ID between path and body parameters.' });
            }
            examId = String(req.params.id);
        }
        else if (userRole === 'SUPER_ADMIN') {
            examId = ((_c = req.body) === null || _c === void 0 ? void 0 : _c.examId) ? String(req.body.examId) : undefined;
        }
        else {
            return res.status(403).json({ error: 'Exam ID path parameter is required.' });
        }
        const result = yield (0, clean_duplicates_and_empty_1.runSafeDeduplicationAndEmptyCleanup)(examId);
        return res.json(Object.assign({ success: true, message: `تم تنظيف ${result.duplicatesDeleted} سؤال مكرر و ${result.emptyQuestionsDeleted} سؤال فارغ بنجاح!` }, result));
    }
    catch (err) {
        console.error('cleanDuplicatesHandler error:', err);
        return res.status(500).json({ error: err.message || 'Failed to clean duplicates' });
    }
});
exports.cleanDuplicatesHandler = cleanDuplicatesHandler;
