"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTrashItemHandler = exports.postTrashBulkDeleteHandler = exports.deleteCourseHandler25 = exports.postCourseHandler24 = exports.getCourseHandler23 = exports.deleteCourseHandler22 = exports.deleteCourseHandler21 = exports.patchCourseHandler20 = exports.patchCourseHandler19 = exports.patchCourseHandler18 = exports.patchCourseHandler17 = exports.getCourseHandler16 = exports.postCourseHandler15 = exports.postCourseHandler14 = exports.postCourseHandler13 = void 0;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const prisma_1 = __importDefault(require("../lib/prisma"));
const systemSettings_service_1 = require("../services/systemSettings.service");
const contentDeletionPolicy_1 = require("../utils/contentDeletionPolicy");
const shared_1 = require("../shared");
const trashDeleteHelper_1 = require("../services/trashDeleteHelper");
const postCourseHandler13 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { targetCourseId } = req.body;
        if (!targetCourseId)
            return res.status(400).json({ error: "Target course ID is required" });
        const sourceLesson = yield prisma_1.default.lesson.findUnique({
            where: { id: req.params.id },
        });
        if (!sourceLesson)
            return res.status(404).json({ error: "Source lesson not found" });
        const targetCourse = yield prisma_1.default.course.findUnique({
            where: { id: targetCourseId },
            select: { id: true, _count: { select: { lessons: true } } },
        });
        if (!targetCourse)
            return res.status(404).json({ error: "Target course not found" });
        const newLesson = yield prisma_1.default.lesson.create({
            data: Object.assign(Object.assign({ courseId: targetCourseId, title: sourceLesson.title + " (نسخة)", domain: sourceLesson.domain }, (0, bilingualMetadata_1.metadataTranslations)(sourceLesson, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { content: sourceLesson.content, videoUrl: sourceLesson.videoUrl, duration: sourceLesson.duration, summary: sourceLesson.summary, notes: sourceLesson.notes, questions: (_a = sourceLesson.questions) !== null && _a !== void 0 ? _a : undefined, attachments: (_b = sourceLesson.attachments) !== null && _b !== void 0 ? _b : undefined, slides: (_c = sourceLesson.slides) !== null && _c !== void 0 ? _c : undefined, assignments: (_d = sourceLesson.assignments) !== null && _d !== void 0 ? _d : undefined, standards: sourceLesson.standards, indicators: sourceLesson.indicators, learningOutcomes: sourceLesson.learningOutcomes, isCentral: sourceLesson.isCentral, isVisible: sourceLesson.isVisible, order: (targetCourse._count.lessons || 0) + 1 }),
        });
        res.json({ message: "Lesson copied successfully", lesson: newLesson });
    }
    catch (error) {
        console.error("Error copying lesson:", error);
        res
            .status(500)
            .json({ error: "Failed to copy lesson", details: error.message });
    }
});
exports.postCourseHandler13 = postCourseHandler13;
const postCourseHandler14 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { targetLessonId, sections } = req.body;
        if (!targetLessonId)
            return res.status(400).json({ error: "Target lesson ID is required" });
        if (!sections)
            return res.status(400).json({ error: "Sections object is required" });
        const sourceLesson = yield prisma_1.default.lesson.findUnique({
            where: { id: req.params.id },
        });
        if (!sourceLesson)
            return res.status(404).json({ error: "Source lesson not found" });
        const targetLesson = yield prisma_1.default.lesson.findUnique({
            where: { id: targetLessonId },
        });
        if (!targetLesson)
            return res.status(404).json({ error: "Target lesson not found" });
        const updateData = {};
        if (sections.metadata) {
            updateData.summary = sourceLesson.summary;
            updateData.notes = sourceLesson.notes;
            Object.assign(updateData, (0, bilingualMetadata_1.metadataTranslations)(sourceLesson, String, bilingualMetadata_1.LESSON_METADATA_FIELDS));
            updateData.standards = sourceLesson.standards;
            updateData.indicators = sourceLesson.indicators;
            updateData.learningOutcomes = sourceLesson.learningOutcomes;
        }
        if (sections.scheduling) {
            updateData.isVisible = sourceLesson.isVisible;
            updateData.isCentral = sourceLesson.isCentral;
        }
        const processItems = (itemType, indices) => {
            if (indices && indices.length > 0) {
                let sourceItems = [];
                try {
                    sourceItems =
                        (typeof sourceLesson[itemType] === "string"
                            ? JSON.parse(sourceLesson[itemType])
                            : sourceLesson[itemType]) || [];
                }
                catch (e) { }
                let targetItems = [];
                try {
                    targetItems =
                        (typeof targetLesson[itemType] === "string"
                            ? JSON.parse(targetLesson[itemType])
                            : targetLesson[itemType]) || [];
                }
                catch (e) { }
                const itemsToCopy = indices
                    .map((idx) => sourceItems[idx])
                    .filter(Boolean)
                    .map((item) => (Object.assign(Object.assign({}, item), { id: Date.now() + Math.random() })));
                updateData[itemType] = [...targetItems, ...itemsToCopy];
            }
        };
        processItems("slides", sections.slideIndices);
        processItems("assignments", sections.assignmentIndices);
        processItems("questions", sections.questionIndices);
        if (Object.keys(updateData).length > 0) {
            const updatedLesson = yield prisma_1.default.lesson.update({
                where: { id: targetLessonId },
                data: updateData,
            });
            res.json({
                message: "Data exported successfully",
                lesson: updatedLesson,
            });
        }
        else {
            res.json({ message: "No data to export", lesson: targetLesson });
        }
    }
    catch (error) {
        console.error("Error exporting lesson data:", error);
        res
            .status(500)
            .json({
            error: "Failed to export lesson data",
            details: error.message,
        });
    }
});
exports.postCourseHandler14 = postCourseHandler14;
const postCourseHandler15 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { targetLessonId, slideIndices, itemType = "slides" } = req.body;
        if (!targetLessonId)
            return res.status(400).json({ error: "Target lesson ID is required" });
        if (!["slides", "questions", "assignments"].includes(itemType))
            return res.status(400).json({ error: "Invalid itemType" });
        const sourceLesson = yield prisma_1.default.lesson.findUnique({
            where: { id: req.params.id },
        });
        if (!sourceLesson)
            return res.status(404).json({ error: "Source lesson not found" });
        const targetLesson = yield prisma_1.default.lesson.findUnique({
            where: { id: targetLessonId },
        });
        if (!targetLesson)
            return res.status(404).json({ error: "Target lesson not found" });
        let sourceItems = [];
        try {
            sourceItems =
                (typeof sourceLesson[itemType] === "string"
                    ? JSON.parse(sourceLesson[itemType])
                    : sourceLesson[itemType]) || [];
        }
        catch (e) { }
        let targetItems = [];
        try {
            targetItems =
                (typeof targetLesson[itemType] === "string"
                    ? JSON.parse(targetLesson[itemType])
                    : targetLesson[itemType]) || [];
        }
        catch (e) { }
        const itemsToCopy = Array.isArray(slideIndices) && slideIndices.length > 0
            ? slideIndices.map((i) => sourceItems[i]).filter(Boolean)
            : sourceItems;
        if (itemsToCopy.length === 0) {
            return res.status(400).json({ error: "No items found to copy" });
        }
        const processedItems = itemsToCopy.map((s) => {
            const newItem = JSON.parse(JSON.stringify(s));
            newItem.id = Date.now() + Math.random(); // standard id pattern for questions/assignments
            if (itemType === "slides")
                newItem.blockId = `blk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            return newItem;
        });
        const updatedTargetItems = [...targetItems, ...processedItems];
        yield prisma_1.default.lesson.update({
            where: { id: targetLessonId },
            data: { [itemType]: updatedTargetItems },
        });
        res.json({
            message: "Items copied successfully",
            copiedCount: processedItems.length,
        });
    }
    catch (error) {
        console.error("Error copying slides:", error);
        res
            .status(500)
            .json({ error: "Failed to copy slides", details: error.message });
    }
});
exports.postCourseHandler15 = postCourseHandler15;
const getCourseHandler16 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id: req.params.id },
            select: { id: true, title: true, slides: true, courseId: true },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
        let slidesArray = [];
        try {
            slidesArray =
                (typeof lesson.slides === "string"
                    ? JSON.parse(lesson.slides)
                    : lesson.slides) || [];
        }
        catch (e) {
            slidesArray = [];
        }
        res.json({
            id: lesson.id,
            title: lesson.title,
            courseId: lesson.courseId,
            slides: slidesArray,
            count: Array.isArray(slidesArray) ? slidesArray.length : 0,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({
            error: "Failed to read lesson slides",
            details: error.message,
        });
    }
});
exports.getCourseHandler16 = getCourseHandler16;
const patchCourseHandler17 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { slides } = req.body;
        if (!slides)
            return res.status(400).json({ error: "slides field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true, slides: true, course: { select: { schoolId: true } } },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
        if (req.user.role !== "SUPER_ADMIN") {
            if (!((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.schoolId) || lesson.course.schoolId !== req.user.schoolId) {
                return res.status(403).json({ error: "Access denied: content belongs to another school." });
            }
            if (req.user.role === "TEACHER" && !(yield prisma_1.default.teacherCourse.findFirst({
                where: { teacherId: req.user.id, courseId: lesson.courseId }, select: { id: true },
            })))
                return res.status(403).json({ error: "You are not assigned to this course." });
            if ((0, contentDeletionPolicy_1.removesSavedContent)(lesson.slides, slides) && !(yield (0, systemSettings_service_1.isContentDeletionAllowed)())) {
                return res.status(403).json({ error: "Content deletion is disabled by Super Admin. حذف المحتوى معطّل من الإدارة العامة." });
            }
        }
        const sanitizedSlides = (0, shared_1.sanitizeDeep)(slides);
        const updated = yield prisma_1.default.lesson.update({
            where: { id },
            data: { slides: sanitizedSlides },
            select: { id: true, title: true, slides: true },
        });
        let slidesArray = [];
        try {
            slidesArray =
                (typeof updated.slides === "string"
                    ? JSON.parse(updated.slides)
                    : updated.slides) || [];
        }
        catch (e) { }
        res.json({
            id: updated.id,
            title: updated.title,
            slides: slidesArray,
            count: Array.isArray(slidesArray) ? slidesArray.length : 0,
            message: "Slides updated successfully",
        });
    }
    catch (error) {
        console.error("Error updating lesson slides:", error);
        res
            .status(500)
            .json({
            error: "Failed to update lesson slides",
            details: error.message,
        });
    }
});
exports.patchCourseHandler17 = patchCourseHandler17;
const patchCourseHandler18 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { questions } = req.body;
        if (questions === undefined)
            return res.status(400).json({ error: "questions field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true, questions: true, course: { select: { schoolId: true } } },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
        if (req.user.role !== "SUPER_ADMIN") {
            if (!((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.schoolId) || lesson.course.schoolId !== req.user.schoolId) {
                return res.status(403).json({ error: "Access denied: content belongs to another school." });
            }
            if (req.user.role === "TEACHER" && !(yield prisma_1.default.teacherCourse.findFirst({
                where: { teacherId: req.user.id, courseId: lesson.courseId }, select: { id: true },
            })))
                return res.status(403).json({ error: "You are not assigned to this course." });
            if ((0, contentDeletionPolicy_1.removesSavedContent)(lesson.questions, questions) && !(yield (0, systemSettings_service_1.isContentDeletionAllowed)())) {
                return res.status(403).json({ error: "Content deletion is disabled by Super Admin. حذف المحتوى معطّل من الإدارة العامة." });
            }
        }
        const sanitizedQuestions = (0, shared_1.sanitizeDeep)(questions);
        const updated = yield prisma_1.default.lesson.update({
            where: { id },
            data: { questions: sanitizedQuestions },
            select: { id: true, title: true, questions: true },
        });
        let qArray = [];
        try {
            qArray =
                (typeof updated.questions === "string"
                    ? JSON.parse(updated.questions)
                    : updated.questions) || [];
        }
        catch (e) { }
        res.json({
            id: updated.id,
            title: updated.title,
            questions: qArray,
            count: Array.isArray(qArray) ? qArray.length : 0,
            message: "Questions updated successfully",
        });
    }
    catch (error) {
        console.error("Error updating lesson questions:", error);
        res
            .status(500)
            .json({
            error: "Failed to update lesson questions",
            details: error.message,
        });
    }
});
exports.patchCourseHandler18 = patchCourseHandler18;
const patchCourseHandler19 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { assignments } = req.body;
        if (assignments === undefined)
            return res.status(400).json({ error: "assignments field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true, assignments: true, course: { select: { schoolId: true } } },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
        if (req.user.role !== "SUPER_ADMIN") {
            if (!((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.schoolId) || lesson.course.schoolId !== req.user.schoolId) {
                return res.status(403).json({ error: "Access denied: content belongs to another school." });
            }
            if (req.user.role === "TEACHER" && !(yield prisma_1.default.teacherCourse.findFirst({
                where: { teacherId: req.user.id, courseId: lesson.courseId }, select: { id: true },
            })))
                return res.status(403).json({ error: "You are not assigned to this course." });
            if ((0, contentDeletionPolicy_1.removesSavedContent)(lesson.assignments, assignments) && !(yield (0, systemSettings_service_1.isContentDeletionAllowed)())) {
                return res.status(403).json({ error: "Content deletion is disabled by Super Admin. حذف المحتوى معطّل من الإدارة العامة." });
            }
        }
        const sanitizedAssignments = (0, shared_1.sanitizeDeep)(assignments);
        const updated = yield prisma_1.default.lesson.update({
            where: { id },
            data: { assignments: sanitizedAssignments },
            select: { id: true, title: true, assignments: true },
        });
        let aArray = [];
        try {
            aArray =
                (typeof updated.assignments === "string"
                    ? JSON.parse(updated.assignments)
                    : updated.assignments) || [];
        }
        catch (e) { }
        res.json({
            id: updated.id,
            title: updated.title,
            assignments: aArray,
            count: Array.isArray(aArray) ? aArray.length : 0,
            message: "Assignments updated successfully",
        });
    }
    catch (error) {
        console.error("Error updating lesson assignments:", error);
        res
            .status(500)
            .json({
            error: "Failed to update lesson assignments",
            details: error.message,
        });
    }
});
exports.patchCourseHandler19 = patchCourseHandler19;
const patchCourseHandler20 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { attachments } = req.body;
        if (attachments === undefined)
            return res.status(400).json({ error: "attachments field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
        const sanitizedAttachments = (0, shared_1.sanitizeDeep)(attachments);
        const updated = yield prisma_1.default.lesson.update({
            where: { id },
            data: { attachments: sanitizedAttachments },
            select: { id: true, title: true, attachments: true },
        });
        let attArray = [];
        try {
            attArray =
                (typeof updated.attachments === "string"
                    ? JSON.parse(updated.attachments)
                    : updated.attachments) || [];
        }
        catch (e) { }
        res.json({
            id: updated.id,
            title: updated.title,
            attachments: attArray,
            count: Array.isArray(attArray) ? attArray.length : 0,
            message: "Attachments updated successfully",
        });
    }
    catch (error) {
        console.error("Error updating lesson attachments:", error);
        res
            .status(500)
            .json({
            error: "Failed to update lesson attachments",
            details: error.message,
        });
    }
});
exports.patchCourseHandler20 = patchCourseHandler20;
const deleteCourseHandler21 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { id } = req.params;
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                courseId: true,
                course: { select: { schoolId: true } },
            },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
        if (req.user.role !== "SUPER_ADMIN") {
            const allowed = yield (0, systemSettings_service_1.isContentDeletionAllowed)();
            if (!allowed) {
                return res.status(403).json({
                    error: "حذف المحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.",
                });
            }
        }
        if (req.user.role === "SCHOOL_ADMIN") {
            if (!((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.schoolId) || lesson.course.schoolId !== req.user.schoolId) {
                return res.status(403).json({
                    error: "Access denied: You can only delete lessons belonging to your school.",
                });
            }
        }
        if (req.user.role === "TEACHER") {
            if (!lesson.courseId || !((_b = lesson.course) === null || _b === void 0 ? void 0 : _b.schoolId) || lesson.course.schoolId !== req.user.schoolId) {
                return res.status(403).json({
                    error: "Access denied: You can only delete lessons belonging to your school.",
                });
            }
            const teacherCourse = yield prisma_1.default.teacherCourse.findFirst({
                where: { teacherId: req.user.id, courseId: lesson.courseId },
                select: { id: true },
            });
            if (!teacherCourse) {
                return res.status(403).json({
                    error: "Access denied: You are not assigned to this course.",
                });
            }
        }
        // Soft Delete: move to trash instead of hard delete to preserve student data
        yield prisma_1.default.lesson.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        // We no longer need tombstones for soft-deleted items, but keeping it for legacy support
        const { recordDeletedLesson } = yield Promise.resolve().then(() => __importStar(require("../lib/tombstones")));
        yield recordDeletedLesson(id, lesson.title);
        console.log(`[Lesson Delete] User ${(_c = req.user) === null || _c === void 0 ? void 0 : _c.id} (${(_d = req.user) === null || _d === void 0 ? void 0 : _d.role}) manually deleted lesson "${lesson.title}" (${id}) from course ${lesson.courseId}`);
        // Sync course to cloud after manual deletion
        if (lesson.courseId) {
            const { syncCourseToCloud } = yield Promise.resolve().then(() => __importStar(require("../lib/db-backup")));
            syncCourseToCloud(lesson.courseId).catch(() => { });
        }
        res.json({
            message: "Lesson deleted successfully",
            lessonId: id,
            lessonTitle: lesson.title,
        });
    }
    catch (error) {
        console.error("Error deleting lesson:", error);
        res
            .status(500)
            .json({ error: "Error deleting lesson", details: error.message });
    }
});
exports.deleteCourseHandler21 = deleteCourseHandler21;
const deleteCourseHandler22 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Authorization check
        const existingCourse = yield prisma_1.default.course.findUnique({ where: { id } });
        if (!existingCourse) {
            if (req.user.role !== "SUPER_ADMIN")
                return res.status(404).json({ error: "Course not found" });
            // It's already deleted locally but still lingering in the Cloud Backup!
            // Force a full cloud sync to overwrite the cloud and clear the ghost course
            const { syncAllCoursesToCloud } = yield Promise.resolve().then(() => __importStar(require("../lib/db-backup")));
            yield syncAllCoursesToCloud("Ghost Course Cleanup");
            return res.json({
                message: "Ghost course cleared from cloud cache successfully",
            });
        }
        if (req.user.role !== "SUPER_ADMIN") {
            const allowed = yield (0, systemSettings_service_1.isContentDeletionAllowed)();
            if (!allowed) {
                return res.status(403).json({
                    error: "حذف المحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.",
                });
            }
        }
        if (req.user.role !== "SUPER_ADMIN" &&
            (!existingCourse.schoolId || existingCourse.schoolId !== req.user.schoolId)) {
            return res
                .status(403)
                .json({
                error: "Access denied: You can only delete courses belonging to your school.",
            });
        }
        if (req.user.role === "TEACHER") {
            const assignment = yield prisma_1.default.teacherCourse.findFirst({
                where: { teacherId: req.user.id, courseId: id }, select: { id: true },
            });
            if (!assignment)
                return res.status(403).json({ error: "You are not assigned to this course." });
        }
        // ♻️ Soft Delete: move to trash instead of hard delete
        yield prisma_1.default.course.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        // We no longer need tombstones for soft-deleted items
        const { recordDeletedCourse } = yield Promise.resolve().then(() => __importStar(require("../lib/tombstones")));
        yield recordDeletedCourse(id, existingCourse.title);
        // Sync course to cloud after manual deletion so it doesn't reappear from cloud cache
        const { syncCourseToCloud } = yield Promise.resolve().then(() => __importStar(require("../lib/db-backup")));
        yield syncCourseToCloud(id).catch(() => { });
        res.json({ message: "Course deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Error deleting course" });
    }
});
exports.deleteCourseHandler22 = deleteCourseHandler22;
const getCourseHandler23 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const trashedCourses = yield prisma_1.default.course.findMany({
            where: { deletedAt: { not: null } },
            select: { id: true, title: true, deletedAt: true, subject: true },
        });
        const trashedLessons = yield prisma_1.default.lesson.findMany({
            where: { deletedAt: { not: null } },
            select: {
                id: true,
                title: true,
                deletedAt: true,
                course: { select: { title: true } },
            },
        });
        const trashedExams = yield prisma_1.default.exam.findMany({
            where: { deletedAt: { not: null } },
            select: { id: true, title: true, deletedAt: true },
        });
        const trashedQuestions = yield prisma_1.default.question.findMany({
            where: { deletedAt: { not: null } },
            select: {
                id: true,
                text: true,
                deletedAt: true,
                exam: { select: { title: true } },
            },
        });
        const trashedUsers = yield prisma_1.default.user.findMany({
            where: { deletedAt: { not: null } },
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                deletedAt: true,
            },
        });
        const courses = trashedCourses.map((c) => (Object.assign(Object.assign({}, c), { type: "course" })));
        const lessons = trashedLessons.map((l) => (Object.assign(Object.assign({}, l), { type: "lesson" })));
        const exams = trashedExams.map((e) => (Object.assign(Object.assign({}, e), { type: "exam" })));
        const questions = trashedQuestions.map((q) => (Object.assign(Object.assign({}, q), { title: q.text || "بدون نص", type: "question" })));
        const users = trashedUsers.map((u) => (Object.assign(Object.assign({}, u), { title: `${u.name} (${u.role})`, type: "user" })));
        const allItems = [
            ...courses,
            ...lessons,
            ...exams,
            ...questions,
            ...users,
        ];
        allItems.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
        const totalItems = allItems.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedItems = allItems.slice(startIndex, endIndex);
        res.json({
            items: paginatedItems,
            totalItems,
            totalPages,
            currentPage: page,
        });
    }
    catch (error) {
        res.status(500).json({ error: "Error fetching trash" });
    }
});
exports.getCourseHandler23 = getCourseHandler23;
const postCourseHandler24 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { items } = req.body; // Array of { id, type }
        if (!Array.isArray(items))
            return res.status(400).json({ error: "Invalid items array" });
        let restored = 0;
        for (const item of items) {
            if (item.type === "course") {
                yield prisma_1.default.course
                    .update({ where: { id: item.id }, data: { deletedAt: null } })
                    .catch(() => { });
            }
            else if (item.type === "lesson") {
                yield prisma_1.default.lesson
                    .update({ where: { id: item.id }, data: { deletedAt: null } })
                    .catch(() => { });
            }
            else if (item.type === "exam") {
                yield prisma_1.default.exam
                    .update({ where: { id: item.id }, data: { deletedAt: null } })
                    .catch(() => { });
            }
            else if (item.type === "question") {
                yield prisma_1.default.question
                    .update({ where: { id: item.id }, data: { deletedAt: null } })
                    .catch(() => { });
            }
            else if (item.type === "user") {
                yield prisma_1.default.user
                    .update({ where: { id: item.id }, data: { deletedAt: null } })
                    .catch(() => { });
            }
            restored++;
        }
        res.json({
            success: true,
            message: `Restored ${restored} items successfully`,
        });
    }
    catch (error) {
        console.error("Bulk restore error:", error);
        res.status(500).json({ error: "Error during bulk restore" });
    }
});
exports.postCourseHandler24 = postCourseHandler24;
const deleteCourseHandler25 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { type } = req.query; // optional: to empty specific type, else empty all
        let deletedCount = 0;
        if (!type || type === "all" || type === "question") {
            const questions = yield prisma_1.default.question.findMany({
                where: { deletedAt: { not: null } },
                select: { id: true },
            });
            for (const q of questions) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteQuestion)(q.id);
                if (ok)
                    deletedCount++;
            }
        }
        if (!type || type === "all" || type === "lesson") {
            const lessons = yield prisma_1.default.lesson.findMany({
                where: { deletedAt: { not: null } },
                select: { id: true },
            });
            for (const l of lessons) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteLesson)(l.id);
                if (ok)
                    deletedCount++;
            }
        }
        if (!type || type === "all" || type === "exam") {
            const exams = yield prisma_1.default.exam.findMany({
                where: { deletedAt: { not: null } },
                select: { id: true },
            });
            for (const e of exams) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteExam)(e.id);
                if (ok)
                    deletedCount++;
            }
        }
        if (!type || type === "all" || type === "course") {
            const courses = yield prisma_1.default.course.findMany({
                where: { deletedAt: { not: null } },
                select: { id: true },
            });
            for (const c of courses) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteCourse)(c.id);
                if (ok)
                    deletedCount++;
            }
        }
        if (!type || type === "all" || type === "user") {
            const users = yield prisma_1.default.user.findMany({
                where: { deletedAt: { not: null } },
                select: { id: true },
            });
            for (const u of users) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteUser)(u.id);
                if (ok)
                    deletedCount++;
            }
        }
        res.json({
            success: true,
            message: `Permanently deleted ${deletedCount} items.`,
        });
    }
    catch (error) {
        console.error("Empty trash error:", error);
        res.status(500).json({ error: "Error emptying trash" });
    }
});
exports.deleteCourseHandler25 = deleteCourseHandler25;
const postTrashBulkDeleteHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { items } = req.body;
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: "Invalid items array" });
        }
        let deletedCount = 0;
        for (const item of items) {
            let ok = false;
            if (item.type === "course")
                ok = yield (0, trashDeleteHelper_1.permanentlyDeleteCourse)(item.id);
            else if (item.type === "lesson")
                ok = yield (0, trashDeleteHelper_1.permanentlyDeleteLesson)(item.id);
            else if (item.type === "exam")
                ok = yield (0, trashDeleteHelper_1.permanentlyDeleteExam)(item.id);
            else if (item.type === "question")
                ok = yield (0, trashDeleteHelper_1.permanentlyDeleteQuestion)(item.id);
            else if (item.type === "user")
                ok = yield (0, trashDeleteHelper_1.permanentlyDeleteUser)(item.id);
            if (ok)
                deletedCount++;
        }
        res.json({
            success: true,
            message: `Permanently deleted ${deletedCount} items.`,
        });
    }
    catch (error) {
        console.error("Bulk trash delete error:", error);
        res.status(500).json({ error: "Error during bulk trash delete" });
    }
});
exports.postTrashBulkDeleteHandler = postTrashBulkDeleteHandler;
const deleteTrashItemHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { type, id } = req.params;
        let ok = false;
        if (type === "course")
            ok = yield (0, trashDeleteHelper_1.permanentlyDeleteCourse)(id);
        else if (type === "lesson")
            ok = yield (0, trashDeleteHelper_1.permanentlyDeleteLesson)(id);
        else if (type === "exam")
            ok = yield (0, trashDeleteHelper_1.permanentlyDeleteExam)(id);
        else if (type === "question")
            ok = yield (0, trashDeleteHelper_1.permanentlyDeleteQuestion)(id);
        else if (type === "user")
            ok = yield (0, trashDeleteHelper_1.permanentlyDeleteUser)(id);
        if (ok) {
            res.json({ success: true, message: "Item permanently deleted." });
        }
        else {
            res.status(400).json({ error: "Failed to permanently delete item." });
        }
    }
    catch (error) {
        console.error("Single trash delete error:", error);
        res.status(500).json({ error: "Error deleting trash item" });
    }
});
exports.deleteTrashItemHandler = deleteTrashItemHandler;
