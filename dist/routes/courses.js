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
Object.defineProperty(exports, "__esModule", { value: true });
const coursesController = __importStar(require("../controllers/courses.controller"));
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get("/api/admin/system/deduplicate-lessons", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.getCourseHandler1);
router.post("/api/admin/system/deduplicate-lessons/merge", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler2);
// --- Extracted from lines 2305-3104 ---
router.post("/api/admin/classrooms", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN", "SCHOOL_ADMIN"]), auth_1.checkSchoolAccess, coursesController.postCourseHandler3);
router.get("/api/admin/classrooms", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN", "SCHOOL_ADMIN"]), auth_1.checkSchoolAccess, coursesController.getCourseHandler4);
router.delete("/api/admin/classrooms/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), auth_1.checkSchoolAccess, coursesController.deleteCourseHandler5);
// ==========================================
// 🏫 ALIAS CLASSES ROUTES FOR FRONTEND
// ==========================================
router.post("/api/classes", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"]), auth_1.checkSchoolAccess, coursesController.postCourseHandler6);
router.get("/api/classes", auth_1.verifyToken, coursesController.getCourseHandler7);
router.delete("/api/classes/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), auth_1.checkSchoolAccess, coursesController.deleteCourseHandler8);
router.put("/api/classes/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"]), auth_1.checkSchoolAccess, coursesController.putCourseHandler9);
// ==========================================
// 🏫 SCHOOL ADMIN ROUTES (Isolated via Middleware)
// ==========================================
// Manage Teachers & Students for their school
router.post("/api/school/users", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN"]), coursesController.postCourseHandler10);
// Manage Courses
router.post("/api/school/courses", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.postCourseHandler11);
// Update Course
router.put("/api/school/courses/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.putCourseHandler12);
// ============================================================
// 📝 LESSON COPY OPERATIONS (SUPER ADMIN)
// ============================================================
// POST: Copy entire lesson to another course
router.post("/api/lessons/:id/copy-to-course", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler13);
// POST: Export multiple sections of a lesson to another lesson
router.post("/api/lessons/:id/export-sections", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler14);
// POST: Copy specific slides to another lesson
router.post("/api/lessons/:id/copy-slides", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler15);
// ============================================================
// 📝 LESSON SLIDES — Safe dedicated endpoints
// ============================================================
// GET: Read a lesson's slides directly from DB
router.get("/api/lessons/:id/slides", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.getCourseHandler16);
// PATCH: Update ONLY the slides of a lesson (never overwrites other fields)
router.patch("/api/lessons/:id/slides", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.patchCourseHandler17);
// PATCH: Update ONLY the questions of a lesson
router.patch("/api/lessons/:id/questions", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.patchCourseHandler18);
// PATCH: Update ONLY the assignments of a lesson
router.patch("/api/lessons/:id/assignments", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.patchCourseHandler19);
// PATCH: Update ONLY the attachments of a lesson
router.patch("/api/lessons/:id/attachments", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"]), coursesController.patchCourseHandler20);
// ════════════════════════════════════════════════════════════════════
// 🔒 DELETE LESSON — Manual deletion only, SUPER_ADMIN exclusive.
//    This is the ONLY endpoint that deletes lessons.
//    The course-update endpoint (PUT) will NEVER delete lessons automatically.
// ════════════════════════════════════════════════════════════════════
router.delete("/api/lessons/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.deleteCourseHandler21);
// Delete Course
router.delete("/api/school/courses/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.deleteCourseHandler22);
// ════════════════════════════════════════════════════════════════════
// ♻️ RESTORE FROM TRASH (The Nile) & TRASH LIST
// ════════════════════════════════════════════════════════════════════
// List Trashed Items
router.get("/api/admin/trash", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.getCourseHandler23);
router.post("/api/admin/trash/bulk-restore", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler24);
router.delete("/api/admin/trash/empty", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.deleteCourseHandler25);
router.post("/api/admin/trash/bulk-delete", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postTrashBulkDeleteHandler);
router.delete("/api/admin/trash/item/:type/:id", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.deleteTrashItemHandler);
// Restore Course
router.post("/api/school/courses/:id/restore", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler26);
// Restore Lesson
router.post("/api/lessons/:id/restore", auth_1.verifyToken, (0, auth_1.checkRole)(["SUPER_ADMIN"]), coursesController.postCourseHandler27);
// List Courses
router.get("/api/courses", auth_1.verifyToken, coursesController.getCourseHandler28);
// New separate stats endpoint for performance
router.get("/api/courses/stats", auth_1.verifyToken, coursesController.getCourseHandler29);
// Get Single Course with Lessons
router.get("/api/courses/:id", auth_1.verifyToken, coursesController.getCourseHandler30);
// Get Single Lesson
router.get("/api/lessons/:id", auth_1.verifyToken, coursesController.getCourseHandler31);
// Enroll Student in Course
router.post("/api/school/enroll", auth_1.verifyToken, (0, auth_1.checkRole)(["SCHOOL_ADMIN", "SUPER_ADMIN"]), coursesController.postCourseHandler32);
// ==========================================
// 📝 EXAM SYSTEM ROUTES
// ==========================================
// 1. Create Exam (Super Admin or School Admin)
exports.default = router;
