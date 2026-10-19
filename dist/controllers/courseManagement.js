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
exports.putCourseHandler12 = exports.postCourseHandler11 = exports.postCourseHandler10 = exports.putCourseHandler9 = exports.deleteCourseHandler8 = exports.getCourseHandler7 = exports.postCourseHandler6 = exports.deleteCourseHandler5 = exports.getCourseHandler4 = exports.postCourseHandler3 = exports.postCourseHandler2 = exports.getCourseHandler1 = void 0;
const courseDelivery_1 = require("./courseDelivery");
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const systemSettings_service_1 = require("../services/systemSettings.service");
const contentDeletionPolicy_1 = require("../utils/contentDeletionPolicy");
const shared_1 = require("../shared");
const db_backup_1 = require("../lib/db-backup");
const getCourseHandler1 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield (0, courseDelivery_1.previewDeduplication)();
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
            return Object.assign(Object.assign({ title: sanitizedLesson.title, domain: sanitizedLesson.domain || null }, (0, bilingualMetadata_1.metadataTranslations)(sanitizedLesson, shared_1.sanitizeHtml, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { content: (_a = sanitizedLesson.content) !== null && _a !== void 0 ? _a : null, videoUrl: sanitizedLesson.videoUrl, duration: duration, summary: sanitizedLesson.summary, notes: sanitizedLesson.notes, questions: sanitizedLesson.questions
                    ? sanitizedLesson.questions
                    : null, assignments: sanitizedLesson.assignments
                    ? sanitizedLesson.assignments
                    : null, attachments: sanitizedLesson.attachments
                    ? sanitizedLesson.attachments
                    : null, slides: sanitizedLesson.slides ? sanitizedLesson.slides : null, standards: sanitizedLesson.standards || null, indicators: sanitizedLesson.indicators || null, learningOutcomes: sanitizedLesson.learningOutcomes || null, creatorId: req.user.id, isCentral: req.user.role === "SUPER_ADMIN" ? !!isCentral : false, isVisible: sanitizedLesson.isVisible !== undefined
                    ? !!sanitizedLesson.isVisible
                    : true, publishDate: sanitizedLesson.publishDate
                    ? new Date(sanitizedLesson.publishDate)
                    : null, cutOffDate: sanitizedLesson.cutOffDate
                    ? new Date(sanitizedLesson.cutOffDate)
                    : null, order: index });
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
        const removesContent = Array.isArray(lessons) && lessons.some((lesson) => {
            const previous = existingLessonsMap.get(String(lesson.id));
            return previous && ['questions', 'assignments', 'slides']
                .some(field => lesson[field] != null && (0, contentDeletionPolicy_1.removesSavedContent)(previous[field], lesson[field]));
        });
        if (removesContent && req.user.role !== "SUPER_ADMIN" && !(yield (0, systemSettings_service_1.isContentDeletionAllowed)())) {
            return res.status(403).json({ error: "حذف المحتوى معطّل من الإدارة العامة. Content deletion is disabled by Super Admin." });
        }
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
                return Object.assign(Object.assign({ id: cleanId, title: sanitizedLesson.title || "Untitled Lesson", domain: sanitizedLesson.domain || null }, (0, bilingualMetadata_1.metadataTranslations)(sanitizedLesson, shared_1.sanitizeHtml, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { content: (0, shared_1.extractAndSaveBase64Images)(sanitizedLesson.content !== undefined
                        ? sanitizedLesson.content
                        : cleanId
                            ? ((_b = (_a = existingLessonsMap.get(cleanId)) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : null)
                            : null), videoUrl: sanitizedLesson.videoUrl || null, duration, summary: sanitizedLesson.summary || null, notes: sanitizedLesson.notes || null, questions: isNotProvided(parsedQuestions)
                        ? cleanId
                            ? ((_d = (_c = existingLessonsMap.get(cleanId)) === null || _c === void 0 ? void 0 : _c.questions) !== null && _d !== void 0 ? _d : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedQuestions), assignments: isNotProvided(parsedAssignments)
                        ? cleanId
                            ? ((_f = (_e = existingLessonsMap.get(cleanId)) === null || _e === void 0 ? void 0 : _e.assignments) !== null && _f !== void 0 ? _f : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedAssignments), attachments: isNotProvided(parsedAttachments)
                        ? cleanId
                            ? ((_h = (_g = existingLessonsMap.get(cleanId)) === null || _g === void 0 ? void 0 : _g.attachments) !== null && _h !== void 0 ? _h : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedAttachments), slides: isNotProvided(parsedSlides)
                        ? cleanId
                            ? ((_k = (_j = existingLessonsMap.get(cleanId)) === null || _j === void 0 ? void 0 : _j.slides) !== null && _k !== void 0 ? _k : null)
                            : null
                        : (0, shared_1.extractAndSaveBase64Images)(parsedSlides), standards: sanitizedLesson.standards || null, indicators: sanitizedLesson.indicators || null, learningOutcomes: sanitizedLesson.learningOutcomes || null, isCentral: req.user.role === "SUPER_ADMIN" ? !!isCentral : false, isVisible: sanitizedLesson.isVisible !== undefined
                        ? !!sanitizedLesson.isVisible
                        : true, publishDate: sanitizedLesson.publishDate &&
                        !isNaN(new Date(sanitizedLesson.publishDate).getTime())
                        ? new Date(sanitizedLesson.publishDate)
                        : null, cutOffDate: sanitizedLesson.cutOffDate &&
                        !isNaN(new Date(sanitizedLesson.cutOffDate).getTime())
                        ? new Date(sanitizedLesson.cutOffDate)
                        : null, order: index, courseId: id });
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
                                set: sanitizedSchoolIds.map((sid) => ({ id: sid })),
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
