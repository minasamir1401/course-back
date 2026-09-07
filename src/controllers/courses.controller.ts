import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";
import { verifyToken, checkRole, checkSchoolAccess } from "../middleware/auth";
import {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  getVideoDuration,
  hasRequiredFields,
  isAnswerCorrect,
  sanitizeDeep,
  sanitizeUser,
  sanitizeExam,
  multerUpload,
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


export const postCourseHandler13 = async (req: any, res: any) => {
    try {
      const { targetCourseId } = req.body;
      if (!targetCourseId)
        return res.status(400).json({ error: "Target course ID is required" });

      const sourceLesson = await prisma.lesson.findUnique({
        where: { id: req.params.id },
      });
      if (!sourceLesson)
        return res.status(404).json({ error: "Source lesson not found" });

      const targetCourse = await prisma.course.findUnique({
        where: { id: targetCourseId },
        select: { id: true, _count: { select: { lessons: true } } },
      });
      if (!targetCourse)
        return res.status(404).json({ error: "Target course not found" });

      const newLesson = await prisma.lesson.create({
        data: {
          courseId: targetCourseId,
          title: sourceLesson.title + " (نسخة)",
          domain: sourceLesson.domain,
          content: sourceLesson.content,
          videoUrl: sourceLesson.videoUrl,
          duration: sourceLesson.duration,
          summary: sourceLesson.summary,
          notes: sourceLesson.notes,
          questions: sourceLesson.questions ?? undefined,
          attachments: sourceLesson.attachments ?? undefined,
          slides: sourceLesson.slides ?? undefined,
          assignments: sourceLesson.assignments ?? undefined,
          standards: sourceLesson.standards,
          indicators: sourceLesson.indicators,
          learningOutcomes: sourceLesson.learningOutcomes,
          isCentral: sourceLesson.isCentral,
          isVisible: sourceLesson.isVisible,
          order: (targetCourse._count.lessons || 0) + 1,
        },
      });

      res.json({ message: "Lesson copied successfully", lesson: newLesson });
    } catch (error: any) {
      console.error("Error copying lesson:", error);
      res
        .status(500)
        .json({ error: "Failed to copy lesson", details: error.message });
    }
  };


export const postCourseHandler14 = async (req: any, res: any) => {
    try {
      const { targetLessonId, sections } = req.body;
      if (!targetLessonId)
        return res.status(400).json({ error: "Target lesson ID is required" });
      if (!sections)
        return res.status(400).json({ error: "Sections object is required" });

      const sourceLesson = await prisma.lesson.findUnique({
        where: { id: req.params.id },
      });
      if (!sourceLesson)
        return res.status(404).json({ error: "Source lesson not found" });

      const targetLesson = await prisma.lesson.findUnique({
        where: { id: targetLessonId },
      });
      if (!targetLesson)
        return res.status(404).json({ error: "Target lesson not found" });

      const updateData: any = {};

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

      const processItems = (
        itemType: "slides" | "assignments" | "questions",
        indices: number[],
      ) => {
        if (indices && indices.length > 0) {
          let sourceItems: any[] = [];
          try {
            sourceItems =
              (typeof (sourceLesson as any)[itemType] === "string"
                ? JSON.parse((sourceLesson as any)[itemType])
                : (sourceLesson as any)[itemType]) || [];
          } catch (e) {}

          let targetItems: any[] = [];
          try {
            targetItems =
              (typeof (targetLesson as any)[itemType] === "string"
                ? JSON.parse((targetLesson as any)[itemType])
                : (targetLesson as any)[itemType]) || [];
          } catch (e) {}

          const itemsToCopy = indices
            .map((idx: number) => sourceItems[idx])
            .filter(Boolean)
            .map((item: any) => ({
              ...item,
              id: Date.now() + Math.random(),
            }));

          updateData[itemType] = [...targetItems, ...itemsToCopy];
        }
      };

      processItems("slides", sections.slideIndices);
      processItems("assignments", sections.assignmentIndices);
      processItems("questions", sections.questionIndices);

      if (Object.keys(updateData).length > 0) {
        const updatedLesson = await prisma.lesson.update({
          where: { id: targetLessonId },
          data: updateData,
        });
        res.json({
          message: "Data exported successfully",
          lesson: updatedLesson,
        });
      } else {
        res.json({ message: "No data to export", lesson: targetLesson });
      }
    } catch (error: any) {
      console.error("Error exporting lesson data:", error);
      res
        .status(500)
        .json({
          error: "Failed to export lesson data",
          details: error.message,
        });
    }
  };


export const postCourseHandler15 = async (req: any, res: any) => {
    try {
      const { targetLessonId, slideIndices, itemType = "slides" } = req.body;
      if (!targetLessonId)
        return res.status(400).json({ error: "Target lesson ID is required" });
      if (!["slides", "questions", "assignments"].includes(itemType))
        return res.status(400).json({ error: "Invalid itemType" });

      const sourceLesson = await prisma.lesson.findUnique({
        where: { id: req.params.id },
      });
      if (!sourceLesson)
        return res.status(404).json({ error: "Source lesson not found" });

      const targetLesson = await prisma.lesson.findUnique({
        where: { id: targetLessonId },
      });
      if (!targetLesson)
        return res.status(404).json({ error: "Target lesson not found" });

      let sourceItems: any[] = [];
      try {
        sourceItems =
          (typeof (sourceLesson as any)[itemType] === "string"
            ? JSON.parse((sourceLesson as any)[itemType])
            : (sourceLesson as any)[itemType]) || [];
      } catch (e) {}

      let targetItems: any[] = [];
      try {
        targetItems =
          (typeof (targetLesson as any)[itemType] === "string"
            ? JSON.parse((targetLesson as any)[itemType])
            : (targetLesson as any)[itemType]) || [];
      } catch (e) {}

      const itemsToCopy =
        Array.isArray(slideIndices) && slideIndices.length > 0
          ? slideIndices.map((i: number) => sourceItems[i]).filter(Boolean)
          : sourceItems;

      if (itemsToCopy.length === 0) {
        return res.status(400).json({ error: "No items found to copy" });
      }

      const processedItems = itemsToCopy.map((s: any) => {
        const newItem = JSON.parse(JSON.stringify(s));
        newItem.id = Date.now() + Math.random(); // standard id pattern for questions/assignments
        if (itemType === "slides")
          newItem.blockId = `blk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        return newItem;
      });

      const updatedTargetItems = [...targetItems, ...processedItems];

      await prisma.lesson.update({
        where: { id: targetLessonId },
        data: { [itemType]: updatedTargetItems },
      });

      res.json({
        message: "Items copied successfully",
        copiedCount: processedItems.length,
      });
    } catch (error: any) {
      console.error("Error copying slides:", error);
      res
        .status(500)
        .json({ error: "Failed to copy slides", details: error.message });
    }
  };


export const getCourseHandler16 = async (req: any, res: any) => {
    try {
      const lesson = await prisma.lesson.findUnique({
        where: { id: req.params.id },
        select: { id: true, title: true, slides: true, courseId: true },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });
      let slidesArray: any[] = [];
      try {
        slidesArray =
          (typeof lesson.slides === "string"
            ? JSON.parse(lesson.slides)
            : lesson.slides) || [];
      } catch (e) {
        slidesArray = [];
      }
      res.json({
        id: lesson.id,
        title: lesson.title,
        courseId: lesson.courseId,
        slides: slidesArray,
        count: Array.isArray(slidesArray) ? slidesArray.length : 0,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({
          error: "Failed to read lesson slides",
          details: error.message,
        });
    }
  };


export const patchCourseHandler17 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { slides } = req.body;
      if (!slides)
        return res.status(400).json({ error: "slides field is required" });

      const lesson = await prisma.lesson.findUnique({
        where: { id },
        select: { id: true, courseId: true },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      const sanitizedSlides = sanitizeDeep(slides);
      const updated = await prisma.lesson.update({
        where: { id },
        data: { slides: sanitizedSlides as any },
        select: { id: true, title: true, slides: true },
      });

      let slidesArray: any[] = [];
      try {
        slidesArray =
          (typeof updated.slides === "string"
            ? JSON.parse(updated.slides)
            : updated.slides) || [];
      } catch (e) {}
      res.json({
        id: updated.id,
        title: updated.title,
        slides: slidesArray,
        count: Array.isArray(slidesArray) ? slidesArray.length : 0,
        message: "Slides updated successfully",
      });
    } catch (error: any) {
      console.error("Error updating lesson slides:", error);
      res
        .status(500)
        .json({
          error: "Failed to update lesson slides",
          details: error.message,
        });
    }
  };


export const patchCourseHandler18 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { questions } = req.body;
      if (questions === undefined)
        return res.status(400).json({ error: "questions field is required" });

      const lesson = await prisma.lesson.findUnique({
        where: { id },
        select: { id: true, courseId: true },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      const sanitizedQuestions = sanitizeDeep(questions);
      const updated = await prisma.lesson.update({
        where: { id },
        data: { questions: sanitizedQuestions as any },
        select: { id: true, title: true, questions: true },
      });

      let qArray: any[] = [];
      try {
        qArray =
          (typeof updated.questions === "string"
            ? JSON.parse(updated.questions)
            : updated.questions) || [];
      } catch (e) {}
      res.json({
        id: updated.id,
        title: updated.title,
        questions: qArray,
        count: Array.isArray(qArray) ? qArray.length : 0,
        message: "Questions updated successfully",
      });
    } catch (error: any) {
      console.error("Error updating lesson questions:", error);
      res
        .status(500)
        .json({
          error: "Failed to update lesson questions",
          details: error.message,
        });
    }
  };


export const patchCourseHandler19 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { assignments } = req.body;
      if (assignments === undefined)
        return res.status(400).json({ error: "assignments field is required" });

      const lesson = await prisma.lesson.findUnique({
        where: { id },
        select: { id: true, courseId: true },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      const sanitizedAssignments = sanitizeDeep(assignments);
      const updated = await prisma.lesson.update({
        where: { id },
        data: { assignments: sanitizedAssignments as any },
        select: { id: true, title: true, assignments: true },
      });

      let aArray: any[] = [];
      try {
        aArray =
          (typeof updated.assignments === "string"
            ? JSON.parse(updated.assignments)
            : updated.assignments) || [];
      } catch (e) {}
      res.json({
        id: updated.id,
        title: updated.title,
        assignments: aArray,
        count: Array.isArray(aArray) ? aArray.length : 0,
        message: "Assignments updated successfully",
      });
    } catch (error: any) {
      console.error("Error updating lesson assignments:", error);
      res
        .status(500)
        .json({
          error: "Failed to update lesson assignments",
          details: error.message,
        });
    }
  };


export const patchCourseHandler20 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { attachments } = req.body;
      if (attachments === undefined)
        return res.status(400).json({ error: "attachments field is required" });

      const lesson = await prisma.lesson.findUnique({
        where: { id },
        select: { id: true, courseId: true },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      const sanitizedAttachments = sanitizeDeep(attachments);
      const updated = await prisma.lesson.update({
        where: { id },
        data: { attachments: sanitizedAttachments as any },
        select: { id: true, title: true, attachments: true },
      });

      let attArray: any[] = [];
      try {
        attArray =
          (typeof updated.attachments === "string"
            ? JSON.parse(updated.attachments)
            : updated.attachments) || [];
      } catch (e) {}
      res.json({
        id: updated.id,
        title: updated.title,
        attachments: attArray,
        count: Array.isArray(attArray) ? attArray.length : 0,
        message: "Attachments updated successfully",
      });
    } catch (error: any) {
      console.error("Error updating lesson attachments:", error);
      res
        .status(500)
        .json({
          error: "Failed to update lesson attachments",
          details: error.message,
        });
    }
  };


export const deleteCourseHandler21 = async (req: any, res: any) => {
    try {
      const { id } = req.params;

      const lesson = await prisma.lesson.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          courseId: true,
          course: { select: { schoolId: true } },
        },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      if (
        req.user.role === "SCHOOL_ADMIN" &&
        lesson.course?.schoolId !== req.user.schoolId
      ) {
        return res
          .status(403)
          .json({
            error:
              "Access denied: You can only delete lessons belonging to your school.",
          });
      }

      // ♻️ Soft Delete: move to trash instead of hard delete to preserve student data
      await prisma.lesson.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // We no longer need tombstones for soft-deleted items, but keeping it for legacy support
      const { recordDeletedLesson } = await import("../lib/tombstones");
      await recordDeletedLesson(id, lesson.title);

      console.log(
        `🗑️  [Lesson Delete] SUPER_ADMIN manually deleted lesson "${lesson.title}" (${id}) from course ${lesson.courseId}`,
      );

      // Sync course to cloud after manual deletion
      if (lesson.courseId) {
        const { syncCourseToCloud } = await import("../lib/db-backup");
        syncCourseToCloud(lesson.courseId).catch(() => {});
      }

      res.json({
        message: "Lesson deleted successfully",
        lessonId: id,
        lessonTitle: lesson.title,
      });
    } catch (error: any) {
      console.error("Error deleting lesson:", error);
      res
        .status(500)
        .json({ error: "Error deleting lesson", details: error.message });
    }
  };


export const deleteCourseHandler22 = async (req: any, res: any) => {
    try {
      const { id } = req.params;

      // Authorization check
      const existingCourse = await prisma.course.findUnique({ where: { id } });
      if (!existingCourse) {
        // It's already deleted locally but still lingering in the Cloud Backup!
        // Force a full cloud sync to overwrite the cloud and clear the ghost course
        const { syncAllCoursesToCloud } = await import("../lib/db-backup");
        await syncAllCoursesToCloud("Ghost Course Cleanup");
        return res.json({
          message: "Ghost course cleared from cloud cache successfully",
        });
      }

      if (
        req.user.role === "SCHOOL_ADMIN" &&
        existingCourse.schoolId !== req.user.schoolId
      ) {
        return res
          .status(403)
          .json({
            error:
              "Access denied: You can only delete courses belonging to your school.",
          });
      }

      // ♻️ Soft Delete: move to trash instead of hard delete
      await prisma.course.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // We no longer need tombstones for soft-deleted items
      const { recordDeletedCourse } = await import("../lib/tombstones");
      await recordDeletedCourse(id, existingCourse.title);

      // Sync course to cloud after manual deletion so it doesn't reappear from cloud cache
      const { syncCourseToCloud } = await import("../lib/db-backup");
      await syncCourseToCloud(id).catch(() => {});

      res.json({ message: "Course deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: "Error deleting course" });
    }
  };


export const getCourseHandler23 = async (req: any, res: any) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const trashedCourses = await prisma.course.findMany({
        where: { deletedAt: { not: null } },
        select: { id: true, title: true, deletedAt: true, subject: true },
      });

      const trashedLessons = await prisma.lesson.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          title: true,
          deletedAt: true,
          course: { select: { title: true } },
        },
      });

      const trashedExams = await prisma.exam.findMany({
        where: { deletedAt: { not: null } },
        select: { id: true, title: true, deletedAt: true },
      });

      const trashedQuestions = await prisma.question.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          text: true,
          deletedAt: true,
          exam: { select: { title: true } },
        },
      });

      const trashedUsers = await prisma.user.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          deletedAt: true,
        },
      });

      const courses = trashedCourses.map((c) => ({ ...c, type: "course" }));
      const lessons = trashedLessons.map((l) => ({ ...l, type: "lesson" }));
      const exams = trashedExams.map((e) => ({ ...e, type: "exam" }));
      const questions = trashedQuestions.map((q) => ({
        ...q,
        title: q.text || "بدون نص",
        type: "question",
      }));
      const users = trashedUsers.map((u) => ({
        ...u,
        title: `${u.name} (${u.role})`,
        type: "user",
      }));

      const allItems = [
        ...courses,
        ...lessons,
        ...exams,
        ...questions,
        ...users,
      ];
      allItems.sort(
        (a, b) =>
          new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
      );

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
    } catch (error) {
      res.status(500).json({ error: "Error fetching trash" });
    }
  };


export const postCourseHandler24 = async (req: any, res: any) => {
    try {
      const { items } = req.body; // Array of { id, type }
      if (!Array.isArray(items))
        return res.status(400).json({ error: "Invalid items array" });

      let restored = 0;
      for (const item of items) {
        if (item.type === "course") {
          await prisma.course
            .update({ where: { id: item.id }, data: { deletedAt: null } })
            .catch(() => {});
        } else if (item.type === "lesson") {
          await prisma.lesson
            .update({ where: { id: item.id }, data: { deletedAt: null } })
            .catch(() => {});
        } else if (item.type === "exam") {
          await prisma.exam
            .update({ where: { id: item.id }, data: { deletedAt: null } })
            .catch(() => {});
        } else if (item.type === "question") {
          await prisma.question
            .update({ where: { id: item.id }, data: { deletedAt: null } })
            .catch(() => {});
        } else if (item.type === "user") {
          await prisma.user
            .update({ where: { id: item.id }, data: { deletedAt: null } })
            .catch(() => {});
        }
        restored++;
      }

      res.json({
        success: true,
        message: `Restored ${restored} items successfully`,
      });
    } catch (error) {
      console.error("Bulk restore error:", error);
      res.status(500).json({ error: "Error during bulk restore" });
    }
  };


export const deleteCourseHandler25 = async (req: any, res: any) => {
    try {
      const { type } = req.query; // optional: to empty specific type, else empty all

      let deletedCount = 0;

      if (!type || type === "all" || type === "question") {
        const questions = await prisma.question.findMany({
          where: { deletedAt: { not: null } },
          select: { id: true },
        });
        for (const q of questions) {
          const ok = await permanentlyDeleteQuestion(q.id);
          if (ok) deletedCount++;
        }
      }
      if (!type || type === "all" || type === "lesson") {
        const lessons = await prisma.lesson.findMany({
          where: { deletedAt: { not: null } },
          select: { id: true },
        });
        for (const l of lessons) {
          const ok = await permanentlyDeleteLesson(l.id);
          if (ok) deletedCount++;
        }
      }
      if (!type || type === "all" || type === "exam") {
        const exams = await prisma.exam.findMany({
          where: { deletedAt: { not: null } },
          select: { id: true },
        });
        for (const e of exams) {
          const ok = await permanentlyDeleteExam(e.id);
          if (ok) deletedCount++;
        }
      }
      if (!type || type === "all" || type === "course") {
        const courses = await prisma.course.findMany({
          where: { deletedAt: { not: null } },
          select: { id: true },
        });
        for (const c of courses) {
          const ok = await permanentlyDeleteCourse(c.id);
          if (ok) deletedCount++;
        }
      }
      if (!type || type === "all" || type === "user") {
        const users = await prisma.user.findMany({
          where: { deletedAt: { not: null } },
          select: { id: true },
        });
        for (const u of users) {
          const ok = await permanentlyDeleteUser(u.id);
          if (ok) deletedCount++;
        }
      }

      res.json({
        success: true,
        message: `Permanently deleted ${deletedCount} items.`,
      });
    } catch (error) {
      console.error("Empty trash error:", error);
      res.status(500).json({ error: "Error emptying trash" });
    }
  };

export const postTrashBulkDeleteHandler = async (req: any, res: any) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid items array" });
    }

    let deletedCount = 0;
    for (const item of items) {
      let ok = false;
      if (item.type === "course") ok = await permanentlyDeleteCourse(item.id);
      else if (item.type === "lesson") ok = await permanentlyDeleteLesson(item.id);
      else if (item.type === "exam") ok = await permanentlyDeleteExam(item.id);
      else if (item.type === "question") ok = await permanentlyDeleteQuestion(item.id);
      else if (item.type === "user") ok = await permanentlyDeleteUser(item.id);

      if (ok) deletedCount++;
    }

    res.json({
      success: true,
      message: `Permanently deleted ${deletedCount} items.`,
    });
  } catch (error) {
    console.error("Bulk trash delete error:", error);
    res.status(500).json({ error: "Error during bulk trash delete" });
  }
};

export const deleteTrashItemHandler = async (req: any, res: any) => {
  try {
    const { type, id } = req.params;
    let ok = false;
    if (type === "course") ok = await permanentlyDeleteCourse(id);
    else if (type === "lesson") ok = await permanentlyDeleteLesson(id);
    else if (type === "exam") ok = await permanentlyDeleteExam(id);
    else if (type === "question") ok = await permanentlyDeleteQuestion(id);
    else if (type === "user") ok = await permanentlyDeleteUser(id);

    if (ok) {
      res.json({ success: true, message: "Item permanently deleted." });
    } else {
      res.status(400).json({ error: "Failed to permanently delete item." });
    }
  } catch (error) {
    console.error("Single trash delete error:", error);
    res.status(500).json({ error: "Error deleting trash item" });
  }
};



export const postCourseHandler26 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      await prisma.course.update({
        where: { id },
        data: { deletedAt: null },
      });

      // Sync restored course to cloud
      const { syncCourseToCloud } = await import("../lib/db-backup");
      await syncCourseToCloud(id).catch(() => {});

      res.json({ message: "Course restored successfully from the Nile" });
    } catch (error) {
      res.status(500).json({ error: "Error restoring course" });
    }
  };


export const postCourseHandler27 = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const restoredLesson = await prisma.lesson.update({
        where: { id },
        data: { deletedAt: null },
      });

      // Sync restored course to cloud
      if (restoredLesson.courseId) {
        const { syncCourseToCloud } = await import("../lib/db-backup");
        await syncCourseToCloud(restoredLesson.courseId).catch(() => {});
      }

      res.json({ message: "Lesson restored successfully from the Nile" });
    } catch (error) {
      res.status(500).json({ error: "Error restoring lesson" });
    }
  };


export const getCourseHandler28 = async (req: any, res: any) => {
  try {
    const { isCentral, schoolId, page = "1", limit = "20", search } = req.query;

    const cacheKey = `courses_list_${req.user.role}_${req.user.schoolId || "none"}_${req.user.grade || "none"}_${isCentral}_${schoolId}_${page}_${limit}_${search || ""}`;

    // Only cache for students. Admins need real-time data to avoid "content not found" on deleted items.
    if (req.user.role === "STUDENT") {
      const cached = getCache(cacheKey);
      if (cached) return res.json(cached);
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const accessFilter: any = {};
    const userSchoolId = req.user.schoolId || (schoolId as string);

    if (isCentral === "true") {
      accessFilter.isCentral = true;
    } else if (isCentral === "false") {
      accessFilter.isCentral = false;
    }

    if (req.user.role === "SUPER_ADMIN") {
      if (schoolId) {
        accessFilter.OR = [
          { schoolId: schoolId as string },
          { schools: { some: { id: schoolId as string } } },
        ];
      }
    } else if (req.user.role === "SCHOOL_ADMIN") {
      if (userSchoolId) {
        accessFilter.OR = [
          { isCentral: true },
          { schoolId: userSchoolId },
          { schools: { some: { id: userSchoolId } } },
        ];
      }
    } else if (req.user.role === "TEACHER") {
      accessFilter.OR = [
        { creatorId: req.user.id },
        { teachers: { some: { teacherId: req.user.id } } },
      ];
    } else if (req.user.role === "STUDENT") {
      const studentGrade = req.user.grade;
      const studentSchoolId = req.user.schoolId;
      const studentGrades = getStudentGradeAndStage(studentGrade);

      const gradeOrConditions: any[] = [{ grade: null }];
      for (const g of studentGrades) {
        gradeOrConditions.push({ grade: g });
        gradeOrConditions.push({ grades: { contains: `"${g}"` } });
      }

      const orFilters: any[] = [];

      if (studentGrade) {
        orFilters.push({
          isCentral: true,
          OR: gradeOrConditions,
        });
      } else {
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
        } else {
          orFilters.push({ schoolId: studentSchoolId });
          orFilters.push({ schools: { some: { id: studentSchoolId } } });
        }
      }

      accessFilter.OR = orFilters;
    }

    const filters: any[] =
      Object.keys(accessFilter).length > 0 ? [accessFilter] : [];
    if (search) {
      filters.push({
        OR: [
          { title: { contains: search as string, mode: "insensitive" } },
          { subject: { contains: search as string, mode: "insensitive" } },
          {
            lessons: {
              some: {
                title: { contains: search as string, mode: "insensitive" },
                deletedAt: null,
              },
            },
          },
        ],
      });
    }
    const where =
      filters.length > 0
        ? { AND: filters, deletedAt: null }
        : { deletedAt: null };

    console.time("courses-db-query");
    const [courses, total] = await Promise.all([
      prisma.course.findMany({
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
      prisma.course.count({ where }),
    ]);
    console.timeEnd("courses-db-query");

    // Return database courses directly without merging unverified ghost cloud backups
    const responseData = {
      courses,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };

    if (req.user.role === "STUDENT") {
      setCache(cacheKey, responseData);
    }
    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: "Error fetching courses" });
  }
};


export const getCourseHandler29 = async (req: any, res: any) => {
  try {
    const { isCentral, schoolId, search } = req.query;
    const accessFilter: any = {};

    if (isCentral === "true") {
      accessFilter.isCentral = true;
    } else if (req.user.role === "SUPER_ADMIN") {
      if (schoolId) {
        accessFilter.OR = [
          { schoolId: schoolId },
          { schools: { some: { id: schoolId } } },
        ];
      }
    } else if (req.user.role === "SCHOOL_ADMIN") {
      accessFilter.OR = [
        { isCentral: true },
        { schoolId: req.user.schoolId },
        { schools: { some: { id: req.user.schoolId } } },
      ];
    } else if (req.user.role === "TEACHER") {
      accessFilter.OR = [
        { creatorId: req.user.id },
        { teachers: { some: { teacherId: req.user.id } } },
      ];
    }

    const filters: any[] =
      Object.keys(accessFilter).length > 0 ? [accessFilter] : [];
    if (search) {
      filters.push({
        OR: [
          { title: { contains: search as string, mode: "insensitive" } },
          { subject: { contains: search as string, mode: "insensitive" } },
          {
            lessons: {
              some: {
                title: { contains: search as string, mode: "insensitive" },
                deletedAt: null,
              },
            },
          },
        ],
      });
    }
    const where = filters.length > 0 ? { AND: filters } : {};

    const cacheKey = `stats_${JSON.stringify(where)}`;
    const cached = getCache(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    const isUnfiltered = Object.keys(where).length === 0;

    console.time("stats-db-query");
    const [totalCourses, totalLessons, uniqueSubjects] = await Promise.all([
      prisma.course.count({ where }),
      isUnfiltered
        ? prisma.lesson.count()
        : prisma.lesson.count({ where: { course: where } }),
      prisma.course.groupBy({
        by: ["subject"],
        where: { ...where, subject: { not: null } },
      }),
    ]);
    console.timeEnd("stats-db-query");

    const stats = {
      totalCourses,
      totalLessons,
      totalSubjects: uniqueSubjects.length,
    };

    setCache(cacheKey, stats);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "Error fetching stats" });
  }
};


export const getCourseHandler30 = async (req: any, res: any) => {
  try {
    const courseId = req.params.id;
    const summaryOnly = req.query.summary === "true" && ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"].includes(req.user.role);
    const includeSlideCounts = summaryOnly && req.query.includeSlideCounts === "true";
    const countsOnly = includeSlideCounts && req.query.countsOnly === "true";
    const course = await prisma.course.findFirst({
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
                progresses:
                  req.user.role === "SUPER_ADMIN"
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
    if (
      !course.isCentral &&
      req.user.role !== "SUPER_ADMIN" &&
      course.schoolId !== req.user.schoolId &&
      (!course.schools ||
        !course.schools.some((s: any) => s.id === req.user.schoolId))
    ) {
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
      const histories = await prisma.xPHistory.findMany({
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

      const lessonXPMap: Record<string, number> = {};
      const examXPMap: Record<string, number> = {};
      let totalCourseXP = 0;

      histories.forEach((h) => {
        totalCourseXP += h.xp;
        if (h.sourceType.startsWith("LESSON_")) {
          lessonXPMap[h.sourceId] = (lessonXPMap[h.sourceId] || 0) + h.xp;
        } else if (h.sourceType === "EXAM") {
          examXPMap[h.sourceId] = (examXPMap[h.sourceId] || 0) + h.xp;
        }
      });

      // Calculate unit (domain) XP
      const domainXPMap: Record<string, number> = {};
      course.lessons.forEach((l) => {
        const domainName = l.domain?.trim() || "";
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

    const slidesCountByLessonId = new Map<string, number>();
    if (includeSlideCounts && course.lessons.length > 0) {
      const slideCounts = await prisma.$queryRaw<Array<{ id: string; slidesCount: number }>>`
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
      ? course.lessons.map((lesson: any) => ({
          ...lesson,
          ...(includeSlideCounts ? { slidesCount: slidesCountByLessonId.get(lesson.id) || 0 } : {}),
        }))
      : course.lessons;

    if (countsOnly) {
      return res.json({
        lessonSlideCounts: responseLessons.map((lesson: any) => ({
          id: lesson.id,
          slidesCount: lesson.slidesCount || 0,
        })),
      });
    }

    res.json({
      ...course,
      lessons: responseLessons,
      lessonsAreSummaries: summaryOnly,
      xpData,
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching course details" });
  }
};


export const getCourseHandler31 = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        progresses:
          req.user.role === "SUPER_ADMIN"
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
    const course = await prisma.course.findUnique({
      where: { id: lesson.courseId },
      include: {
        schools: { select: { id: true } },
        enrollments:
          req.user.role === "STUDENT"
            ? { where: { studentId: req.user.id }, select: { id: true } }
            : false,
      },
    });

    if (course) {
      const isStaff = ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"].includes(
        req.user.role,
      );
      const courseGradeTargets = parseStringArray(course.grades);
      if (course.grade) courseGradeTargets.push(course.grade);
      const studentGrades = getStudentGradeAndStage(req.user.grade);
      const matchesCourseGrade =
        courseGradeTargets.length === 0 ||
        courseGradeTargets.some((g) => studentGrades.includes(g));

      const hasSchoolAccess =
        req.user.schoolId &&
        (course.schoolId === req.user.schoolId ||
          (course.schools &&
            course.schools.some((s: any) => s.id === req.user.schoolId)));
      const hasEnrollmentAccess =
        Array.isArray((course as any).enrollments) &&
        (course as any).enrollments.length > 0;

      const canAccess =
        isStaff ||
        course.isCentral ||
        (hasSchoolAccess && matchesCourseGrade) ||
        hasEnrollmentAccess;

      if (!canAccess) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    let lessonQuestionsForResponse: any = lesson.questions;

    if (req.user.role === "STUDENT" && lesson.questions) {
      let parsedQuestions: any[] = [];
      try {
        parsedQuestions =
          (typeof lesson.questions === "string"
            ? JSON.parse(lesson.questions)
            : lesson.questions) || [];
      } catch (e) {
        parsedQuestions = [];
      }

      if (Array.isArray(parsedQuestions)) {
        const difficultyMap: any = {
          Easy: 1,
          Medium: 2,
          Hard: 3,
          Foundation: 1,
          "On Level": 2,
          Advanced: 3,
        };
        parsedQuestions.sort((a: any, b: any) => {
          const diffA = difficultyMap[a.level || "Medium"] || 2;
          const diffB = difficultyMap[b.level || "Medium"] || 2;
          return diffA - diffB;
        });

        // Hide correct answers (commented out to support client-side Quiz Me self-evaluation)
        parsedQuestions = parsedQuestions.map((q) => {
          const qPayload = { ...q };
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
      const histories = await prisma.xPHistory.findMany({
        where: { userId, sourceId: id },
      });

      // Build maps of questionId -> hasFirstAttemptCorrect, attemptedCount, earnedXP
      const firstCorrectMap: Record<string, boolean> = {};
      const attemptedMap: Record<string, number> = {};
      const earnedXPMap: Record<string, number> = {};

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
      const getStreakForSet = (blocksJson: any, sourceType: string) => {
        let blocks: any[] = [];
        try {
          blocks = blocksJson
            ? typeof blocksJson === "string"
              ? JSON.parse(blocksJson)
              : blocksJson
            : [];
        } catch (e) {
          blocks = [];
        }

        const setAttempts = histories.filter(
          (h) =>
            h.sourceType === sourceType && h.attemptNum === 1 && !h.isBonus,
        );
        const setAttemptsMap = new Map(
          setAttempts.map((a) => [a.questionId, a]),
        );

        let currentStreak = 0;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (b.type !== "QUESTION" && b.label !== "QUESTION") continue;
          const qId = b.id ? String(b.id) : String(i);
          const attempt = setAttemptsMap.get(qId);
          if (!attempt) break;
          if (attempt.isCorrect) {
            currentStreak++;
          } else {
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

    res.json({
      ...lesson,
      questions: lessonQuestionsForResponse,
      xpData,
    });
  } catch (error) {
    console.error("Error fetching lesson:", error);
    res.status(500).json({ error: "Error fetching lesson details" });
  }
};


export const postCourseHandler32 = async (req: any, res: any) => {
    try {
      const { studentId, courseId } = req.body;
      // Ensure course belongs to this school
      const course = await prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course || course.schoolId !== req.user.schoolId) {
        return res
          .status(403)
          .json({ error: "Course does not belong to your school." });
      }

      const enrollment = await prisma.studentEnrollment.create({
        data: { studentId, courseId },
      });
      res.json(enrollment);
    } catch (error) {
      res.status(500).json({ error: "Error enrolling student" });
    }
  };


// Automatic title-based deduplication is disabled — deduplication is preview/manual only
export async function previewDeduplication() {
  try {
    const lessons = await prisma.lesson.findMany({
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

    const lessonGroups = new Map<string, typeof lessons>();
    for (const lesson of lessons) {
      const key = `${lesson.courseId}_${lesson.title.trim().toLowerCase()}`;
      if (!lessonGroups.has(key)) lessonGroups.set(key, []);
      lessonGroups.get(key)!.push(lesson);
    }

    const collisionGroups: any[] = [];
    for (const [key, group] of lessonGroups.entries()) {
      if (group.length > 1) {
        group.sort((a, b) => {
          const getScore = (item: any) => {
            let count = 0;
            try {
              const s =
                typeof item.slides === "string"
                  ? JSON.parse(item.slides)
                  : item.slides || [];
              const q =
                typeof item.questions === "string"
                  ? JSON.parse(item.questions)
                  : item.questions || [];
              const a_ =
                typeof item.assignments === "string"
                  ? JSON.parse(item.assignments)
                  : item.assignments || [];
              count += (Array.isArray(s) ? s.length : 0) * 1;
              count += (Array.isArray(q) ? q.length : 0) * 2;
              count += (Array.isArray(a_) ? a_.length : 0) * 3;
            } catch (e) {}
            return count;
          };
          const scoreA = getScore(a);
          const scoreB = getScore(b);
          if (scoreA !== scoreB) return scoreB - scoreA;
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });

        collisionGroups.push({
          courseId: group[0].courseId,
          courseTitle: group[0].course?.title,
          schoolId: group[0].course?.schoolId,
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
  } catch (error) {
    console.error("Error in preview deduplication:", error);
    return { success: false, error };
  }
}
