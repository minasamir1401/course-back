import prisma from '../lib/prisma';
import webpush from 'web-push';
import { buildStudentCourseWhere, examMatchesStudent, getStudentGradeAndStage, parseStringArray } from '../shared';
import { validPushEndpoint } from '../lib/studentDeliveryPolicy';

const CHECKPOINT = 'student-notifications:checkpoint:v1';
const inWindow = (value: Date | null, from: Date, to: Date) => !!value && value >= from && value <= to;
export const pushPublicKey = () => process.env.VAPID_PUBLIC_KEY || '';
export const pushEnabled = () => !!(pushPublicKey() && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
export async function createStudentNotice(db: any, userId: string, eventKey: string, kind: string, titleAr: string, titleEn: string, body: string, href: string) {
  // Inbox and per-device outbox commit together; any failed scan can safely replay.
  return db.$transaction(async (tx: any) => {
    const notice = await tx.studentNotification.upsert({ where: { userId_eventKey: { userId, eventKey } }, update: {}, create: { userId, eventKey, kind, titleAr, titleEn, body, href } });
    const subscriptions = await tx.pushSubscription.findMany({ where: { userId }, select: { id: true } });
    if (subscriptions.length) await tx.pushDelivery.createMany({ data: subscriptions.map((sub: any) => ({ notificationId: notice.id, subscriptionId: sub.id })), skipDuplicates: true });
    return notice;
  });
}

export async function scanStudentContent(db: any = prisma, now = new Date()) {
  const saved = await db.notificationCursor.findUnique({ where: { key: CHECKPOINT } });
  if (!saved) {
    // Start prospectively. Installing this feature must not notify about the entire old catalog.
    await db.notificationCursor.upsert({ where: { key: CHECKPOINT }, update: {}, create: { key: CHECKPOINT, value: now } });
    return;
  }
  const from = new Date(saved.value);
  if (Number.isNaN(from.getTime())) throw new Error('Invalid notification checkpoint');
  let cursor: string | undefined;
  while (true) {
    const students = await db.user.findMany({ where: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null }, take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, schoolId: true, grade: true, createdAt: true } });
    for (const student of students) {
      // Do not send events which predate a new student's account.
      const since = new Date(Math.max(from.getTime(), student.createdAt.getTime()));
      const notice = (key: string, kind: string, ar: string, en: string, title: string, href: string) => createStudentNotice(db, student.id, key, kind, ar, en, title, href);
      const courseWhere = { ...buildStudentCourseWhere(student), deletedAt: null };
      const [courses, lessons, exams] = await Promise.all([
        db.course.findMany({ where: { ...courseWhere, OR: [{ createdAt: { gte: since, lte: now } }, { updatedAt: { gte: since, lte: now } }] }, select: { id: true, title: true } }),
        db.lesson.findMany({ where: { deletedAt: null, isVisible: true, course: courseWhere, AND: [{ OR: [{ cutOffDate: null }, { cutOffDate: { gt: now } }] }, { OR: [{ createdAt: { gte: since, lte: now } }, { publishDate: { gte: since, lte: now } }, { updatedAt: { gte: since, lte: now } }] }] }, select: { id: true, title: true, courseId: true, createdAt: true, publishDate: true } }),
        db.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', AND: [{ OR: [{ endDate: null }, { endDate: { gt: now } }] }, { OR: [{ isCentral: true }, { schoolId: student.schoolId || '__none__' }, { schools: { some: { id: student.schoolId || '__none__' } } }] }] }, include: { schools: { select: { id: true } }, course: { select: { id: true, deletedAt: true } }, modules: { include: { subExams: true } } } }),
      ]);
      for (const course of courses) await notice(`COURSE:${course.id}`, 'COURSE', 'مقرر أُضيف أو حُدّث في مساحتك', 'A course was added or updated in your learning space', course.title, `/courses/${course.id}`);
      for (const lesson of lessons) {
        const href = `/lessons/${lesson.id}?courseId=${lesson.courseId}`;
        if (lesson.publishDate && lesson.publishDate > now) continue; // Never reveal unreleased lesson content.
        const released = inWindow(lesson.publishDate, since, now);
        await notice(released ? `LESSON_OPEN:${lesson.id}:${lesson.publishDate.toISOString()}` : `LESSON:${lesson.id}`, 'LESSON', released ? 'حان موعد الدرس' : 'درس جديد أو محدّث', released ? 'Your lesson is now available' : 'New or updated lesson', lesson.title, href);
      }
      for (const exam of exams) {
        if (!examMatchesStudent(exam, student) || (exam.course && exam.course.deletedAt)) continue;
        const href = `/exams/${exam.id}/details`;
        const start = exam.startDate || exam.createdAt;
        if (!inWindow(start, since, now) && (inWindow(exam.createdAt, since, now) || inWindow(exam.updatedAt, since, now))) await notice(`EXAM:${exam.id}`, 'EXAM', 'تقييم أُضيف إلى جدولك', 'An assessment was added to your schedule', exam.title, href);
        if (inWindow(start, since, now)) await notice(`EXAM_OPEN:${exam.id}:${start.toISOString()}`, 'EXAM_OPEN', 'الامتحان متاح الآن', 'Your assessment is now open', exam.title, href);
        for (const module of exam.modules) {
          const lineage: any[] = []; const seen = new Set<string>(); let current: any = module;
          while (current && !seen.has(current.id)) { seen.add(current.id); lineage.push(current); current = current.parentModuleId ? exam.modules.find((entry: any) => entry.id === current.parentModuleId) : null; }
          const studentGrades = getStudentGradeAndStage(student.grade);
          if (lineage.some(entry => entry.gradeTarget && !parseStringArray(entry.gradeTarget).some((grade: string) => studentGrades.includes(grade)) && !studentGrades.includes(entry.gradeTarget))) continue;
          if (lineage.some(entry => entry.cutOffDate && entry.cutOffDate <= now)) continue;
          const startTimes = [exam.startDate, ...lineage.map(entry => entry.publishDate)].filter(Boolean) as Date[];
          const moduleAt = startTimes.length ? new Date(Math.max(...startTimes.map(d => d.getTime()))) : module.createdAt;
          if (module.cutOffDate && module.cutOffDate <= now) continue;
          if (inWindow(moduleAt, since, now)) await notice(`MODULE_OPEN:${module.id}:${moduleAt.toISOString()}`, 'EXAM_OPEN', 'قسم امتحان متاح الآن', 'An assessment section is now open', `${exam.title} — ${module.title}`, href);
          for (const sub of module.subExams) {
            const dates = [...startTimes, sub.publishDate].filter(Boolean) as Date[];
            const at = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : sub.createdAt;
            if ((!sub.cutOffDate || sub.cutOffDate > now) && inWindow(at, since, now)) await notice(`SUBEXAM_OPEN:${sub.id}:${at.toISOString()}`, 'EXAM_OPEN', 'اختبار فرعي متاح الآن', 'A sub-assessment is now open', `${exam.title} — ${sub.title}`, `/exams/${exam.id}?subExamId=${sub.id}`);
          }
        }
      }
    }
    if (students.length < 100) break;
    cursor = students[students.length - 1].id;
  }
  await db.notificationCursor.update({ where: { key: CHECKPOINT }, data: { value: now } });
}

export async function deliverStudentPush(db: any = prisma) {
  if (!pushEnabled()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, pushPublicKey(), process.env.VAPID_PRIVATE_KEY!);
  const deliveries = await db.pushDelivery.findMany({ where: { deliveredAt: null, attempts: { lt: 6 }, nextAttemptAt: { lte: new Date() } }, include: { notification: true, subscription: { include: { user: { select: { status: true, deletedAt: true } } } } }, take: 100, orderBy: { nextAttemptAt: 'asc' } });
  for (const job of deliveries) {
    const sub = job.subscription;
    if (!validPushEndpoint(sub.endpoint) || sub.user.status !== 'ACTIVE' || sub.user.deletedAt || job.notification.userId !== sub.userId) {
      await db.pushSubscription.deleteMany({ where: { id: sub.id } }); continue;
    }
    try {
      // Generic device message protects lesson titles and certificates on shared lock screens.
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: 'Klevro', body: sub.language === 'en' ? 'You have a new update in your learning space.' : 'لديك تحديث جديد في مساحتك الدراسية.', url: '/notifications', tag: job.notification.id }), { TTL: 3600, timeout: 10000 });
      await db.pushDelivery.update({ where: { id: job.id }, data: { deliveredAt: new Date() } });
    } catch (error: any) {
      if ([404, 410].includes(error.statusCode)) await db.pushSubscription.deleteMany({ where: { id: sub.id } });
      else await db.pushDelivery.update({ where: { id: job.id }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts)) } });
    }
  }
}

let running = false;
export function startStudentNotifications() {
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') return;
  const tick = async () => {
    if (running) return; running = true;
    try { await scanStudentContent(); await deliverStudentPush(); }
    catch (error) { console.error('[Student notifications] Retry on next scan:', error); }
    finally { running = false; }
  };
  void tick();
  setInterval(tick, 60_000).unref();
}
