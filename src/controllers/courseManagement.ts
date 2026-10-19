import { previewDeduplication } from './courseDelivery';
import { metadataTranslations, LESSON_METADATA_FIELDS } from '../utils/bilingualMetadata';
import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";
import { verifyToken, checkRole, checkSchoolAccess } from "../middleware/auth";
import { isContentDeletionAllowed } from "../services/systemSettings.service";
import { removesSavedContent } from "../utils/contentDeletionPolicy";
import {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  getVideoDuration,
  hasRequiredFields,
  isAnswerCorrect,
  sanitizeDeep,
  sanitizeUser,
  sanitizeExam,
  diagnosticLogs,
  pushDiagnosticLog,
  ALL_ROLES,
  SCHOOL_MANAGED_ROLES,
  statsCache,
  CACHE_TTL,
  setCache,
  getCache,
  getStudentGradeAndStage,
  examMatchesStudent,
  buildStudentCourseWhere,
  loginAttempts,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  UPLOADS_DIR,
  userSafeSelect,
  isAllowedVideoUrl,
  sanitizeHtml,
  parseStringArray,
  normalizeLegacyCourses,
  extractAndSaveBase64Images,
} from "../shared";
import {
  syncCourseToCloud,
  getCloudCoursesIfCached,
  prefetchCloudCoursesInBackground,
} from "../lib/db-backup";
import {
  permanentlyDeleteQuestion,
  permanentlyDeleteLesson,
  permanentlyDeleteExam,
  permanentlyDeleteCourse,
  permanentlyDeleteUser,
} from "../services/trashDeleteHelper";

export const getCourseHandler1 = async (req: any, res: any) => {
    const result = await previewDeduplication();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: "Error generating deduplication preview" });
    }
  };


export const postCourseHandler2 = async (req: any, res: any) => {
    try {
      const { idsToDelete } = req.body;

      if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
        return res
          .status(400)
          .json({ error: "idsToDelete must be a non-empty array" });
      }

      const { count } = await prisma.lesson.updateMany({
        where: { id: { in: idsToDelete }, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      res.json({ success: true, deletedCount: count });
    } catch (error) {
      console.error("Error merging lessons:", error);
      res.status(500).json({ error: "Error merging lessons" });
    }
  };


export const postCourseHandler3 = async (req: any, res: any) => {
    try {
      const { name, grade, schoolId, teacherId } = req.body;
      const classroom = await prisma.classroom.create({
        data: { name, grade, schoolId, teacherId },
      });
      res.json(classroom);
    } catch (error) {
      res.status(500).json({ error: "Error creating classroom" });
    }
  };


export const getCourseHandler4 = async (req: any, res: any) => {
    try {
      const { schoolId } = req.query;
      const classrooms = await prisma.classroom.findMany({
        where: { schoolId: schoolId as string },
        include: {
          teacher: { select: { name: true } },
          _count: { select: { students: true } },
        },
      });
      res.json(classrooms);
    } catch (error) {
      res.status(500).json({ error: "Error fetching classrooms" });
    }
  };


export const deleteCourseHandler5 = async (req: any, res: any) => {
    try {
      const classroom = await prisma.classroom.findUnique({
        where: { id: req.params.id },
      });
      if (!classroom)
        return res.status(404).json({ error: "Classroom not found" });
      if (
        req.user.role === "SCHOOL_ADMIN" &&
        classroom.schoolId !== req.user.schoolId
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      await prisma.classroom.delete({ where: { id: req.params.id } });
      res.json({ message: "Classroom deleted" });
    } catch (error) {
      res.status(500).json({ error: "Error deleting classroom" });
    }
  };


export const postCourseHandler6 = async (req: any, res: any) => {
    try {
      const { name, grade, schoolId, teacherName, subject } = req.body;

      let teacherId = req.body.teacherId || null;
      if (!teacherId && teacherName) {
        const teacherUser = await prisma.user.findFirst({
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

      const classroom = await prisma.classroom.create({
        data: {
          name: finalName,
          grade,
          schoolId,
          teacherId,
        },
      });
      res.json(classroom);
    } catch (error) {
      console.error("Error creating classroom alias:", error);
      res.status(500).json({ error: "Error creating classroom" });
    }
  };


export const getCourseHandler7 = async (req: any, res: any) => {
  try {
    const { schoolId } = req.query;
    if (!schoolId) {
      return res.status(400).json({ error: "schoolId is required" });
    }
    const classrooms = await prisma.classroom.findMany({
      where: { schoolId: schoolId as string },
      include: {
        teacher: { select: { name: true } },
        _count: { select: { students: true } },
      },
    });

    res.json(
      classrooms.map((c) => {
        const parts = c.name.split(" | ");
        return {
          id: c.id,
          name: parts[0],
          grade: c.grade,
          subject: parts[1] || "عام",
          teacherName: c.teacher?.name || "",
          studentsCount: c._count.students,
        };
      }),
    );
  } catch (error) {
    console.error("Error fetching classrooms alias:", error);
    res.status(500).json({ error: "Error fetching classrooms" });
  }
};


export const deleteCourseHandler8 = async (req: any, res: any) => {
    try {
      const classroom = await prisma.classroom.findUnique({
        where: { id: req.params.id },
      });
      if (!classroom)
        return res.status(404).json({ error: "Classroom not found" });
      if (
        (req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
        classroom.schoolId !== req.user.schoolId
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      await prisma.classroom.delete({ where: { id: req.params.id } });
      res.json({ message: "Classroom deleted" });
    } catch (error) {
      console.error("Error deleting classroom alias:", error);
      res.status(500).json({ error: "Error deleting classroom" });
    }
  };


export const putCourseHandler9 = async (req: any, res: any) => {
    try {
      const { name, grade, schoolId, teacherName, subject } = req.body;
      const classroom = await prisma.classroom.findUnique({
        where: { id: req.params.id },
      });
      if (!classroom)
        return res.status(404).json({ error: "Classroom not found" });
      if (
        (req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
        classroom.schoolId !== req.user.schoolId
      ) {
        return res.status(403).json({ error: "Access denied" });
      }

      let teacherId = req.body.teacherId || null;
      if (!teacherId && teacherName) {
        const teacherUser = await prisma.user.findFirst({
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

      const updated = await prisma.classroom.update({
        where: { id: req.params.id },
        data: {
          name: finalName,
          grade,
          teacherId,
        },
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating classroom alias:", error);
      res.status(500).json({ error: "Error updating classroom" });
    }
  };


export const postCourseHandler10 = async (req: any, res: any) => {
    try {
      const { name, username, password, role, grade } = req.body;
      const missing = hasRequiredFields(req.body, [
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
      if (!SCHOOL_MANAGED_ROLES.includes(role)) {
        return res
          .status(403)
          .json({
            error: "غير مسموح بإنشاء مستخدم بهذه الصلاحية من هذا المسار.",
          });
      }

      const schoolId =
        req.user.role === "SCHOOL_ADMIN"
          ? req.user.schoolId
          : req.body.schoolId;
      if (!schoolId)
        return res.status(400).json({ error: "schoolId is required." });

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          name,
          username,
          password: hashedPassword,
          role,
          schoolId,
          grade,
        },
        select: userSafeSelect,
      });
      res.json({ message: "User created for school", user });
    } catch (error) {
      res.status(500).json({ error: "Error creating user" });
    }
  };


export const postCourseHandler11 = async (req: any, res: any) => {
    try {
      const {
        title,
        description,
        coverImage,
        grade,
        grades,
        subject,
        country,
        isCentral,
        schoolId,
        schoolIds,
        lessons,
      } = req.body;
      const missing = hasRequiredFields(req.body, ["title"]);
      if (missing) {
        return res
          .status(400)
          .json({ error: `Missing required fields: ${missing.join(", ")}` });
      }
      if (
        (req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
        isCentral
      ) {
        return res
          .status(403)
          .json({ error: "Only Super Admin can create central courses." });
      }

      // Determine the target school ID
      const rawCreateSchoolList = schoolIds !== undefined ? schoolIds : (schoolId ? [schoolId] : []);
      const sanitizedCreateSchoolIds: string[] = (Array.isArray(rawCreateSchoolList) ? rawCreateSchoolList : [rawCreateSchoolList])
        .map((sid: any) => (typeof sid === "object" && sid ? sid.id : sid))
        .filter((sid: any): sid is string => Boolean(sid && typeof sid === "string" && sid !== "null" && sid !== "undefined" && sid.trim() !== ""))
        .map((sid: string) => sid.trim());

      const targetSchoolId =
        req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER"
          ? req.user.schoolId
          : isCentral
            ? null
            : (sanitizedCreateSchoolIds.length > 0 ? sanitizedCreateSchoolIds[0] : (schoolId && schoolId !== "null" && typeof schoolId === "string" && schoolId.trim() !== "" ? schoolId.trim() : null)) || req.user.schoolId;

      // Check if duplicate course already exists in the target school
      const existingCourse = await prisma.course.findFirst({
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
      const lessonsData = await Promise.all(
        (lessons || []).map(async (lesson: any, index: number) => {
          if (lesson.videoUrl && !isAllowedVideoUrl(lesson.videoUrl)) {
            throw new Error(
              "Only HTTPS YouTube/Vimeo URLs are allowed for lessons.",
            );
          }
          const duration = await getVideoDuration(lesson.videoUrl || "");
          const sanitizedLesson = sanitizeDeep(lesson);
          return {
            title: sanitizedLesson.title,
            domain: sanitizedLesson.domain || null,
            ...metadataTranslations(sanitizedLesson, sanitizeHtml, LESSON_METADATA_FIELDS),
            content: sanitizedLesson.content ?? null,
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
            isVisible:
              sanitizedLesson.isVisible !== undefined
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
        }),
      );

      // Create course and its lessons in a transaction
      const course = await prisma.$transaction(async (tx) => {
        const newCourse = await tx.course.create({
          data: {
            title,
            description: description ? sanitizeDeep(description) : null,
            coverImage: coverImage ? sanitizeDeep(coverImage) : null,
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
            schools:
              req.user.role === "SUPER_ADMIN" &&
              !isCentral &&
              sanitizedCreateSchoolIds.length > 0
                ? { connect: sanitizedCreateSchoolIds.map((id: string) => ({ id })) }
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
      });

      // Real-time Dual-Write: Instantly sync newly added course to Cloud Backup cloud database
      // Awaiting this guarantees the UI won't redirect until the cloud is updated.
      if (course?.id) await syncCourseToCloud(course.id).catch(() => {});

      res.json(course);
    } catch (error: any) {
      console.error("Error creating course:", error);
      res
        .status(500)
        .json({ error: "Error creating course", details: error.message });
    }
  };


export const putCourseHandler12 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        coverImage,
        grade,
        grades,
        subject,
        country,
        isCentral,
        schoolId,
        schoolIds,
        lessons,
      } = req.body;

      if (lessons !== undefined && !Array.isArray(lessons)) {
        return res.status(400).json({ error: "lessons must be an array when provided." });
      }

      // Authorization check
      const existingCourse = await prisma.course.findUnique({
        where: { id },
        include: { schools: true },
      });
      if (!existingCourse)
        return res.status(404).json({ error: "Course not found" });

      if (
        (req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
        existingCourse.schoolId !== req.user.schoolId &&
        (!existingCourse.schools ||
          !existingCourse.schools.some((s: any) => s.id === req.user.schoolId))
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (
        (req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER") &&
        (isCentral || (schoolId && schoolId !== req.user.schoolId))
      ) {
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

      const existingLessons = await prisma.lesson.findMany({
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

      const removesContent = Array.isArray(lessons) && lessons.some((lesson: any) => {
        const previous = existingLessonsMap.get(String(lesson.id));
        return previous && (['questions', 'assignments', 'slides'] as const)
          .some(field => lesson[field] != null && removesSavedContent(previous[field], lesson[field]));
      });
      if (removesContent && req.user.role !== "SUPER_ADMIN" && !await isContentDeletionAllowed()) {
        return res.status(403).json({ error: "حذف المحتوى معطّل من الإدارة العامة. Content deletion is disabled by Super Admin." });
      }

      const lessonsData =
        lessons && Array.isArray(lessons)
          ? await Promise.all(
              (lessons as any[]).map(async (lesson: any, index: number) => {
                if (lesson.videoUrl && !isAllowedVideoUrl(lesson.videoUrl)) {
                  throw new Error(
                    "Only HTTPS YouTube/Vimeo URLs are allowed for lessons.",
                  );
                }

                let duration = 0;
                const existingLesson = lesson.id
                  ? existingLessonsMap.get(lesson.id)
                  : null;
                if (
                  existingLesson &&
                  existingLesson.videoUrl === lesson.videoUrl
                ) {
                  duration = existingLesson.duration || 0;
                } else {
                  duration = await getVideoDuration(lesson.videoUrl || "");
                }

                const sanitizedLesson = sanitizeDeep(lesson);
                const rawId = sanitizedLesson.id;
                const isExistingDbId =
                  rawId && existingLessonsMap.has(String(rawId));
                const cleanId = isExistingDbId ? String(rawId) : undefined;

                // 🔒 FIX: "isNotProvided" only treats null/undefined as "not sent by frontend".
                // An empty array [] means the user intentionally cleared the field — we must
                // respect that and NOT fall back to the stale DB value.
                // Previously this was "isEmpty" which included [] and '[]', causing stale data
                // from the DB to silently overwrite what the frontend sent.
                const isNotProvided = (v: any) => v === null || v === undefined;

                // Parse frontend-sent JSON strings back to arrays for the emptiness check
                const parseIfString = (v: any) => {
                  if (typeof v === "string") {
                    try {
                      return JSON.parse(v);
                    } catch {
                      return v;
                    }
                  }
                  return v;
                };

                const parsedQuestions = parseIfString(
                  sanitizedLesson.questions,
                );
                const parsedAssignments = parseIfString(
                  sanitizedLesson.assignments,
                );
                const parsedAttachments = parseIfString(
                  sanitizedLesson.attachments,
                );
                const parsedSlides = parseIfString(sanitizedLesson.slides);

                // Debug log — visible in Dokploy container logs
                console.log(
                  `[Course PUT] Lesson "${sanitizedLesson.title}" (id=${cleanId || "NEW"}) | ` +
                    `questions=${Array.isArray(parsedQuestions) ? parsedQuestions.length : isNotProvided(parsedQuestions) ? "NOT_PROVIDED" : typeof parsedQuestions} | ` +
                    `assignments=${Array.isArray(parsedAssignments) ? parsedAssignments.length : isNotProvided(parsedAssignments) ? "NOT_PROVIDED" : typeof parsedAssignments}`,
                );

                return {
                  id: cleanId,
                  title: sanitizedLesson.title || "Untitled Lesson",
                  domain: sanitizedLesson.domain || null,
            ...metadataTranslations(sanitizedLesson, sanitizeHtml, LESSON_METADATA_FIELDS),
                  content: extractAndSaveBase64Images(
                    sanitizedLesson.content !== undefined
                      ? sanitizedLesson.content
                      : cleanId
                        ? (existingLessonsMap.get(cleanId)?.content ?? null)
                        : null,
                  ),
                  videoUrl: sanitizedLesson.videoUrl || null,
                  duration,
                  summary: sanitizedLesson.summary || null,
                  notes: sanitizedLesson.notes || null,
                  questions: isNotProvided(parsedQuestions)
                    ? cleanId
                      ? (existingLessonsMap.get(cleanId)?.questions ?? null)
                      : null
                    : extractAndSaveBase64Images(parsedQuestions),
                  assignments: isNotProvided(parsedAssignments)
                    ? cleanId
                      ? (existingLessonsMap.get(cleanId)?.assignments ?? null)
                      : null
                    : extractAndSaveBase64Images(parsedAssignments),
                  attachments: isNotProvided(parsedAttachments)
                    ? cleanId
                      ? (existingLessonsMap.get(cleanId)?.attachments ?? null)
                      : null
                    : extractAndSaveBase64Images(parsedAttachments),
                  slides: isNotProvided(parsedSlides)
                    ? cleanId
                      ? (existingLessonsMap.get(cleanId)?.slides ?? null)
                      : null
                    : extractAndSaveBase64Images(parsedSlides),
                  standards: sanitizedLesson.standards || null,
                  indicators: sanitizedLesson.indicators || null,
                  learningOutcomes: sanitizedLesson.learningOutcomes || null,
                  isCentral:
                    req.user.role === "SUPER_ADMIN" ? !!isCentral : false,
                  isVisible:
                    sanitizedLesson.isVisible !== undefined
                      ? !!sanitizedLesson.isVisible
                      : true,
                  publishDate:
                    sanitizedLesson.publishDate &&
                    !isNaN(new Date(sanitizedLesson.publishDate).getTime())
                      ? new Date(sanitizedLesson.publishDate)
                      : null,
                  cutOffDate:
                    sanitizedLesson.cutOffDate &&
                    !isNaN(new Date(sanitizedLesson.cutOffDate).getTime())
                      ? new Date(sanitizedLesson.cutOffDate)
                      : null,
                  order: index,
                  courseId: id,
                };
              }),
            )
          : null;

      console.log("[Course PUT] Raw schoolIds:", JSON.stringify(schoolIds), "schoolId:", schoolId);

      const rawSchoolList = schoolIds !== undefined ? schoolIds : (schoolId ? [schoolId] : []);
      const sanitizedSchoolIds: string[] = (Array.isArray(rawSchoolList) ? rawSchoolList : [rawSchoolList])
        .map((sid: any) => (typeof sid === "object" && sid ? sid.id : sid))
        .filter((sid: any): sid is string => Boolean(sid && typeof sid === "string" && sid !== "null" && sid !== "undefined" && sid.trim() !== ""))
        .map((sid: string) => sid.trim());

      const updatedCourse = await prisma.$transaction(
        async (tx) => {
          await tx.course.update({
            where: { id },
            data: {
              title,
              description: description ? sanitizeDeep(description) : null,
              coverImage: coverImage
                ? extractAndSaveBase64Images(sanitizeDeep(coverImage))
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
              schoolId:
                req.user.role === "SCHOOL_ADMIN" || req.user.role === "TEACHER"
                  ? (req.user.schoolId || existingCourse.schoolId)
                  : isCentral
                    ? null
                    : (sanitizedSchoolIds.length > 0 ? sanitizedSchoolIds[0] : (schoolId && schoolId !== "null" && typeof schoolId === "string" && schoolId.trim() !== "" ? schoolId.trim() : null)),
              schools:
                req.user.role === "SUPER_ADMIN" && isCentral
                  ? { set: [] }
                  : req.user.role === "SUPER_ADMIN" && !isCentral && (schoolIds !== undefined || schoolId !== undefined)
                    ? {
                        set: sanitizedSchoolIds.map((sid: string) => ({ id: sid })),
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

          const usedExistingIds = new Set<string>();
          const processedLessonIds = new Set<string>();

          for (const lesson of lessonsData) {
            if (lesson.id && existingLessonsMap.has(lesson.id)) {
              if (processedLessonIds.has(lesson.id)) {
                continue;
              }
              const { id: lessonId, ...updateData } = lesson;
              await tx.lesson.update({
                where: { id: lessonId },
                data: updateData,
              });
              usedExistingIds.add(lessonId);
              processedLessonIds.add(lessonId);
              continue;
            }

            const { id: _, ...createData } = lesson;
            const createdLesson = await tx.lesson.create({
              data: {
                ...createData,
                id:
                  typeof lesson.id === "string" && lesson.id.length > 20
                    ? lesson.id
                    : undefined,
              },
            });
            if (createdLesson?.id) {
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
        },
        { timeout: 30000 },
      );

      if (id) await syncCourseToCloud(id).catch(() => {});

      res.json(updatedCourse);
    } catch (error: any) {
      console.error("Error updating course:", error);
      res
        .status(500)
        .json({ error: "Error updating course", details: error.message });
    }
  };


