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
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) return res.json(cached.data);
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
    const summaryOnly = req.query.summary === "true" || (req.user.role === "STUDENT" && req.query.includeContent !== "true");
    const includeSlideCounts = (summaryOnly && req.query.includeSlideCounts === "true") || req.user.role === "STUDENT";
    const countsOnly = includeSlideCounts && req.query.countsOnly === "true";
    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      include: {
        lessons: {
          where: { deletedAt: null },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: summaryOnly
            ? {
                // Keep the course editor and student view fast: lesson content is fetched on demand
                id: true,
                courseId: true,
                title: true,
                domain: true,
                summary: true,
                isVisible: true,
                publishDate: true,
                cutOffDate: true,
                order: true,
                duration: true,
                createdAt: true,
                updatedAt: true,
                progresses:
                  req.user.role === "SUPER_ADMIN"
                    ? false
                    : {
                        where: { userId: req.user.id },
                      },
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
                standardsEn: true, indicatorsEn: true, learningOutcomesEn: true, domainEn: true,
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
    const questionsCountByLessonId = new Map<string, number>();
    if (includeSlideCounts && course.lessons.length > 0) {
      const counts = await prisma.$queryRaw<Array<{ id: string; slidesCount: number; questionsCount: number }>>`
        SELECT
          "id",
          CASE
            WHEN jsonb_typeof(COALESCE("slides", '[]'::jsonb)) = 'array'
              THEN jsonb_array_length("slides")
            ELSE 0
          END AS "slidesCount",
          CASE
            WHEN jsonb_typeof(COALESCE("questions", '[]'::jsonb)) = 'array'
              THEN jsonb_array_length("questions")
            ELSE 0
          END AS "questionsCount"
        FROM "Lesson"
        WHERE "courseId" = ${courseId} AND "deletedAt" IS NULL
      `;
      counts.forEach(({ id, slidesCount, questionsCount }) => {
        slidesCountByLessonId.set(id, Number(slidesCount) || 0);
        questionsCountByLessonId.set(id, Number(questionsCount) || 0);
      });
    }

    const responseLessons = summaryOnly
      ? course.lessons.map((lesson: any) => ({
          ...lesson,
          ...(includeSlideCounts ? {
            slidesCount: slidesCountByLessonId.get(lesson.id) || 0,
            questionsCount: questionsCountByLessonId.get(lesson.id) || 0,
          } : {}),
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
