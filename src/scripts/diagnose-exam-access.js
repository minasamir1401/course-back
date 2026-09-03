require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const {
  buildExamAccessDiagnosis,
  collectExamAccessCandidates,
} = require('./lib/exam-access-diagnosis');

const prisma = new PrismaClient();

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function findUser(identifier) {
  if (!identifier) return null;
  return prisma.user.findFirst({
    where: {
      OR: [
        { id: identifier },
        { username: identifier },
      ],
    },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      schoolId: true,
      status: true,
      grade: true,
    },
  });
}

async function findAutoCandidates(exam) {
  const teacherCourseLinks = exam.courseId
    ? await prisma.teacherCourse.findMany({
        where: { courseId: exam.courseId },
        select: { teacherId: true },
      })
    : [];

  const teacherCourseUserIds = teacherCourseLinks.map((link) => link.teacherId);
  const relevantSchoolIds = [...new Set([
    exam.schoolId,
    ...(Array.isArray(exam.schools) ? exam.schools.map((school) => school.id) : []),
  ].filter(Boolean))];

  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { id: exam.creatorId || undefined },
        { id: { in: teacherCourseUserIds.length ? teacherCourseUserIds : ['__never__'] } },
        { schoolId: { in: relevantSchoolIds.length ? relevantSchoolIds : ['__never__'] }, role: { in: ['SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'] } },
        { role: 'SUPER_ADMIN' },
      ],
    },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      schoolId: true,
      status: true,
      grade: true,
    },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });

  return collectExamAccessCandidates({
    exam,
    users,
    teacherCourseUserIds,
  });
}

async function callRuntimeApi(baseUrl, examId, user) {
  if (!process.env.JWT_SECRET) {
    return {
      listStatus: null,
      listContainsExam: null,
      detailStatus: null,
      detailError: 'JWT_SECRET is missing',
    };
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, schoolId: user.schoolId, grade: user.grade },
    process.env.JWT_SECRET,
    { expiresIn: '5m' },
  );

  const headers = { Authorization: `Bearer ${token}` };

  let listStatus = null;
  let listContainsExam = null;
  let detailStatus = null;
  let detailError = null;

  try {
    const listResponse = await fetch(`${baseUrl}/api/exams`, { headers });
    listStatus = listResponse.status;
    const listJson = await listResponse.json().catch(() => null);
    listContainsExam = Array.isArray(listJson) ? listJson.some((exam) => exam.id === examId) : false;
  } catch (error) {
    detailError = `List API failed: ${error.message}`;
  }

  try {
    const detailResponse = await fetch(`${baseUrl}/api/exams/${examId}`, { headers });
    detailStatus = detailResponse.status;
    if (!detailResponse.ok) {
      const detailJson = await detailResponse.json().catch(() => null);
      detailError = detailJson?.error || detailError;
    }
  } catch (error) {
    detailError = `Detail API failed: ${error.message}`;
  }

  return { listStatus, listContainsExam, detailStatus, detailError };
}

async function main() {
  const examId = getArg('--exam');
  const userIdentifier = getArg('--user');
  const baseUrl = getArg('--base-url') || `http://127.0.0.1:${process.env.PORT || 5000}`;
  const skipApi = hasFlag('--skip-api');

  if (!examId) {
    console.error('Usage: node src/scripts/diagnose-exam-access.js --exam <examId> [--user <userId|username>] [--base-url http://127.0.0.1:5000] [--skip-api]');
    process.exit(1);
  }

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      isCentral: true,
      schoolId: true,
      courseId: true,
      creatorId: true,
      status: true,
      schools: {
        select: { id: true, name: true },
      },
    },
  });

  if (!exam) {
    console.error(JSON.stringify({ error: `Exam not found: ${examId}` }, null, 2));
    process.exit(2);
  }

  if (!userIdentifier) {
    const candidates = await findAutoCandidates(exam);
    const reports = [];

    for (const candidate of candidates) {
      const apiChecks = skipApi
        ? {}
        : await callRuntimeApi(baseUrl, examId, candidate);

      reports.push(buildExamAccessDiagnosis({
        exam,
        user: candidate,
        teacherCourseLinked: candidate.teacherCourseLinked,
        apiChecks,
      }));
    }

    const autoReport = {
      generatedAt: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV || null,
        port: process.env.PORT || null,
        baseUrl: skipApi ? null : baseUrl,
        skipApi,
        autoMode: true,
      },
      exam: {
        id: exam.id,
        title: exam.title,
        status: exam.status,
      },
      candidateCount: reports.length,
      recommendedUsers: reports
        .filter((report) => report.expected.detailAccessibleUnderCurrentCode || report.apiChecks.detailStatus === 403)
        .map((report) => ({
          username: report.user.username,
          role: report.user.role,
          schoolId: report.user.schoolId,
          likelyCause: report.summary.likelyCause,
          detailAccessibleUnderCurrentCode: report.expected.detailAccessibleUnderCurrentCode,
          detailStatus: report.apiChecks.detailStatus,
        })),
      reports,
    };

    console.log(JSON.stringify(autoReport, null, 2));
    return;
  }

  const user = await findUser(userIdentifier);
  if (!user) {
    console.error(JSON.stringify({ error: `User not found: ${userIdentifier}` }, null, 2));
    process.exit(3);
  }

  const teacherCourseLinked = Boolean(
    user.role === 'TEACHER' && exam.courseId && await prisma.teacherCourse.findFirst({
      where: {
        teacherId: user.id,
        courseId: exam.courseId,
      },
      select: { id: true },
    }),
  );

  const apiChecks = skipApi
    ? {}
    : await callRuntimeApi(baseUrl, examId, user);

  const report = buildExamAccessDiagnosis({
    exam,
    user,
    teacherCourseLinked,
    apiChecks,
  });

  const enrichedReport = {
    generatedAt: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV || null,
      port: process.env.PORT || null,
      baseUrl: skipApi ? null : baseUrl,
      skipApi,
    },
    ...report,
  };

  console.log(JSON.stringify(enrichedReport, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    process.exit(10);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
