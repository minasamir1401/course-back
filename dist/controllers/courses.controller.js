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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postCourseHandler32 = exports.getCourseHandler31 = exports.getCourseHandler30 = exports.getCourseHandler29 = exports.getCourseHandler28 = exports.postCourseHandler27 = exports.postCourseHandler26 = exports.deleteCourseHandler25 = exports.postCourseHandler24 = exports.getCourseHandler23 = exports.deleteCourseHandler22 = exports.deleteCourseHandler21 = exports.patchCourseHandler20 = exports.patchCourseHandler19 = exports.patchCourseHandler18 = exports.patchCourseHandler17 = exports.getCourseHandler16 = exports.postCourseHandler15 = exports.postCourseHandler14 = exports.postCourseHandler13 = exports.putCourseHandler12 = exports.postCourseHandler11 = exports.postCourseHandler10 = exports.putCourseHandler9 = exports.deleteCourseHandler8 = exports.getCourseHandler7 = exports.postCourseHandler6 = exports.deleteCourseHandler5 = exports.getCourseHandler4 = exports.postCourseHandler3 = exports.postCourseHandler2 = exports.getCourseHandler1 = void 0;
exports.previewDeduplication = previewDeduplication;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const shared_1 = require("../shared");
const db_backup_1 = require("../lib/db-backup");
const getCourseHandler1 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield previewDeduplication();
    if (result.success) {
        res.json(result);
    }
    else {
        res.status(500).json({ error: "Error generating deduplication preview" });
    }
});
exports.getCourseHandler1 = getCourseHandler1;
const postCourseHandler2 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { idsToDelete } = req.body;
        if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
            return res
                .status(400)
                .json({ error: "idsToDelete must be a non-empty array" });
        }
        const { count } = yield prisma_1.default.lesson.updateMany({
            where: { id: { in: idsToDelete }, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        res.json({ success: true, deletedCount: count });
    }
    catch (error) {
        console.error("Error merging lessons:", error);
        res.status(500).json({ error: "Error merging lessons" });
    }
});
exports.postCourseHandler2 = postCourseHandler2;
const postCourseHandler3 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, grade, schoolId, teacherId } = req.body;
        const classroom = yield prisma_1.default.classroom.create({
            data: { name, grade, schoolId, teacherId },
        });
        res.json(classroom);
    }
    catch (error) {
        res.status(500).json({ error: "Error creating classroom" });
    }
});
exports.postCourseHandler3 = postCourseHandler3;
const getCourseHandler4 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolId } = req.query;
        const classrooms = yield prisma_1.default.classroom.findMany({
            where: { schoolId: schoolId },
            include: {
                teacher: { select: { name: true } },
                _count: { select: { students: true } },
            },
        });
        res.json(classrooms);
    }
    catch (error) {
        res.status(500).json({ error: "Error fetching classrooms" });
    }
});
exports.getCourseHandler4 = getCourseHandler4;
const deleteCourseHandler5 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const classroom = yield prisma_1.default.classroom.findUnique({
            where: { id: req.params.id },
        });
        if (!classroom)
            return res.status(404).json({ error: "Classroom not found" });
        if (req.user.role === "SCHOOL_ADMIN" &&
            classroom.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: "Access denied" });
        }
        yield prisma_1.default.classroom.delete({ where: { id: req.params.id } });
        res.json({ message: "Classroom deleted" });
    }
    catch (error) {
        res.status(500).json({ error: "Error deleting classroom" });
    }
});
exports.deleteCourseHandler5 = deleteCourseHandler5;
const postCourseHandler6 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, grade, schoolId, teacherName, subject } = req.body;
        let teacherId = req.body.teacherId || null;
        if (!teacherId && teacherName) {
            const teacherUser = yield prisma_1.default.user.findFirst({
                where: {
                    name: teacherName,
                    role: "TEACHER",
                    schoolId: schoolId,
                },
            });
            if (teacherUser) {
                teacherId = teacherUser.id;
            }
        }
        const finalName = subject ? `${name} | ${subject}` : name;
        const classroom = yield prisma_1.default.classroom.create({
            data: {
                name: finalName,
                grade,
                schoolId,
                teacherId,
            },
        });
        res.json(classroom);
    }
    catch (error) {
        console.error("Error creating classroom alias:", error);
        res.status(500).json({ error: "Error creating classroom" });
    }
});
exports.postCourseHandler6 = postCourseHandler6;
const getCourseHandler7 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolId } = req.query;
        if (!schoolId) {
            return res.status(400).json({ error: "schoolId is required" });
        }
        const classrooms = yield prisma_1.default.classroom.findMany({
            where: { schoolId: schoolId },
            include: {
                teacher: { select: { name: true } },
                _count: { select: { students: true } },
            },
        });
        res.json(classrooms.map((c) => {
            var _a;
            const parts = c.name.split(" | ");
            return {
                id: c.id,
                name: parts[0],
                grade: c.grade,
                subject: parts[1] || "عام",
                teacherName: ((_a = c.teacher) === null || _a === void 0 ? void 0 : _a.name) || "",
                studentsCount: c._count.students,
            };
        }));
    }
    catch (error) {
        console.error("Error fetching classrooms alias:", error);
        res.status(500).json({ error: "Error fetching classrooms" });
    }
});
exports.getCourseHandler7 = getCourseHandler7;
const deleteCourseHandler8 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const classroom = yield prisma_1.default.classroom.findUnique({
            where: { id: req.params.id },
        });
        if (!classroom)
            return res.status(404).json({ error: "Classroom not found" });
        if ((req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
            classroom.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: "Access denied" });
        }
        yield prisma_1.default.classroom.delete({ where: { id: req.params.id } });
        res.json({ message: "Classroom deleted" });
    }
    catch (error) {
        console.error("Error deleting classroom alias:", error);
        res.status(500).json({ error: "Error deleting classroom" });
    }
});
exports.deleteCourseHandler8 = deleteCourseHandler8;
const putCourseHandler9 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, grade, schoolId, teacherName, subject } = req.body;
        const classroom = yield prisma_1.default.classroom.findUnique({
            where: { id: req.params.id },
        });
        if (!classroom)
            return res.status(404).json({ error: "Classroom not found" });
        if ((req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
            classroom.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: "Access denied" });
        }
        let teacherId = req.body.teacherId || null;
        if (!teacherId && teacherName) {
            const teacherUser = yield prisma_1.default.user.findFirst({
                where: {
                    name: teacherName,
                    role: "TEACHER",
                    schoolId: schoolId || classroom.schoolId,
                },
            });
            if (teacherUser) {
                teacherId = teacherUser.id;
            }
        }
        const finalName = subject ? `${name} | ${subject}` : name;
        const updated = yield prisma_1.default.classroom.update({
            where: { id: req.params.id },
            data: {
                name: finalName,
                grade,
                teacherId,
            },
        });
        res.json(updated);
    }
    catch (error) {
        console.error("Error updating classroom alias:", error);
        res.status(500).json({ error: "Error updating classroom" });
    }
});
exports.putCourseHandler9 = putCourseHandler9;
const postCourseHandler10 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, username, password, role, grade } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, [
            "name",
            "username",
            "password",
            "role",
        ]);
        if (missing) {
            return res
                .status(400)
                .json({ error: `Missing required fields: ${missing.join(", ")}` });
        }
        if (!shared_1.SCHOOL_MANAGED_ROLES.includes(role)) {
            return res
                .status(403)
                .json({
                error: "غير مسموح بإنشاء مستخدم بهذه الصلاحية من هذا المسار.",
            });
        }
        const schoolId = req.user.role === "SCHOOL_ADMIN"
            ? req.user.schoolId
            : req.body.schoolId;
        if (!schoolId)
            return res.status(400).json({ error: "schoolId is required." });
        const hashedPassword = yield bcryptjs_1.default.hash(password, 10);
        const user = yield prisma_1.default.user.create({
            data: {
                name,
                username,
                password: hashedPassword,
                role,
                schoolId,
                grade,
            },
            select: shared_1.userSafeSelect,
        });
        res.json({ message: "User created for school", user });
    }
    catch (error) {
        res.status(500).json({ error: "Error creating user" });
    }
});
exports.postCourseHandler10 = postCourseHandler10;
const postCourseHandler11 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, description, coverImage, grade, grades, subject, country, isCentral, schoolId, schoolIds, lessons, } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, ["title"]);
        if (missing) {
            return res
                .status(400)
                .json({ error: `Missing required fields: ${missing.join(", ")}` });
        }
        if ((req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
            isCentral) {
            return res
                .status(403)
                .json({ error: "Only Super Admin can create central courses." });
        }
        // Determine the target school ID
        const rawCreateSchoolList = schoolIds !== undefined ? schoolIds : (schoolId ? [schoolId] : []);
        const sanitizedCreateSchoolIds = (Array.isArray(rawCreateSchoolList) ? rawCreateSchoolList : [rawCreateSchoolList])
            .map((sid) => (typeof sid === "object" && sid ? sid.id : sid))
            .filter((sid) => Boolean(sid && typeof sid === "string" && sid !== "null" && sid !== "undefined" && sid.trim() !== ""))
            .map((sid) => sid.trim());
        const targetSchoolId = req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER"
            ? req.user.schoolId
            : isCentral
                ? null
                : (sanitizedCreateSchoolIds.length > 0 ? sanitizedCreateSchoolIds[0] : (schoolId && schoolId !== "null" && typeof schoolId === "string" && schoolId.trim() !== "" ? schoolId.trim() : null)) || req.user.schoolId;
        // Check if duplicate course already exists in the target school
        const existingCourse = yield prisma_1.default.course.findFirst({
            where: {
                title,
                schoolId: targetSchoolId,
                deletedAt: null,
            },
        });
        if (existingCourse) {
            return res
                .status(400)
                .json({ error: "يوجد كورس بنفس هذا الاسم مسجل مسبقاً في المدرسة." });
        }
        // Pre-calculate durations
        const lessonsData = yield Promise.all((lessons || []).map((lesson, index) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            if (lesson.videoUrl && !(0, shared_1.isAllowedVideoUrl)(lesson.videoUrl)) {
                throw new Error("Only HTTPS YouTube/Vimeo URLs are allowed for lessons.");
            }
            const duration = yield (0, shared_1.getVideoDuration)(lesson.videoUrl || "");
            const sanitizedLesson = (0, shared_1.sanitizeDeep)(lesson);
            return {
                title: sanitizedLesson.title,
                domain: sanitizedLesson.domain || null,
                content: (_a = sanitizedLesson.content) !== null && _a !== void 0 ? _a : null,
                videoUrl: sanitizedLesson.videoUrl,
                duration: duration,
                summary: sanitizedLesson.summary,
                notes: sanitizedLesson.notes,
                questions: sanitizedLesson.questions
                    ? sanitizedLesson.questions
                    : null,
                assignments: sanitizedLesson.assignments
                    ? sanitizedLesson.assignments
                    : null,
                attachments: sanitizedLesson.attachments
                    ? sanitizedLesson.attachments
                    : null,
                slides: sanitizedLesson.slides ? sanitizedLesson.slides : null,
                standards: sanitizedLesson.standards || null,
                indicators: sanitizedLesson.indicators || null,
                learningOutcomes: sanitizedLesson.learningOutcomes || null,
                creatorId: req.user.id,
                isCentral: req.user.role === "SUPER_ADMIN" ? !!isCentral : false,
                isVisible: sanitizedLesson.isVisible !== undefined
                    ? !!sanitizedLesson.isVisible
                    : true,
                publishDate: sanitizedLesson.publishDate
                    ? new Date(sanitizedLesson.publishDate)
                    : null,
                cutOffDate: sanitizedLesson.cutOffDate
                    ? new Date(sanitizedLesson.cutOffDate)
                    : null,
                order: index,
            };
        })));
        // Create course and its lessons in a transaction
        const course = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const newCourse = yield tx.course.create({
                data: {
                    title,
                    description: description ? (0, shared_1.sanitizeDeep)(description) : null,
                    coverImage: coverImage ? (0, shared_1.sanitizeDeep)(coverImage) : null,
                    grade: Array.isArray(grades) ? grades[0] : grade,
                    grades: Array.isArray(grades)
                        ? JSON.stringify(grades)
                        : grade
                            ? JSON.stringify([grade])
                            : null,
                    subject,
                    country: country || "مصر",
                    creatorId: req.user.id,
                    isCentral: req.user.role === "SUPER_ADMIN" ? !!isCentral : false,
                    schoolId: targetSchoolId,
                    schools: req.user.role === "SUPER_ADMIN" &&
                        !isCentral &&
                        sanitizedCreateSchoolIds.length > 0
                        ? { connect: sanitizedCreateSchoolIds.map((id) => ({ id })) }
                        : undefined,
                    lessons: {
                        create: lessonsData,
                    },
                },
                include: {
                    lessons: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
                },
            });
            return newCourse;
        }));
        // Real-time Dual-Write: Instantly sync newly added course to Cloud Backup cloud database
        // Awaiting this guarantees the UI won't redirect until the cloud is updated.
        if (course === null || course === void 0 ? void 0 : course.id)
            yield (0, db_backup_1.syncCourseToCloud)(course.id).catch(() => { });
        res.json(course);
    }
    catch (error) {
        console.error("Error creating course:", error);
        res
            .status(500)
            .json({ error: "Error creating course", details: error.message });
    }
});
exports.postCourseHandler11 = postCourseHandler11;
const putCourseHandler12 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, coverImage, grade, grades, subject, country, isCentral, schoolId, schoolIds, lessons, } = req.body;
        if (lessons !== undefined && !Array.isArray(lessons)) {
            return res.status(400).json({ error: "lessons must be an array when provided." });
        }
        // Authorization check
        const existingCourse = yield prisma_1.default.course.findUnique({
            where: { id },
            include: { schools: true },
        });
        if (!existingCourse)
            return res.status(404).json({ error: "Course not found" });
        if ((req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
            existingCourse.schoolId !== req.user.schoolId &&
            (!existingCourse.schools ||
                !existingCourse.schools.some((s) => s.id === req.user.schoolId))) {
            return res.status(403).json({ error: "Access denied" });
        }
        if ((req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
            (isCentral || (schoolId && schoolId !== req.user.schoolId))) {
            return res
                .status(403)
                .json({
                error: "School admins/teachers cannot change course ownership.",
            });
        }
        // ══════════════════════════════════════════════════════════════════════════
        // 🔒 FIX: Pre-fetch existing lessons and compute video durations BEFORE
        //    opening the Prisma transaction.
        // ══════════════════════════════════════════════════════════════════════════
        const existingLessons = yield prisma_1.default.lesson.findMany({
            where: { courseId: id, deletedAt: null },
            select: {
                id: true,
                title: true,
                order: true,
                videoUrl: true,
                duration: true,
                slides: true,
                content: true,
                questions: true,
                assignments: true,
                attachments: true,
            },
        });
        const existingLessonsMap = new Map(existingLessons.map((l) => [l.id, l]));
        const lessonsData = lessons && Array.isArray(lessons)
            ? yield Promise.all(lessons.map((lesson, index) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                if (lesson.videoUrl && !(0, shared_1.isAllowedVideoUrl)(lesson.videoUrl)) {
                    throw new Error("Only HTTPS YouTube/Vimeo URLs are allowed for lessons.");
                }
                let duration = 0;
                const existingLesson = lesson.id
                    ? existingLessonsMap.get(lesson.id)
                    : null;
                if (existingLesson &&
                    existingLesson.videoUrl === lesson.videoUrl) {
                    duration = existingLesson.duration || 0;
                }
                else {
                    duration = yield (0, shared_1.getVideoDuration)(lesson.videoUrl || "");
                }
                const sanitizedLesson = (0, shared_1.sanitizeDeep)(lesson);
                const rawId = sanitizedLesson.id;
                const isExistingDbId = rawId && existingLessonsMap.has(String(rawId));
                const cleanId = isExistingDbId ? String(rawId) : undefined;
                // 🔒 FIX: "isNotProvided" only treats null/undefined as "not sent by frontend".
                // An empty array [] means the user intentionally cleared the field — we must
                // respect that and NOT fall back to the stale DB value.
                // Previously this was "isEmpty" which included [] and '[]', causing stale data
                // from the DB to silently overwrite what the frontend sent.
                const isNotProvided = (v) => v === null || v === undefined;
                // Parse frontend-sent JSON strings back to arrays for the emptiness check
                const parseIfString = (v) => {
                    if (typeof v === "string") {
                        try {
                            return JSON.parse(v);
                        }
                        catch (_a) {
                            return v;
                        }
                    }
                    return v;
                };
                const parsedQuestions = parseIfString(sanitizedLesson.questions);
                const parsedAssignments = parseIfString(sanitizedLesson.assignments);
                const parsedAttachments = parseIfString(sanitizedLesson.attachments);
                const parsedSlides = parseIfString(sanitizedLesson.slides);
                // Debug log — visible in Dokploy container logs
                console.log(`[Course PUT] Lesson "${sanitizedLesson.title}" (id=${cleanId || "NEW"}) | ` +
                    `questions=${Array.isArray(parsedQuestions) ? parsedQuestions.length : isNotProvided(parsedQuestions) ? "NOT_PROVIDED" : typeof parsedQuestions} | ` +
                    `assignments=${Array.isArray(parsedAssignments) ? parsedAssignments.length : isNotProvided(parsedAssignments) ? "NOT_PROVIDED" : typeof parsedAssignments}`);
                return {
                    id: cleanId,
                    title: sanitizedLesson.title || "Untitled Lesson",
                    domain: sanitizedLesson.domain || null,
                    content: (0, shared_1.extractAndSaveBase64Images)(sanitizedLesson.content !== undefined
                        ? sanitizedLesson.content
                        : cleanId
                            ? ((_b = (_a = existingLessonsMap.get(cleanId)) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : null)
                            : null),
                    videoUrl: sanitizedLesson.videoUrl || null,
                    duration,
                    summary: sanitizedLesson.summary || null,
                    notes: sanitizedLesson.notes || null,
                    questions: isNotProvided(parsedQuestions)
                        ? cleanId
                            ? ((_d = (_c = existingLessonsMap.get(cleanId)) === null || _c === void 0 ? void 0 : _c.questions) !== null && _d !== void 0 ? _d : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedQuestions),
                    assignments: isNotProvided(parsedAssignments)
                        ? cleanId
                            ? ((_f = (_e = existingLessonsMap.get(cleanId)) === null || _e === void 0 ? void 0 : _e.assignments) !== null && _f !== void 0 ? _f : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedAssignments),
                    attachments: isNotProvided(parsedAttachments)
                        ? cleanId
                            ? ((_h = (_g = existingLessonsMap.get(cleanId)) === null || _g === void 0 ? void 0 : _g.attachments) !== null && _h !== void 0 ? _h : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedAttachments),
                    slides: isNotProvided(parsedSlides)
                        ? cleanId
                            ? ((_k = (_j = existingLessonsMap.get(cleanId)) === null || _j === void 0 ? void 0 : _j.slides) !== null && _k !== void 0 ? _k : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedSlides),
                    standards: sanitizedLesson.standards || null,
                    indicators: sanitizedLesson.indicators || null,
                    learningOutcomes: sanitizedLesson.learningOutcomes || null,
                    isCentral: req.user.role === "SUPER_ADMIN" ? !!isCentral : false,
                    isVisible: sanitizedLesson.isVisible !== undefined
                        ? !!sanitizedLesson.isVisible
                        : true,
                    publishDate: sanitizedLesson.publishDate &&
                        !isNaN(new Date(sanitizedLesson.publishDate).getTime())
                        ? new Date(sanitizedLesson.publishDate)
                        : null,
                    cutOffDate: sanitizedLesson.cutOffDate &&
                        !isNaN(new Date(sanitizedLesson.cutOffDate).getTime())
                        ? new Date(sanitizedLesson.cutOffDate)
                        : null,
                    order: index,
                    courseId: id,
                };
            })))
            : null;
        console.log("[Course PUT] Raw schoolIds:", JSON.stringify(schoolIds), "schoolId:", schoolId);
        const rawSchoolList = schoolIds !== undefined ? schoolIds : (schoolId ? [schoolId] : []);
        const sanitizedSchoolIds = (Array.isArray(rawSchoolList) ? rawSchoolList : [rawSchoolList])
            .map((sid) => (typeof sid === "object" && sid ? sid.id : sid))
            .filter((sid) => Boolean(sid && typeof sid === "string" && sid !== "null" && sid !== "undefined" && sid.trim() !== ""))
            .map((sid) => sid.trim());
        const updatedCourse = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.course.update({
                where: { id },
                data: {
                    title,
                    description: description ? (0, shared_1.sanitizeDeep)(description) : null,
                    coverImage: coverImage
                        ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeDeep)(coverImage))
                        : null,
                    grade: Array.isArray(grades) ? grades[0] : grade,
                    grades: Array.isArray(grades)
                        ? JSON.stringify(grades)
                        : grade
                            ? JSON.stringify([grade])
                            : null,
                    subject,
                    country: country || "مصر",
                    isCentral: req.user.role === "SUPER_ADMIN" ? !!isCentral : false,
                    schoolId: req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER"
                        ? (req.user.schoolId || existingCourse.schoolId)
                        : isCentral
                            ? null
                            : (sanitizedSchoolIds.length > 0 ? sanitizedSchoolIds[0] : (schoolId && schoolId !== "null" && typeof schoolId === "string" && schoolId.trim() !== "" ? schoolId.trim() : null)),
                    schools: req.user.role === "SUPER_ADMIN" && isCentral
                        ? { set: [] }
                        : req.user.role === "SUPER_ADMIN" && !isCentral && (schoolIds !== undefined || schoolId !== undefined)
                            ? {
                                set: [],
                                connect: sanitizedSchoolIds.map((sid) => ({ id: sid })),
                            }
                            : undefined,
                },
            });
            if (!lessonsData) {
                return tx.course.findUnique({
                    where: { id },
                    include: {
                        lessons: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
                    },
                });
            }
            const usedExistingIds = new Set();
            const processedLessonIds = new Set();
            for (const lesson of lessonsData) {
                if (lesson.id && existingLessonsMap.has(lesson.id)) {
                    if (processedLessonIds.has(lesson.id)) {
                        continue;
                    }
                    const { id: lessonId } = lesson, updateData = __rest(lesson, ["id"]);
                    yield tx.lesson.update({
                        where: { id: lessonId },
                        data: updateData,
                    });
                    usedExistingIds.add(lessonId);
                    processedLessonIds.add(lessonId);
                    continue;
                }
                const { id: _ } = lesson, createData = __rest(lesson, ["id"]);
                const createdLesson = yield tx.lesson.create({
                    data: Object.assign(Object.assign({}, createData), { id: typeof lesson.id === "string" && lesson.id.length > 20
                            ? lesson.id
                            : undefined }),
                });
                if (createdLesson === null || createdLesson === void 0 ? void 0 : createdLesson.id) {
                    usedExistingIds.add(createdLesson.id);
                }
            }
            return tx.course.findUnique({
                where: { id },
                include: {
                    lessons: {
                        where: { deletedAt: null },
                        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
                    },
                },
            });
        }), { timeout: 30000 });
        if (id)
            yield (0, db_backup_1.syncCourseToCloud)(id).catch(() => { });
        res.json(updatedCourse);
    }
    catch (error) {
        console.error("Error updating course:", error);
        res
            .status(500)
            .json({ error: "Error updating course", details: error.message });
    }
});
exports.putCourseHandler12 = putCourseHandler12;
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
            data: {
                courseId: targetCourseId,
                title: sourceLesson.title + " (نسخة)",
                domain: sourceLesson.domain,
                content: sourceLesson.content,
                videoUrl: sourceLesson.videoUrl,
                duration: sourceLesson.duration,
                summary: sourceLesson.summary,
                notes: sourceLesson.notes,
                questions: (_a = sourceLesson.questions) !== null && _a !== void 0 ? _a : undefined,
                attachments: (_b = sourceLesson.attachments) !== null && _b !== void 0 ? _b : undefined,
                slides: (_c = sourceLesson.slides) !== null && _c !== void 0 ? _c : undefined,
                assignments: (_d = sourceLesson.assignments) !== null && _d !== void 0 ? _d : undefined,
                standards: sourceLesson.standards,
                indicators: sourceLesson.indicators,
                learningOutcomes: sourceLesson.learningOutcomes,
                isCentral: sourceLesson.isCentral,
                isVisible: sourceLesson.isVisible,
                order: (targetCourse._count.lessons || 0) + 1,
            },
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
    try {
        const { id } = req.params;
        const { slides } = req.body;
        if (!slides)
            return res.status(400).json({ error: "slides field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
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
    try {
        const { id } = req.params;
        const { questions } = req.body;
        if (questions === undefined)
            return res.status(400).json({ error: "questions field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
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
    try {
        const { id } = req.params;
        const { assignments } = req.body;
        if (assignments === undefined)
            return res.status(400).json({ error: "assignments field is required" });
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            select: { id: true, courseId: true },
        });
        if (!lesson)
            return res.status(404).json({ error: "Lesson not found" });
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
    var _a;
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
        if (req.user.role === "SCHOOL_ADMIN" &&
            ((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.schoolId) !== req.user.schoolId) {
            return res
                .status(403)
                .json({
                error: "Access denied: You can only delete lessons belonging to your school.",
            });
        }
        // ♻️ Soft Delete: move to trash instead of hard delete to preserve student data
        yield prisma_1.default.lesson.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        // We no longer need tombstones for soft-deleted items, but keeping it for legacy support
        const { recordDeletedLesson } = yield Promise.resolve().then(() => __importStar(require("../lib/tombstones")));
        yield recordDeletedLesson(id, lesson.title);
        console.log(`🗑️  [Lesson Delete] SUPER_ADMIN manually deleted lesson "${lesson.title}" (${id}) from course ${lesson.courseId}`);
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
            // It's already deleted locally but still lingering in the Cloud Backup!
            // Force a full cloud sync to overwrite the cloud and clear the ghost course
            const { syncAllCoursesToCloud } = yield Promise.resolve().then(() => __importStar(require("../lib/db-backup")));
            yield syncAllCoursesToCloud("Ghost Course Cleanup");
            return res.json({
                message: "Ghost course cleared from cloud cache successfully",
            });
        }
        if (req.user.role === "SCHOOL_ADMIN" &&
            existingCourse.schoolId !== req.user.schoolId) {
            return res
                .status(403)
                .json({
                error: "Access denied: You can only delete courses belonging to your school.",
            });
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
            try {
                const result = yield prisma_1.default.question.deleteMany({
                    where: { deletedAt: { not: null } },
                });
                deletedCount += result.count;
            }
            catch (e) {
                console.error("Error emptying questions", e);
            }
        }
        if (!type || type === "all" || type === "lesson") {
            try {
                const result = yield prisma_1.default.lesson.deleteMany({
                    where: { deletedAt: { not: null } },
                });
                deletedCount += result.count;
            }
            catch (e) {
                console.error("Error emptying lessons", e);
            }
        }
        if (!type || type === "all" || type === "exam") {
            try {
                const result = yield prisma_1.default.exam.deleteMany({
                    where: { deletedAt: { not: null } },
                });
                deletedCount += result.count;
            }
            catch (e) {
                console.error("Error emptying exams", e);
            }
        }
        if (!type || type === "all" || type === "course") {
            try {
                const result = yield prisma_1.default.course.deleteMany({
                    where: { deletedAt: { not: null } },
                });
                deletedCount += result.count;
            }
            catch (e) {
                console.error("Error emptying courses", e);
            }
        }
        if (!type || type === "all" || type === "user") {
            try {
                // Disconnect relations that do not have onDelete: Cascade
                const deletedUsers = yield prisma_1.default.user.findMany({
                    where: { deletedAt: { not: null } },
                    select: { id: true },
                });
                if (deletedUsers.length > 0) {
                    const ids = deletedUsers.map((u) => u.id);
                    yield prisma_1.default.classroom.updateMany({
                        where: { teacherId: { in: ids } },
                        data: { teacherId: null },
                    });
                    yield prisma_1.default.user.updateMany({
                        where: { parentId: { in: ids } },
                        data: { parentId: null },
                    });
                    const result = yield prisma_1.default.user.deleteMany({
                        where: { id: { in: ids } },
                    });
                    deletedCount += result.count;
                }
            }
            catch (e) {
                console.error("Error emptying users", e);
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
const postCourseHandler26 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.default.course.update({
            where: { id },
            data: { deletedAt: null },
        });
        // Sync restored course to cloud
        const { syncCourseToCloud } = yield Promise.resolve().then(() => __importStar(require("../lib/db-backup")));
        yield syncCourseToCloud(id).catch(() => { });
        res.json({ message: "Course restored successfully from the Nile" });
    }
    catch (error) {
        res.status(500).json({ error: "Error restoring course" });
    }
});
exports.postCourseHandler26 = postCourseHandler26;
const postCourseHandler27 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const restoredLesson = yield prisma_1.default.lesson.update({
            where: { id },
            data: { deletedAt: null },
        });
        // Sync restored course to cloud
        if (restoredLesson.courseId) {
            const { syncCourseToCloud } = yield Promise.resolve().then(() => __importStar(require("../lib/db-backup")));
            yield syncCourseToCloud(restoredLesson.courseId).catch(() => { });
        }
        res.json({ message: "Lesson restored successfully from the Nile" });
    }
    catch (error) {
        res.status(500).json({ error: "Error restoring lesson" });
    }
});
exports.postCourseHandler27 = postCourseHandler27;
const getCourseHandler28 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { isCentral, schoolId, page = "1", limit = "20", search } = req.query;
        const cacheKey = `courses_list_${req.user.role}_${req.user.schoolId || "none"}_${req.user.grade || "none"}_${isCentral}_${schoolId}_${page}_${limit}_${search || ""}`;
        // Only cache for students. Admins need real-time data to avoid "content not found" on deleted items.
        if (req.user.role === "STUDENT") {
            const cached = (0, shared_1.getCache)(cacheKey);
            if (cached)
                return res.json(cached);
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        const accessFilter = {};
        const userSchoolId = req.user.schoolId || schoolId;
        if (isCentral === "true") {
            accessFilter.isCentral = true;
        }
        else if (isCentral === "false") {
            accessFilter.isCentral = false;
        }
        if (req.user.role === "SUPER_ADMIN") {
            if (schoolId) {
                accessFilter.OR = [
                    { schoolId: schoolId },
                    { schools: { some: { id: schoolId } } },
                ];
            }
        }
        else if (req.user.role === "SCHOOL_ADMIN") {
            if (userSchoolId) {
                accessFilter.OR = [
                    { isCentral: true },
                    { schoolId: userSchoolId },
                    { schools: { some: { id: userSchoolId } } },
                ];
            }
        }
        else if (req.user.role === "TEACHER") {
            accessFilter.OR = [
                { creatorId: req.user.id },
                { teachers: { some: { teacherId: req.user.id } } },
            ];
        }
        else if (req.user.role === "STUDENT") {
            const studentGrade = req.user.grade;
            const studentSchoolId = req.user.schoolId;
            const studentGrades = (0, shared_1.getStudentGradeAndStage)(studentGrade);
            const gradeOrConditions = [{ grade: null }];
            for (const g of studentGrades) {
                gradeOrConditions.push({ grade: g });
                gradeOrConditions.push({ grades: { contains: `"${g}"` } });
            }
            const orFilters = [];
            if (studentGrade) {
                orFilters.push({
                    isCentral: true,
                    OR: gradeOrConditions,
                });
            }
            else {
                orFilters.push({ isCentral: true });
            }
            if (studentSchoolId) {
                if (studentGrade) {
                    orFilters.push({
                        schoolId: studentSchoolId,
                        OR: gradeOrConditions,
                    });
                    orFilters.push({
                        schools: { some: { id: studentSchoolId } },
                        OR: gradeOrConditions,
                    });
                }
                else {
                    orFilters.push({ schoolId: studentSchoolId });
                    orFilters.push({ schools: { some: { id: studentSchoolId } } });
                }
            }
            accessFilter.OR = orFilters;
        }
        const filters = Object.keys(accessFilter).length > 0 ? [accessFilter] : [];
        if (search) {
            filters.push({
                OR: [
                    { title: { contains: search, mode: "insensitive" } },
                    { subject: { contains: search, mode: "insensitive" } },
                    {
                        lessons: {
                            some: {
                                title: { contains: search, mode: "insensitive" },
                                deletedAt: null,
                            },
                        },
                    },
                ],
            });
        }
        const where = filters.length > 0
            ? { AND: filters, deletedAt: null }
            : { deletedAt: null };
        console.time("courses-db-query");
        const [courses, total] = yield Promise.all([
            prisma_1.default.course.findMany({
                where,
                skip,
                take,
                select: {
                    id: true,
                    title: true,
                    description: true,
                    coverImage: true,
                    grade: true,
                    grades: true,
                    subject: true,
                    country: true,
                    isCentral: true,
                    schoolId: true,
                    createdAt: true,
                    school: { select: { name: true } },
                    _count: {
                        select: {
                            lessons: { where: { deletedAt: null } },
                            enrollments: true,
                            exams: { where: { deletedAt: null } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
            }),
            prisma_1.default.course.count({ where }),
        ]);
        console.timeEnd("courses-db-query");
        // Return database courses directly without merging unverified ghost cloud backups
        const responseData = {
            courses,
            pagination: {
                total,
                page: parseInt(page),
                limit: take,
                totalPages: Math.ceil(total / take),
            },
        };
        if (req.user.role === "STUDENT") {
            (0, shared_1.setCache)(cacheKey, responseData);
        }
        res.json(responseData);
    }
    catch (error) {
        res.status(500).json({ error: "Error fetching courses" });
    }
});
exports.getCourseHandler28 = getCourseHandler28;
const getCourseHandler29 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { isCentral, schoolId, search } = req.query;
        const accessFilter = {};
        if (isCentral === "true") {
            accessFilter.isCentral = true;
        }
        else if (req.user.role === "SUPER_ADMIN") {
            if (schoolId) {
                accessFilter.OR = [
                    { schoolId: schoolId },
                    { schools: { some: { id: schoolId } } },
                ];
            }
        }
        else if (req.user.role === "SCHOOL_ADMIN") {
            accessFilter.OR = [
                { isCentral: true },
                { schoolId: req.user.schoolId },
                { schools: { some: { id: req.user.schoolId } } },
            ];
        }
        else if (req.user.role === "TEACHER") {
            accessFilter.OR = [
                { creatorId: req.user.id },
                { teachers: { some: { teacherId: req.user.id } } },
            ];
        }
        const filters = Object.keys(accessFilter).length > 0 ? [accessFilter] : [];
        if (search) {
            filters.push({
                OR: [
                    { title: { contains: search, mode: "insensitive" } },
                    { subject: { contains: search, mode: "insensitive" } },
                    {
                        lessons: {
                            some: {
                                title: { contains: search, mode: "insensitive" },
                                deletedAt: null,
                            },
                        },
                    },
                ],
            });
        }
        const where = filters.length > 0 ? { AND: filters } : {};
        const cacheKey = `stats_${JSON.stringify(where)}`;
        const cached = (0, shared_1.getCache)(cacheKey);
        const now = Date.now();
        if (cached && now - cached.timestamp < shared_1.CACHE_TTL) {
            return res.json(cached.data);
        }
        const isUnfiltered = Object.keys(where).length === 0;
        console.time("stats-db-query");
        const [totalCourses, totalLessons, uniqueSubjects] = yield Promise.all([
            prisma_1.default.course.count({ where }),
            isUnfiltered
                ? prisma_1.default.lesson.count()
                : prisma_1.default.lesson.count({ where: { course: where } }),
            prisma_1.default.course.groupBy({
                by: ["subject"],
                where: Object.assign(Object.assign({}, where), { subject: { not: null } }),
            }),
        ]);
        console.timeEnd("stats-db-query");
        const stats = {
            totalCourses,
            totalLessons,
            totalSubjects: uniqueSubjects.length,
        };
        (0, shared_1.setCache)(cacheKey, stats);
        res.json(stats);
    }
    catch (error) {
        res.status(500).json({ error: "Error fetching stats" });
    }
});
exports.getCourseHandler29 = getCourseHandler29;
const getCourseHandler30 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const courseId = req.params.id;
        const summaryOnly = req.query.summary === "true" && ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"].includes(req.user.role);
        const includeSlideCounts = summaryOnly && req.query.includeSlideCounts === "true";
        const countsOnly = includeSlideCounts && req.query.countsOnly === "true";
        const course = yield prisma_1.default.course.findFirst({
            where: { id: courseId, deletedAt: null },
            include: {
                lessons: {
                    where: { deletedAt: null },
                    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
                    select: summaryOnly
                        ? {
                            // Keep the course editor list fast: lesson content is fetched on edit.
                            id: true,
                            courseId: true,
                            title: true,
                            isVisible: true,
                            publishDate: true,
                            cutOffDate: true,
                            order: true,
                            createdAt: true,
                            updatedAt: true,
                        }
                        : {
                            id: true,
                            courseId: true,
                            title: true,
                            domain: true,
                            content: true,
                            videoUrl: true,
                            summary: true,
                            notes: true,
                            standards: true,
                            indicators: true,
                            learningOutcomes: true,
                            slides: true,
                            questions: true,
                            assignments: true,
                            attachments: true,
                            isCentral: true,
                            isVisible: true,
                            publishDate: true,
                            cutOffDate: true,
                            order: true,
                            duration: true,
                            deletedAt: true,
                            originalCourseId: true,
                            createdAt: true,
                            updatedAt: true,
                            progresses: req.user.role === "SUPER_ADMIN"
                                ? false
                                : {
                                    where: { userId: req.user.id },
                                },
                        },
                },
                exams: {
                    orderBy: { createdAt: "desc" },
                    include: {
                        _count: { select: { submissions: true, questions: true } },
                    },
                },
                schools: { select: { id: true } },
            },
        });
        if (!course) {
            return res.status(404).json({ error: "Course not found" });
        }
        // Basic access check (optional depending on exact requirements, but good practice)
        if (!course.isCentral &&
            req.user.role !== "SUPER_ADMIN" &&
            course.schoolId !== req.user.schoolId &&
            (!course.schools ||
                !course.schools.some((s) => s.id === req.user.schoolId))) {
            return res.status(403).json({ error: "Access denied" });
        }
        // 🧹 Auto-cleanup Duplicate Lessons (REMOVED: Was dangerously deleting lessons with the same title)
        // If student, calculate course XP stats!
        let xpData = null;
        if (req.user.role === "STUDENT") {
            const userId = req.user.id;
            const lessonIds = course.lessons.map((l) => l.id);
            const examIds = course.exams.map((e) => e.id);
            // Fetch all XPHistory for these lessons and exams
            const histories = yield prisma_1.default.xPHistory.findMany({
                where: {
                    userId,
                    OR: [
                        {
                            sourceId: { in: lessonIds },
                            sourceType: {
                                in: ["LESSON_SLIDE", "LESSON_ASSIGNMENT", "LESSON_QUIZ"],
                            },
                        },
                        { sourceId: { in: examIds }, sourceType: "EXAM" },
                    ],
                },
            });
            const lessonXPMap = {};
            const examXPMap = {};
            let totalCourseXP = 0;
            histories.forEach((h) => {
                totalCourseXP += h.xp;
                if (h.sourceType.startsWith("LESSON_")) {
                    lessonXPMap[h.sourceId] = (lessonXPMap[h.sourceId] || 0) + h.xp;
                }
                else if (h.sourceType === "EXAM") {
                    examXPMap[h.sourceId] = (examXPMap[h.sourceId] || 0) + h.xp;
                }
            });
            // Calculate unit (domain) XP
            const domainXPMap = {};
            course.lessons.forEach((l) => {
                var _a;
                const domainName = ((_a = l.domain) === null || _a === void 0 ? void 0 : _a.trim()) || "";
                const xp = lessonXPMap[l.id] || 0;
                domainXPMap[domainName] = (domainXPMap[domainName] || 0) + xp;
            });
            xpData = {
                totalCourseXP,
                lessonXP: lessonXPMap,
                examXP: examXPMap,
                domainXP: domainXPMap,
            };
        }
        const slidesCountByLessonId = new Map();
        if (includeSlideCounts && course.lessons.length > 0) {
            const slideCounts = yield prisma_1.default.$queryRaw `
        SELECT
          "id",
          CASE
            WHEN jsonb_typeof(COALESCE("slides", '[]'::jsonb)) = 'array'
              THEN jsonb_array_length("slides")
            ELSE 0
          END AS "slidesCount"
        FROM "Lesson"
        WHERE "courseId" = ${courseId} AND "deletedAt" IS NULL
      `;
            slideCounts.forEach(({ id, slidesCount }) => {
                slidesCountByLessonId.set(id, Number(slidesCount) || 0);
            });
        }
        const responseLessons = summaryOnly
            ? course.lessons.map((lesson) => (Object.assign(Object.assign({}, lesson), (includeSlideCounts ? { slidesCount: slidesCountByLessonId.get(lesson.id) || 0 } : {}))))
            : course.lessons;
        if (countsOnly) {
            return res.json({
                lessonSlideCounts: responseLessons.map((lesson) => ({
                    id: lesson.id,
                    slidesCount: lesson.slidesCount || 0,
                })),
            });
        }
        res.json(Object.assign(Object.assign({}, course), { lessons: responseLessons, lessonsAreSummaries: summaryOnly, xpData }));
    }
    catch (error) {
        res.status(500).json({ error: "Error fetching course details" });
    }
});
exports.getCourseHandler30 = getCourseHandler30;
const getCourseHandler31 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id },
            include: {
                progresses: req.user.role === "SUPER_ADMIN"
                    ? false
                    : {
                        where: { userId: req.user.id },
                    },
            },
        });
        if (!lesson) {
            return res.status(404).json({ error: "Lesson not found" });
        }
        // Basic access check: must have access to the parent course
        const course = yield prisma_1.default.course.findUnique({
            where: { id: lesson.courseId },
            include: {
                schools: { select: { id: true } },
                enrollments: req.user.role === "STUDENT"
                    ? { where: { studentId: req.user.id }, select: { id: true } }
                    : false,
            },
        });
        if (course) {
            const isStaff = ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"].includes(req.user.role);
            const courseGradeTargets = (0, shared_1.parseStringArray)(course.grades);
            if (course.grade)
                courseGradeTargets.push(course.grade);
            const studentGrades = (0, shared_1.getStudentGradeAndStage)(req.user.grade);
            const matchesCourseGrade = courseGradeTargets.length === 0 ||
                courseGradeTargets.some((g) => studentGrades.includes(g));
            const hasSchoolAccess = req.user.schoolId &&
                (course.schoolId === req.user.schoolId ||
                    (course.schools &&
                        course.schools.some((s) => s.id === req.user.schoolId)));
            const hasEnrollmentAccess = Array.isArray(course.enrollments) &&
                course.enrollments.length > 0;
            const canAccess = isStaff ||
                course.isCentral ||
                (hasSchoolAccess && matchesCourseGrade) ||
                hasEnrollmentAccess;
            if (!canAccess) {
                return res.status(403).json({ error: "Access denied" });
            }
        }
        let lessonQuestionsForResponse = lesson.questions;
        if (req.user.role === "STUDENT" && lesson.questions) {
            let parsedQuestions = [];
            try {
                parsedQuestions =
                    (typeof lesson.questions === "string"
                        ? JSON.parse(lesson.questions)
                        : lesson.questions) || [];
            }
            catch (e) {
                parsedQuestions = [];
            }
            if (Array.isArray(parsedQuestions)) {
                const difficultyMap = {
                    Easy: 1,
                    Medium: 2,
                    Hard: 3,
                    Foundation: 1,
                    "On Level": 2,
                    Advanced: 3,
                };
                parsedQuestions.sort((a, b) => {
                    const diffA = difficultyMap[a.level || "Medium"] || 2;
                    const diffB = difficultyMap[b.level || "Medium"] || 2;
                    return diffA - diffB;
                });
                // Hide correct answers (commented out to support client-side Quiz Me self-evaluation)
                parsedQuestions = parsedQuestions.map((q) => {
                    const qPayload = Object.assign({}, q);
                    // delete qPayload.correctAnswer;
                    // delete qPayload.correctAnswers;
                    // delete qPayload.explanation;
                    return qPayload;
                });
                lessonQuestionsForResponse = parsedQuestions;
            }
        }
        let xpData = null;
        if (req.user.role === "STUDENT") {
            const userId = req.user.id;
            // Fetch all XPHistory for this lesson
            const histories = yield prisma_1.default.xPHistory.findMany({
                where: { userId, sourceId: id },
            });
            // Build maps of questionId -> hasFirstAttemptCorrect, attemptedCount, earnedXP
            const firstCorrectMap = {};
            const attemptedMap = {};
            const earnedXPMap = {};
            histories.forEach((h) => {
                if (!h.isBonus) {
                    attemptedMap[h.questionId] = (attemptedMap[h.questionId] || 0) + 1;
                    if (h.attemptNum === 1 && h.isCorrect) {
                        firstCorrectMap[h.questionId] = true;
                    }
                    if (h.xp > 0) {
                        earnedXPMap[h.questionId] = (earnedXPMap[h.questionId] || 0) + h.xp;
                    }
                }
            });
            // Calculate streak per blockType
            const getStreakForSet = (blocksJson, sourceType) => {
                let blocks = [];
                try {
                    blocks = blocksJson
                        ? typeof blocksJson === "string"
                            ? JSON.parse(blocksJson)
                            : blocksJson
                        : [];
                }
                catch (e) {
                    blocks = [];
                }
                const setAttempts = histories.filter((h) => h.sourceType === sourceType && h.attemptNum === 1 && !h.isBonus);
                const setAttemptsMap = new Map(setAttempts.map((a) => [a.questionId, a]));
                let currentStreak = 0;
                for (let i = 0; i < blocks.length; i++) {
                    const b = blocks[i];
                    if (b.type !== "QUESTION" && b.label !== "QUESTION")
                        continue;
                    const qId = b.id ? String(b.id) : String(i);
                    const attempt = setAttemptsMap.get(qId);
                    if (!attempt)
                        break;
                    if (attempt.isCorrect) {
                        currentStreak++;
                    }
                    else {
                        currentStreak = 0;
                    }
                }
                return currentStreak;
            };
            xpData = {
                totalLessonXP: histories.reduce((sum, h) => sum + h.xp, 0),
                firstCorrect: firstCorrectMap,
                attempts: attemptedMap,
                earnedXP: earnedXPMap,
                streaks: {
                    slides: getStreakForSet(lesson.slides, "LESSON_SLIDE"),
                    assignments: getStreakForSet(lesson.assignments, "LESSON_ASSIGNMENT"),
                    questions: getStreakForSet(lesson.questions, "LESSON_QUIZ"),
                },
            };
        }
        res.json(Object.assign(Object.assign({}, lesson), { questions: lessonQuestionsForResponse, xpData }));
    }
    catch (error) {
        console.error("Error fetching lesson:", error);
        res.status(500).json({ error: "Error fetching lesson details" });
    }
});
exports.getCourseHandler31 = getCourseHandler31;
const postCourseHandler32 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { studentId, courseId } = req.body;
        // Ensure course belongs to this school
        const course = yield prisma_1.default.course.findUnique({
            where: { id: courseId },
        });
        if (!course || course.schoolId !== req.user.schoolId) {
            return res
                .status(403)
                .json({ error: "Course does not belong to your school." });
        }
        const enrollment = yield prisma_1.default.studentEnrollment.create({
            data: { studentId, courseId },
        });
        res.json(enrollment);
    }
    catch (error) {
        res.status(500).json({ error: "Error enrolling student" });
    }
});
exports.postCourseHandler32 = postCourseHandler32;
// Automatic title-based deduplication is disabled — deduplication is preview/manual only
function previewDeduplication() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const lessons = yield prisma_1.default.lesson.findMany({
                where: { deletedAt: null },
                select: {
                    id: true,
                    title: true,
                    courseId: true,
                    slides: true,
                    questions: true,
                    assignments: true,
                    attachments: true,
                    updatedAt: true,
                    createdAt: true,
                    course: { select: { title: true, schoolId: true } },
                },
            });
            const lessonGroups = new Map();
            for (const lesson of lessons) {
                const key = `${lesson.courseId}_${lesson.title.trim().toLowerCase()}`;
                if (!lessonGroups.has(key))
                    lessonGroups.set(key, []);
                lessonGroups.get(key).push(lesson);
            }
            const collisionGroups = [];
            for (const [key, group] of lessonGroups.entries()) {
                if (group.length > 1) {
                    group.sort((a, b) => {
                        const getScore = (item) => {
                            let count = 0;
                            try {
                                const s = typeof item.slides === "string"
                                    ? JSON.parse(item.slides)
                                    : item.slides || [];
                                const q = typeof item.questions === "string"
                                    ? JSON.parse(item.questions)
                                    : item.questions || [];
                                const a_ = typeof item.assignments === "string"
                                    ? JSON.parse(item.assignments)
                                    : item.assignments || [];
                                count += (Array.isArray(s) ? s.length : 0) * 1;
                                count += (Array.isArray(q) ? q.length : 0) * 2;
                                count += (Array.isArray(a_) ? a_.length : 0) * 3;
                            }
                            catch (e) { }
                            return count;
                        };
                        const scoreA = getScore(a);
                        const scoreB = getScore(b);
                        if (scoreA !== scoreB)
                            return scoreB - scoreA;
                        return (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                    });
                    collisionGroups.push({
                        courseId: group[0].courseId,
                        courseTitle: (_a = group[0].course) === null || _a === void 0 ? void 0 : _a.title,
                        schoolId: (_b = group[0].course) === null || _b === void 0 ? void 0 : _b.schoolId,
                        normalizedTitle: group[0].title.trim().toLowerCase(),
                        lessons: group.map((l) => ({
                            id: l.id,
                            title: l.title,
                            updatedAt: l.updatedAt,
                            createdAt: l.createdAt,
                        })),
                        recommendedToKeep: group[0].id,
                        recommendedToDelete: group.slice(1).map((l) => l.id),
                    });
                }
            }
            return {
                success: true,
                collisionGroups,
                totalCollisions: collisionGroups.length,
            };
        }
        catch (error) {
            console.error("Error in preview deduplication:", error);
            return { success: false, error };
        }
    });
}
