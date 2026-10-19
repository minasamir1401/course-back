import { metadataTranslations } from '../utils/bilingualMetadata';
import { persistQuestionUpdates } from '../utils/examQuestionWrites';
import { randomUUID } from 'node:crypto';
import { changedQuestionFields, changedQuestionOrders, calculateSubmissionStats } from '../utils/examPerformance';
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { runSafeDeduplicationAndEmptyCleanup } from '../scripts/clean-duplicates-and-empty';
import {
  buildQuestionFingerprint,
  pickReconciliationCandidate,
  sortPersistedOrder,
} from '../lib/contentReconciliation';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { countModuleContent, getAvailability, mergeStudentProfile, resolveExamAccessPassword } from '../utils/examWorkflow';
import { logExamRequestError } from '../utils/examErrorLog';
import { resolveExplicitExamDeletions } from '../utils/examDeletionPolicy';
import { resolvePassingScore } from '../utils/examPassingScore';
import { canManageExamRecord, canViewExamRecord, resolveExamSchoolUpdate } from '../utils/examAccessPolicy';
import { isContentDeletionAllowed } from '../services/systemSettings.service';
import {
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields,
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, invalidateCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses, acquireLock, releaseLock, extractAndSaveBase64Images,
  robustNormalizeText, getQuestionCoreSignature
} from '../shared';
import { normalizeBackendDok, canViewExam, canManageExam, formatCorrectAnswer, formatExplanation } from './examControllerSupport';

export const deleteExamHandler30 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;

    if ((req as any).user?.role !== 'SUPER_ADMIN') {
      const allowed = await isContentDeletionAllowed();
      if (!allowed) {
        return res.status(403).json({ error: 'حذف الاختبارات والمحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.' });
      }
    }

    const parent = await prisma.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });

    await prisma.$transaction(async (tx) => {
      await tx.question.updateMany({
        where: { examId: id, subExamId },
        data: { subExamId: null },
      });

      await tx.subExam.delete({
        where: { id: subExamId },
      });
    });

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    console.error('Error deleting child exam:', error);
    res.status(500).json({ error: 'Failed to delete exam inside module' });
  }
};

export const postMoveSubExamHandler = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;
    const { targetModuleId, newModuleTitle, targetExamId } = req.body || {};

    const trimmedNewTitle = newModuleTitle ? String(newModuleTitle).trim() : '';
    if (!targetModuleId && !trimmedNewTitle) {
      return res.status(400).json({ error: 'Either targetModuleId or newModuleTitle is required.' });
    }

    const sourceModule = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true, title: true }
    });
    if (!sourceModule) {
      return res.status(404).json({ error: 'Source module not found in this exam.' });
    }

    const subExam = await prisma.subExam.findFirst({
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

    const result = await prisma.$transaction(async (tx) => {
      if (trimmedNewTitle) {
        const destExamId = targetExamId ? String(targetExamId).trim() : id;
        destinationExamId = destExamId;

        if (destExamId !== id) {
          const destExam = await tx.exam.findUnique({
            where: { id: destExamId },
            include: { schools: { select: { id: true } } }
          });
          if (!destExam) {
            throw new Error('Destination exam not found.');
          }
          if (!await canManageExam((req as any).user, destExam)) {
            throw new Error('Access denied: You do not have permission to add modules to destination exam.');
          }
        }

        const lastModule = await tx.examModule.findFirst({
          where: { examId: destExamId },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const nextOrder = (lastModule?.order ?? -1) + 1;

        const createdModule = await tx.examModule.create({
          data: {
            examId: destExamId,
            title: sanitizeHtml(trimmedNewTitle),
            order: nextOrder,
          }
        });
        destinationModuleId = createdModule.id;
      } else {
        const targetMod = await tx.examModule.findUnique({
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
          if (!await canManageExam((req as any).user, targetMod.exam)) {
            throw new Error('Access denied: You do not have permission to move to destination exam.');
          }
        }
      }

      const destSubExamsCount = await tx.subExam.count({
        where: { moduleId: destinationModuleId }
      });

      const updatedSubExam = await tx.subExam.update({
        where: { id: subExamId },
        data: {
          moduleId: destinationModuleId,
          order: destSubExamsCount,
        }
      });

      const updatedQuestions = await tx.question.updateMany({
        where: {
          examId: id,
          subExamId: subExamId,
        },
        data: {
          examId: destinationExamId,
          moduleId: destinationModuleId,
        }
      });

      const destinationModule = await tx.examModule.findUnique({
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
    });

    res.json({
      success: true,
      message: 'Exam and its questions moved successfully.',
      ...result,
    });
  } catch (error: any) {
    console.error('Error moving subExam to module:', error);
    res.status(400).json({ error: error?.message || 'Failed to move exam to destination module.' });
  }
};

export const postMoveAllSubExamsHandler = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { targetModuleId, newModuleTitle, targetExamId } = req.body || {};

    const trimmedNewTitle = newModuleTitle ? String(newModuleTitle).trim() : '';
    if (!targetModuleId && !trimmedNewTitle) {
      return res.status(400).json({ error: 'Either targetModuleId or newModuleTitle is required.' });
    }

    const sourceModule = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true, title: true }
    });
    if (!sourceModule) {
      return res.status(404).json({ error: 'Source module not found in this exam.' });
    }

    const subExams = await prisma.subExam.findMany({
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
    let targetMod: any = null;

    const result = await prisma.$transaction(async (tx) => {
      if (trimmedNewTitle) {
        const destExamId = targetExamId ? String(targetExamId).trim() : id;
        destinationExamId = destExamId;

        if (destExamId !== id) {
          const destExam = await tx.exam.findUnique({
            where: { id: destExamId },
            include: { schools: { select: { id: true } } }
          });
          if (!destExam) {
            throw new Error('Destination exam not found.');
          }
          if (!await canManageExam((req as any).user, destExam)) {
            throw new Error('Access denied: You do not have permission to add modules to destination exam.');
          }
        }

        const lastModule = await tx.examModule.findFirst({
          where: { examId: destExamId },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const nextOrder = (lastModule?.order ?? -1) + 1;

        const createdModule = await tx.examModule.create({
          data: {
            examId: destExamId,
            title: sanitizeHtml(trimmedNewTitle),
            order: nextOrder,
          }
        });
        destinationModuleId = createdModule.id;
      } else {
        targetMod = await tx.examModule.findUnique({
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
          if (!await canManageExam((req as any).user, targetMod.exam)) {
            throw new Error('Access denied: You do not have permission to move to destination exam.');
          }
        }
      }

      const destSubExamsCount = await tx.subExam.count({
        where: { moduleId: destinationModuleId }
      });

      const destModule = targetMod || (await tx.examModule.findUnique({ where: { id: destinationModuleId } }));
      const targetModSettings = {
        publishDate: destModule?.publishDate ?? null,
        cutOffDate: destModule?.cutOffDate ?? null,
        ...(destModule?.duration !== null && destModule?.duration !== undefined ? { duration: destModule.duration } : {}),
        ...(destModule?.passingScore !== null && destModule?.passingScore !== undefined ? { passingScore: destModule.passingScore } : {}),
      };

      // Update each subExam to destinationModuleId maintaining their sequential order and inheriting parent settings
      for (let i = 0; i < subExams.length; i++) {
        await tx.subExam.update({
          where: { id: subExams[i].id },
          data: {
            moduleId: destinationModuleId,
            order: destSubExamsCount + i,
            ...targetModSettings,
          }
        });
      }

      // Update all questions attached to these subExams
      const updatedQuestions = await tx.question.updateMany({
        where: {
          examId: id,
          subExamId: { in: subExamIds },
        },
        data: {
          examId: destinationExamId,
          moduleId: destinationModuleId,
          ...(destModule?.gradeTarget ? { gradeTarget: destModule.gradeTarget } : {}),
        }
      });

      // If cross-exam transfer, update exam submissions
      if (destinationExamId !== id) {
        await tx.examSubmission.updateMany({
          where: {
            subExamId: { in: subExamIds }
          },
          data: {
            examId: destinationExamId
          }
        });

        const remainingModules = await tx.examModule.count({ where: { examId: id } });
        const remainingQuestions = await tx.question.count({ where: { examId: id, deletedAt: null } });
        if (remainingModules === 0 && remainingQuestions === 0) {
          await tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
        }
      }

      const destinationModule = await tx.examModule.findUnique({
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
    });

    res.json({
      success: true,
      message: 'All sub-exams and their questions moved successfully.',
      ...result,
    });
  } catch (error: any) {
    console.error('Error moving all subExams to module:', error);
    res.status(400).json({ error: error?.message || 'Failed to move all sub-exams to destination module.' });
  }
};

export const postMoveModuleHandler = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { targetExamId, targetParentModuleId, newParentModuleTitle } = req.body || {};

    const sourceModule = await prisma.examModule.findFirst({
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
    let destinationParentModuleId: string | null = targetParentModuleId ? String(targetParentModuleId).trim() : null;

    if (destinationParentModuleId === moduleId) {
      return res.status(400).json({ error: 'Cannot move a module inside itself.' });
    }

    // Verify destination exam access if moving cross-exam
    if (destinationExamId !== id) {
      const destExam = await prisma.exam.findUnique({
        where: { id: destinationExamId },
        include: { schools: { select: { id: true } } }
      });
      if (!destExam) {
        return res.status(404).json({ error: 'Destination exam not found.' });
      }
      if (!await canManageExam((req as any).user, destExam)) {
        return res.status(403).json({ error: 'Access denied: You do not have permission to move to destination exam.' });
      }
    }

    const trimmedNewTitle = newParentModuleTitle ? String(newParentModuleTitle).trim() : '';

    const result = await prisma.$transaction(async (tx) => {
      let inheritedSettings: any = {};

      // If user wants to create a new Main Module to receive this module
      if (trimmedNewTitle) {
        const lastMod = await tx.examModule.findFirst({
          where: { examId: destinationExamId, parentModuleId: null },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const nextOrder = (lastMod?.order ?? -1) + 1;

        const destExam = await tx.exam.findUnique({ where: { id: destinationExamId } });
        const createdParent = await tx.examModule.create({
          data: {
            examId: destinationExamId,
            title: sanitizeHtml(trimmedNewTitle),
            order: nextOrder,
            parentModuleId: null,
            duration: destExam?.duration ?? null,
            passingScore: destExam?.passingScore ?? null,
            gradeTarget: destExam?.grade ?? null,
            publishDate: destExam?.startDate ?? null,
            cutOffDate: destExam?.endDate ?? null,
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
      } else if (destinationParentModuleId) {
        // Verify target parent module exists
        const targetParent = await tx.examModule.findUnique({
          where: { id: destinationParentModuleId }
        });
        if (!targetParent) {
          throw new Error('Destination parent module not found.');
        }
        // Check cycle: ensure destinationParentModuleId is not a child of sourceModule
        let checkParent: any = targetParent;
        while (checkParent && checkParent.parentModuleId) {
          if (checkParent.parentModuleId === moduleId) {
            throw new Error('Cannot move a module into one of its own sub-modules (cycle detected).');
          }
          checkParent = await tx.examModule.findUnique({ where: { id: checkParent.parentModuleId } });
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
      const lastSibling = await tx.examModule.findFirst({
        where: {
          examId: destinationExamId,
          parentModuleId: destinationParentModuleId
        },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const nextSiblingOrder = (lastSibling?.order ?? -1) + 1;

      // Update sourceModule with destination and inherited parent settings
      const updatedModule = await tx.examModule.update({
        where: { id: moduleId },
        data: {
          examId: destinationExamId,
          parentModuleId: destinationParentModuleId,
          order: nextSiblingOrder,
          ...inheritedSettings,
        }
      });

      // Collect all descendant module IDs recursively
      const collectModuleIds = async (mId: string): Promise<string[]> => {
        const children = await tx.examModule.findMany({ where: { parentModuleId: mId }, select: { id: true } });
        const childIds = children.map(c => c.id);
        let allDescendants = [...childIds];
        for (const cId of childIds) {
          allDescendants = allDescendants.concat(await collectModuleIds(cId));
        }
        return allDescendants;
      };

      const allModuleIds = [moduleId, ...(await collectModuleIds(moduleId))];

      // If moving as a sub-module, update all descendant modules and sub-exams to inherit parent settings
      if (destinationParentModuleId) {
        if (allModuleIds.length > 1) {
          await tx.examModule.updateMany({
            where: { id: { in: allModuleIds.filter(mid => mid !== moduleId) } },
            data: {
              ...inheritedSettings,
            }
          });
        }

        await tx.subExam.updateMany({
          where: { moduleId: { in: allModuleIds } },
          data: {
            publishDate: inheritedSettings.publishDate,
            cutOffDate: inheritedSettings.cutOffDate,
            ...(inheritedSettings.duration !== null && inheritedSettings.duration !== undefined ? { duration: inheritedSettings.duration } : {}),
            ...(inheritedSettings.passingScore !== null && inheritedSettings.passingScore !== undefined ? { passingScore: inheritedSettings.passingScore } : {}),
          }
        });

        if (inheritedSettings.gradeTarget) {
          await tx.question.updateMany({
            where: { moduleId: { in: allModuleIds } },
            data: { gradeTarget: inheritedSettings.gradeTarget }
          });
        }
      }

      // If cross-exam transfer, update all nested entities
      if (destinationExamId !== id) {
        // Update all descendant modules examId
        await tx.examModule.updateMany({
          where: { id: { in: allModuleIds } },
          data: { examId: destinationExamId }
        });

        // Find all subExams under these modules
        const affectedSubExams = await tx.subExam.findMany({
          where: { moduleId: { in: allModuleIds } },
          select: { id: true }
        });
        const subExamIds = affectedSubExams.map(s => s.id);

        // Update questions
        await tx.question.updateMany({
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
          await tx.examSubmission.updateMany({
            where: { subExamId: { in: subExamIds } },
            data: { examId: destinationExamId }
          });
        }

        // If source exam is now empty, clean it up so no orphaned shell card remains
        const remainingModules = await tx.examModule.count({ where: { examId: id } });
        const remainingQuestions = await tx.question.count({ where: { examId: id, deletedAt: null } });
        if (remainingModules === 0 && remainingQuestions === 0) {
          await tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
        }
      }

      return {
        module: updatedModule,
        destinationExamId,
        destinationParentModuleId,
        isCrossExam: destinationExamId !== id,
      };
    });

    res.json({
      success: true,
      message: 'Module moved successfully.',
      ...result,
    });
  } catch (error: any) {
    console.error('Error moving module:', error);
    res.status(400).json({ error: error?.message || 'Failed to move module.' });
  }
};

export const getExamHandler31 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;

    const parent = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true, title: true, examId: true }
    });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });

    const subExam = await prisma.subExam.findFirst({
      where: { id: subExamId, moduleId },
      include: {
        questions: {
          where: { deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!subExam) return res.status(404).json({ error: 'Exam not found inside module' });

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
      questions: subExam.questions.map((question: any) => ({
        text: question.text,
        textEn: question.textEn,
        type: question.type,
        options: question.options,
        optionsEn: question.optionsEn,
        correctAnswer: question.correctAnswer,
        points: question.points,
        xpPoints: question.xpPoints,
        ...metadataTranslations(question, sanitizeHtml),
        skill: question.skill,
        learningOutcome: question.learningOutcome ?? question.standard ?? null,
        indicator: question.indicator,
        videoUrl: question.videoUrl,
        level: question.level,
        dok: normalizeBackendDok(question.dok),
        cognitive: question.cognitive,
        course: question.course,
        section: question.section,
        domain: question.domain,
        standard: question.standard ?? question.learningOutcome ?? null,
        subskill: question.subskill,
        microSkill: question.microSkill,
        gradeTarget: question.gradeTarget,
        errorPattern: question.errorPattern,
        estimatedTime: question.estimatedTime,
        explanation: question.explanation,
        explanationEn: question.explanationEn,
        hint: question.hint,
        hintEn: question.hintEn,
        imageUrl: question.imageUrl,
        order: question.order,
      })),
    };

    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    const fileName = `${String(subExam.title || 'exam').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'exam'}_backup.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting module exam JSON:', error);
    res.status(500).json({ error: 'Failed to export exam JSON' });
  }
};

export const postExamHandler32 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const rawPayload = req.body?.exportData;
    const parsedPayload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload)
      : rawPayload;

    if (!parsedPayload?.exam?.title) {
      return res.status(400).json({ error: 'Invalid exam JSON payload' });
    }

    const parent = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true }
    });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });

    const questions = Array.isArray(parsedPayload.questions) ? parsedPayload.questions : [];
    const createdSubExam = await prisma.$transaction(async (tx) => {
      const created = await tx.subExam.create({
        data: {
          moduleId,
          title: sanitizeHtml(String(parsedPayload.exam.title).trim()),
          password: parsedPayload.exam.password ? sanitizeHtml(String(parsedPayload.exam.password).trim()) : null,
          duration: parsedPayload.exam.duration ? parseInt(parsedPayload.exam.duration) : null,
          passingScore: parsedPayload.exam.passingScore ? parseInt(parsedPayload.exam.passingScore) : null,
          attemptsAllowed: parsedPayload.exam.attemptsAllowed ? parseInt(parsedPayload.exam.attemptsAllowed) || 1 : 1,
          order: await tx.subExam.count({ where: { moduleId } }),
          publishDate: parsedPayload.exam.publishDate ? new Date(parsedPayload.exam.publishDate) : null,
          cutOffDate: parsedPayload.exam.cutOffDate ? new Date(parsedPayload.exam.cutOffDate) : null,
        }
      });

      for (let index = 0; index < questions.length; index++) {
        const question = sanitizeDeep(questions[index] || {});
        await tx.question.create({
          data: {
            examId: id,
            moduleId,
            subExamId: created.id,
            text: extractAndSaveBase64Images(sanitizeHtml(question.text || '')),
            textEn: question.textEn ? extractAndSaveBase64Images(sanitizeHtml(question.textEn)) : null,
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(question.type) ? sanitizeHtml(question.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof question.options === 'string' ? question.options : JSON.stringify(question.options || [])),
            optionsEn: question.optionsEn ? extractAndSaveBase64Images(typeof question.optionsEn === 'string' ? question.optionsEn : JSON.stringify(question.optionsEn || [])) : null,
            correctAnswer: formatCorrectAnswer(question),
            points: parseInt(question.points) || 1,
            xpPoints: parseInt(question.xpPoints) || 10,
            ...metadataTranslations(question, sanitizeHtml),
            skill: question.skill ? sanitizeHtml(question.skill) : null,
            learningOutcome: (question.learningOutcome ?? question.standard) ? sanitizeHtml(question.learningOutcome ?? question.standard) : null,
            indicator: question.indicator ? sanitizeHtml(question.indicator) : null,
            videoUrl: question.videoUrl ? sanitizeHtml(question.videoUrl) : null,
            level: question.level ? sanitizeHtml(question.level) : 'Medium',
            dok: normalizeBackendDok(question.dok),
            cognitive: question.cognitive ? sanitizeHtml(question.cognitive) : null,
            course: question.course ? sanitizeHtml(question.course) : null,
            section: question.section ? sanitizeHtml(question.section) : null,
            domain: question.domain ? sanitizeHtml(question.domain) : null,
            standard: (question.standard ?? question.learningOutcome) ? sanitizeHtml(question.standard ?? question.learningOutcome) : null,
            subskill: question.subskill ? sanitizeHtml(question.subskill) : null,
            microSkill: question.microSkill ? sanitizeHtml(question.microSkill) : null,
            gradeTarget: question.gradeTarget ? sanitizeHtml(question.gradeTarget) : null,
            errorPattern: question.errorPattern ? sanitizeHtml(question.errorPattern) : null,
            estimatedTime: question.estimatedTime ? sanitizeHtml(question.estimatedTime) : null,
            explanation: formatExplanation(question),
            explanationEn: question.explanationEn ? extractAndSaveBase64Images(sanitizeHtml(question.explanationEn)) : null,
            hint: question.hint ? sanitizeHtml(question.hint) : null,
            hintEn: question.hintEn ? sanitizeHtml(question.hintEn) : null,
            imageUrl: question.imageUrl ? extractAndSaveBase64Images(sanitizeHtml(question.imageUrl)) : null,
            order: question.order !== undefined ? parseInt(question.order) : index,
          }
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
    });

    res.status(201).json(createdSubExam);
  } catch (error) {
    console.error('Error importing module exam JSON:', error);
    res.status(500).json({ error: 'Failed to import exam JSON' });
  }
};

export const getExamHandler21 = async (req: Request, res: Response) => {
  try {
    const { isCentral, status, grade, search, courseId, folderId } = req.query;

    const where: any = { deletedAt: null };
    if (folderId) {
      where.folderId = folderId;
    }

    if ((req as any).user.role === 'SUPER_ADMIN') {
      if (isCentral === 'true') where.isCentral = true;
      if (isCentral === 'false') {
        where.isCentral = false;
        if (req.query.schoolId) where.schoolId = req.query.schoolId;
      }
    } else if ((req as any).user.role === 'SCHOOL_ADMIN') {
      where.OR = [
        { isCentral: true },
        { schoolId: (req as any).user.schoolId }
      ];
    } else if ((req as any).user.role === 'TEACHER') {
      where.OR = [
        { creatorId: (req as any).user.id }
      ];
    } else if ((req as any).user.role === 'STUDENT') {
      where.OR = [
        { isCentral: true },
        { schoolId: (req as any).user.schoolId }
      ];
      if (grade) {
        where.grade = grade;
      }
    }

    const folders = await prisma.examFolder.findMany({
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
  } catch (error: any) {
    console.error('Error fetching exam folders:', error);
    res.status(500).json({ error: 'Failed to fetch exam folders' });
  }
};

export const postExamHandler22 = async (req: Request, res: Response) => {
  try {
    const { title, description, grade, subject, isCentral, schoolId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const folder = await prisma.examFolder.create({
      data: {
        title,
        description,
        grade,
        subject,
        isCentral: (req as any).user.role === 'SUPER_ADMIN' ? !!isCentral : false,
        creatorId: (req as any).user.id,
        schoolId: (req as any).user.role === 'SCHOOL_ADMIN' ? (req as any).user.schoolId : (isCentral ? null : schoolId)
      }
    });

    res.json(folder);
  } catch (error: any) {
    console.error('Error creating exam folder:', error);
    res.status(500).json({ error: 'Failed to create exam folder' });
  }
};

export const putExamHandler23 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, grade, subject } = req.body;

    const existingFolder = await prisma.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
    if (!existingFolder) return res.status(404).json({ error: 'Exam folder not found' });

    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isOwner =
        existingFolder.schoolId === (req as any).user.schoolId ||
        existingFolder.isCentral ||
        existingFolder.creatorId === (req as any).user.id;
      if (!isOwner) return res.status(403).json({ error: 'Access denied: You do not have permission to edit this folder.' });
    }

    const folder = await prisma.examFolder.update({
      where: { id },
      data: { title, description, grade, subject }
    });

    res.json(folder);
  } catch (error: any) {
    console.error('Error updating exam folder:', error);
    res.status(500).json({ error: 'Failed to update exam folder' });
  }
};

export const deleteExamHandler24 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingFolder = await prisma.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
    if (!existingFolder) return res.status(404).json({ error: 'Exam folder not found' });

    if ((req as any).user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied: Only Super Admin can delete exam folders.' });
    }

    await prisma.examFolder.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting exam folder:', error);
    res.status(500).json({ error: 'Failed to delete exam folder' });
  }
};

export const postExamHandler25 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetExamId, targetModuleId, targetSubExamId } = req.body;

    if (!targetExamId) {
      return res.status(400).json({ error: 'targetExamId is required' });
    }

    // 1. Get source exam
    const sourceExam = await prisma.exam.findUnique({
      where: { id },
      include: { schools: { select: { id: true } } }
    });

    if (!sourceExam) {
      return res.status(404).json({ error: 'Source exam not found' });
    }

    if (!await canManageExam((req as any).user, sourceExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move questions from this exam.' });
    }

    // 2. Get target exam
    const targetExam = await prisma.exam.findUnique({
      where: { id: targetExamId },
      include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
    });

    if (!targetExam) {
      return res.status(404).json({ error: 'Target exam not found' });
    }

    if (!await canManageExam((req as any).user, targetExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
    }

    const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;

    await prisma.$transaction(async (tx) => {
      let finalModuleId = targetModuleId;

      // If no specific module is provided, create a new one
      if (!finalModuleId) {
        // 3. Create a new module in target exam using source exam title
        const newModule = await tx.examModule.create({
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
      await tx.question.updateMany({
        where: {
          examId: id,
          moduleId: null
        },
        data: {
          examId: targetExam.id,
          moduleId: finalModuleId,
          ...(targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {})
        }
      });
    });

    res.json({ message: 'Standalone questions moved successfully' });
  } catch (error) {
    console.error('Error moving standalone questions:', error);
    res.status(500).json({ error: 'Failed to move standalone questions' });
  }
};

export const postMoveSingleQuestionHandler = async (req: Request, res: Response) => {
  try {
    const { id, questionId } = req.params;
    const { targetExamId, targetModuleId, targetSubExamId } = req.body;

    if (!targetExamId) {
      return res.status(400).json({ error: 'targetExamId is required' });
    }

    const sourceExam = await prisma.exam.findUnique({
      where: { id },
      include: { schools: { select: { id: true } } }
    });
    if (!sourceExam) {
      return res.status(404).json({ error: 'Source exam not found' });
    }

    if (!await canManageExam((req as any).user, sourceExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move questions from this exam.' });
    }

    const question = await prisma.question.findFirst({
      where: { id: questionId, examId: id, deletedAt: null }
    });
    if (!question) {
      return res.status(404).json({ error: 'Question not found in source exam' });
    }

    const targetExam = await prisma.exam.findUnique({
      where: { id: targetExamId },
      include: { schools: { select: { id: true } } }
    });
    if (!targetExam) {
      return res.status(404).json({ error: 'Target exam not found' });
    }

    if (!await canManageExam((req as any).user, targetExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
    }

    let finalModuleId = targetModuleId || null;
    let finalSubExamId = targetSubExamId || null;

    if (finalModuleId) {
      const moduleExists = await prisma.examModule.findFirst({
        where: { id: finalModuleId, examId: targetExamId }
      });
      if (!moduleExists) {
        return res.status(400).json({ error: 'Target module not found in target exam' });
      }
    }

    if (finalSubExamId) {
      const subExamExists = await prisma.subExam.findFirst({
        where: {
          id: finalSubExamId,
          ...(finalModuleId ? { moduleId: finalModuleId } : { module: { examId: targetExamId } })
        }
      });
      if (!subExamExists) {
        return res.status(400).json({ error: 'Target sub-exam not found in target exam or module' });
      }
      if (!finalModuleId) {
        finalModuleId = subExamExists.moduleId;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const lastQuestion = await tx.question.findFirst({
        where: {
          examId: targetExamId,
          moduleId: finalModuleId,
          subExamId: finalSubExamId,
          deletedAt: null
        },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const newOrder = (lastQuestion?.order ?? -1) + 1;

      return tx.question.update({
        where: { id: questionId },
        data: {
          examId: targetExamId,
          moduleId: finalModuleId,
          subExamId: finalSubExamId,
          order: newOrder
        }
      });
    });

    res.json({
      success: true,
      message: 'Question moved successfully',
      question: result
    });
  } catch (error: any) {
    console.error('Error moving single question:', error);
    res.status(500).json({ error: error?.message || 'Failed to move question' });
  }
};

export const postExamHandler26 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetExamId, targetModuleId, targetSubExamId } = req.body;

    if (!targetExamId) {
      return res.status(400).json({ error: 'targetExamId is required' });
    }

    // 1. Get source exam
    const sourceExam = await prisma.exam.findUnique({
      where: { id },
      include: { questions: { where: { deletedAt: null } }, schools: { select: { id: true } } }
    });

    if (!sourceExam) {
      return res.status(404).json({ error: 'Source exam not found' });
    }

    // Ownership check on SOURCE exam — prevent stealing/deleting another school's exam
    if (!await canManageExam((req as any).user, sourceExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move this exam.' });
    }

    // 2. Get target exam
    const targetExam = await prisma.exam.findUnique({
      where: { id: targetExamId },
      include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
    });

    if (!targetExam) {
      return res.status(404).json({ error: 'Target exam not found' });
    }

    if (!await canManageExam((req as any).user, targetExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
    }

    const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;

    await prisma.$transaction(async (tx) => {
      let finalModuleId = targetModuleId;

      // If no specific module is provided, create a new one
      if (!finalModuleId) {
        // 3. Create a new module in target exam
        const newModule = await tx.examModule.create({
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
      await tx.question.updateMany({
        where: { examId: id },
        data: {
          examId: targetExam.id,
          moduleId: finalModuleId,
          ...(targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {})
        }
      });

      // 5. Soft Delete the old exam
      await tx.exam.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
    });

    res.json({ success: true, message: 'Exam content successfully moved to module.' });
  } catch (error: any) {
    console.error('Error moving exam to module:', error);
    res.status(500).json({ error: 'Failed to move exam to module' });
  }
};

export const cleanDuplicatesHandler = async (req: Request, res: Response) => {
  try {
    const userRole = (req as any).user?.role;
    let examId: string | undefined = undefined;

    if (req.params.id) {
      if (req.body?.examId && String(req.body.examId) !== String(req.params.id)) {
        return res.status(400).json({ error: 'Mismatched exam ID between path and body parameters.' });
      }
      examId = String(req.params.id);
    } else if (userRole === 'SUPER_ADMIN') {
      examId = req.body?.examId ? String(req.body.examId) : undefined;
    } else {
      return res.status(403).json({ error: 'Exam ID path parameter is required.' });
    }

    const result = await runSafeDeduplicationAndEmptyCleanup(examId);
    return res.json({
      success: true,
      message: `تم تنظيف ${result.duplicatesDeleted} سؤال مكرر و ${result.emptyQuestionsDeleted} سؤال فارغ بنجاح!`,
      ...result,
    });
  } catch (err: any) {
    console.error('cleanDuplicatesHandler error:', err);
    return res.status(500).json({ error: err.message || 'Failed to clean duplicates' });
  }
};
