import * as coursesController from "../controllers/courses.controller";
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

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();



router.get(
  "/api/admin/system/deduplicate-lessons",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.getCourseHandler1,
);

router.post(
  "/api/admin/system/deduplicate-lessons/merge",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler2,
);

// --- Extracted from lines 2305-3104 ---
router.post(
  "/api/admin/classrooms",
  verifyToken,
  checkRole(["SUPER_ADMIN", "SCHOOL_ADMIN"]),
  checkSchoolAccess,
  coursesController.postCourseHandler3,
);

router.get(
  "/api/admin/classrooms",
  verifyToken,
  checkRole(["SUPER_ADMIN", "SCHOOL_ADMIN"]),
  checkSchoolAccess,
  coursesController.getCourseHandler4,
);

router.delete(
  "/api/admin/classrooms/:id",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  checkSchoolAccess,
  coursesController.deleteCourseHandler5,
);

// ==========================================
// 🏫 ALIAS CLASSES ROUTES FOR FRONTEND
// ==========================================

router.post(
  "/api/classes",
  verifyToken,
  checkRole(["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"]),
  checkSchoolAccess,
  coursesController.postCourseHandler6,
);

router.get("/api/classes", verifyToken, coursesController.getCourseHandler7);

router.delete(
  "/api/classes/:id",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  checkSchoolAccess,
  coursesController.deleteCourseHandler8,
);

router.put(
  "/api/classes/:id",
  verifyToken,
  checkRole(["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"]),
  checkSchoolAccess,
  coursesController.putCourseHandler9,
);

// ==========================================
// 🏫 SCHOOL ADMIN ROUTES (Isolated via Middleware)
// ==========================================

// Manage Teachers & Students for their school
router.post(
  "/api/school/users",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN"]),
  coursesController.postCourseHandler10,
);

// Manage Courses
router.post(
  "/api/school/courses",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.postCourseHandler11,
);

// Update Course
router.put(
  "/api/school/courses/:id",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.putCourseHandler12,
);

// ============================================================
// 📝 LESSON COPY OPERATIONS (SUPER ADMIN)
// ============================================================
// POST: Copy entire lesson to another course
router.post(
  "/api/lessons/:id/copy-to-course",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler13,
);

// POST: Export multiple sections of a lesson to another lesson
router.post(
  "/api/lessons/:id/export-sections",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler14,
);

// POST: Copy specific slides to another lesson
router.post(
  "/api/lessons/:id/copy-slides",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler15,
);

// ============================================================
// 📝 LESSON SLIDES — Safe dedicated endpoints
// ============================================================
// GET: Read a lesson's slides directly from DB
router.get(
  "/api/lessons/:id/slides",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.getCourseHandler16,
);

// PATCH: Update ONLY the slides of a lesson (never overwrites other fields)
router.patch(
  "/api/lessons/:id/slides",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.patchCourseHandler17,
);

// PATCH: Update ONLY the questions of a lesson
router.patch(
  "/api/lessons/:id/questions",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.patchCourseHandler18,
);

// PATCH: Update ONLY the assignments of a lesson
router.patch(
  "/api/lessons/:id/assignments",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.patchCourseHandler19,
);

// PATCH: Update ONLY the attachments of a lesson
router.patch(
  "/api/lessons/:id/attachments",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]),
  coursesController.patchCourseHandler20,
);

// ════════════════════════════════════════════════════════════════════
// 🔒 DELETE LESSON — Manual deletion only, SUPER_ADMIN exclusive.
//    This is the ONLY endpoint that deletes lessons.
//    The course-update endpoint (PUT) will NEVER delete lessons automatically.
// ════════════════════════════════════════════════════════════════════
router.delete(
  "/api/lessons/:id",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.deleteCourseHandler21,
);

// Delete Course
router.delete(
  "/api/school/courses/:id",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.deleteCourseHandler22,
);

// ════════════════════════════════════════════════════════════════════
// ♻️ RESTORE FROM TRASH (The Nile) & TRASH LIST
// ════════════════════════════════════════════════════════════════════

// List Trashed Items
router.get(
  "/api/admin/trash",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.getCourseHandler23,
);

router.post(
  "/api/admin/trash/bulk-restore",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler24,
);

router.delete(
  "/api/admin/trash/empty",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.deleteCourseHandler25,
);

router.post(
  "/api/admin/trash/bulk-delete",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postTrashBulkDeleteHandler,
);

router.delete(
  "/api/admin/trash/item/:type/:id",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.deleteTrashItemHandler,
);

// Restore Course
router.post(
  "/api/school/courses/:id/restore",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler26,
);

// Restore Lesson
router.post(
  "/api/lessons/:id/restore",
  verifyToken,
  checkRole(["SUPER_ADMIN"]),
  coursesController.postCourseHandler27,
);

// List Courses
router.get("/api/courses", verifyToken, coursesController.getCourseHandler28);

// New separate stats endpoint for performance
router.get("/api/courses/stats", verifyToken, coursesController.getCourseHandler29);

// Get Single Course with Lessons
router.get("/api/courses/:id", verifyToken, coursesController.getCourseHandler30);

// Get Single Lesson
router.get("/api/lessons/:id", verifyToken, coursesController.getCourseHandler31);

// Enroll Student in Course
router.post(
  "/api/school/enroll",
  verifyToken,
  checkRole(["SCHOOL_ADMIN", "SUPER_ADMIN"]),
  coursesController.postCourseHandler32,
);

// ==========================================
// 📝 EXAM SYSTEM ROUTES
// ==========================================

// 1. Create Exam (Super Admin or School Admin)

export default router;
