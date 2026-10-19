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
          ...metadataTranslations(sourceLesson, String, LESSON_METADATA_FIELDS),
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
        Object.assign(updateData, metadataTranslations(sourceLesson, String, LESSON_METADATA_FIELDS));
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
        select: { id: true, courseId: true, slides: true, course: { select: { schoolId: true } } },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });
      if (req.user.role !== "SUPER_ADMIN") {
        if (!lesson.course?.schoolId || lesson.course.schoolId !== req.user.schoolId) {
          return res.status(403).json({ error: "Access denied: content belongs to another school." });
        }
        if (req.user.role === "TEACHER" && !await prisma.teacherCourse.findFirst({
          where: { teacherId: req.user.id, courseId: lesson.courseId }, select: { id: true },
        })) return res.status(403).json({ error: "You are not assigned to this course." });
        if (removesSavedContent(lesson.slides, slides) && !await isContentDeletionAllowed()) {
          return res.status(403).json({ error: "Content deletion is disabled by Super Admin. حذف المحتوى معطّل من الإدارة العامة." });
        }
      }


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
        select: { id: true, courseId: true, questions: true, course: { select: { schoolId: true } } },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });
      if (req.user.role !== "SUPER_ADMIN") {
        if (!lesson.course?.schoolId || lesson.course.schoolId !== req.user.schoolId) {
          return res.status(403).json({ error: "Access denied: content belongs to another school." });
        }
        if (req.user.role === "TEACHER" && !await prisma.teacherCourse.findFirst({
          where: { teacherId: req.user.id, courseId: lesson.courseId }, select: { id: true },
        })) return res.status(403).json({ error: "You are not assigned to this course." });
        if (removesSavedContent(lesson.questions, questions) && !await isContentDeletionAllowed()) {
          return res.status(403).json({ error: "Content deletion is disabled by Super Admin. حذف المحتوى معطّل من الإدارة العامة." });
        }
      }


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
        select: { id: true, courseId: true, assignments: true, course: { select: { schoolId: true } } },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });
      if (req.user.role !== "SUPER_ADMIN") {
        if (!lesson.course?.schoolId || lesson.course.schoolId !== req.user.schoolId) {
          return res.status(403).json({ error: "Access denied: content belongs to another school." });
        }
        if (req.user.role === "TEACHER" && !await prisma.teacherCourse.findFirst({
          where: { teacherId: req.user.id, courseId: lesson.courseId }, select: { id: true },
        })) return res.status(403).json({ error: "You are not assigned to this course." });
        if (removesSavedContent(lesson.assignments, assignments) && !await isContentDeletionAllowed()) {
          return res.status(403).json({ error: "Content deletion is disabled by Super Admin. حذف المحتوى معطّل من الإدارة العامة." });
        }
      }


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

      if (req.user.role !== "SUPER_ADMIN") {
        const allowed = await isContentDeletionAllowed();
        if (!allowed) {
          return res.status(403).json({
            error: "حذف المحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.",
          });
        }
      }

      if (req.user.role === "SCHOOL_ADMIN") {
        if (!lesson.course?.schoolId || lesson.course.schoolId !== req.user.schoolId) {
          return res.status(403).json({
            error: "Access denied: You can only delete lessons belonging to your school.",
          });
        }
      }

      if (req.user.role === "TEACHER") {
        if (!lesson.courseId || !lesson.course?.schoolId || lesson.course.schoolId !== req.user.schoolId) {
          return res.status(403).json({
            error: "Access denied: You can only delete lessons belonging to your school.",
          });
        }
        const teacherCourse = await prisma.teacherCourse.findFirst({
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
      await prisma.lesson.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // We no longer need tombstones for soft-deleted items, but keeping it for legacy support
      const { recordDeletedLesson } = await import("../lib/tombstones");
      await recordDeletedLesson(id, lesson.title);

      console.log(
        `[Lesson Delete] User ${req.user?.id} (${req.user?.role}) manually deleted lesson "${lesson.title}" (${id}) from course ${lesson.courseId}`,
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
        if (req.user.role !== "SUPER_ADMIN") return res.status(404).json({ error: "Course not found" });
        // It's already deleted locally but still lingering in the Cloud Backup!
        // Force a full cloud sync to overwrite the cloud and clear the ghost course
        const { syncAllCoursesToCloud } = await import("../lib/db-backup");
        await syncAllCoursesToCloud("Ghost Course Cleanup");
        return res.json({
          message: "Ghost course cleared from cloud cache successfully",
        });
      }

      if (req.user.role !== "SUPER_ADMIN") {
        const allowed = await isContentDeletionAllowed();
        if (!allowed) {
          return res.status(403).json({
            error: "حذف المحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.",
          });
        }
      }

      if (
        req.user.role !== "SUPER_ADMIN" &&
        (!existingCourse.schoolId || existingCourse.schoolId !== req.user.schoolId)
      ) {
        return res
          .status(403)
          .json({
            error:
              "Access denied: You can only delete courses belonging to your school.",
          });
      }

      if (req.user.role === "TEACHER") {
        const assignment = await prisma.teacherCourse.findFirst({
          where: { teacherId: req.user.id, courseId: id }, select: { id: true },
        });
        if (!assignment) return res.status(403).json({ error: "You are not assigned to this course." });
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



