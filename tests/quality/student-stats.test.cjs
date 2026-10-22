require('ts-node/register/transpile-only');
const mockDb = {
  user: { findUnique: jest.fn() }, examSubmission: { findMany: jest.fn(), count: jest.fn() },
  lessonProgress: { findMany: jest.fn() }, course: { findMany: jest.fn() }, courseProgress: { findMany: jest.fn() },
  exam: { findMany: jest.fn() }, lesson: { groupBy: jest.fn(), findMany: jest.fn() }, subExam: { findMany: jest.fn() },
};
const mockCacheWrite = jest.fn();
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../src/middleware/auth', () => ({ verifyToken: (req,res,next) => next(), checkRole: () => (req,res,next) => next(), checkSchoolAccess: (req,res,next) => next() }));
jest.mock('../../src/shared', () => ({ getCacheAsync: async () => null, setCache: (...args) => mockCacheWrite(...args),
  buildStudentCourseWhere: user => ({ schoolId: user.schoolId, grade: user.grade }), examMatchesStudent: (exam, user) => exam.grade === user.grade && exam.schoolId === user.schoolId,
}));
const router = require('../../src/routes/progress').default;
const handler = router.stack.find(layer => layer.route?.path === '/api/student/stats').route.stack.at(-1).handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const student = { id:'me', name:'Stored name', schoolId:'school', grade:'grade', xp:17, school:{name:'School'}, classroom:null };
beforeEach(() => {
  jest.clearAllMocks(); mockDb.user.findUnique.mockResolvedValue(student); mockDb.examSubmission.findMany.mockResolvedValue([]); mockDb.examSubmission.count.mockResolvedValue(0);
  for (const key of ['lessonProgress','course','courseProgress','exam','lesson','subExam']) if (mockDb[key].findMany) mockDb[key].findMany.mockResolvedValue([]);
  mockDb.lesson.groupBy.mockResolvedValue([]);
});
test('empty student records return zero progress and unknown grades, without seeded results', async () => {
  const res=response(); await handler({ user:{id:'me'}, query:{userId:'someone-else'} },res);
  expect(res.statusCode).toBe(200); expect(res.body).toMatchObject({name:'Stored name',xp:17,totalExams:0,avgScore:null,passRate:null,overallCourseProgress:0,courseProgresses:[],upcomingTasks:[],recentExams:[]});
  expect(mockDb.user.findUnique.mock.calls[0][0].where).toEqual({id:'me'});
  for (const [options] of mockDb.examSubmission.findMany.mock.calls) expect(options.where).toEqual({userId:'me',exam:{resultVisibility:{not:'HIDE_ALL'}}});
});
test('student summary calculates from recorded lessons, latest grades and awarded XP only', async () => {
  mockDb.course.findMany.mockResolvedValue([{id:'course',title:'Stored course',subject:'Math',coverImage:'/uploads/actual.webp'}]);
  mockDb.lesson.groupBy.mockResolvedValue([{courseId:'course',_count:{_all:4},_sum:{duration:1200}}]);
  mockDb.lessonProgress.findMany.mockResolvedValue([{isCompleted:true,activeStudySeconds:90,lesson:{courseId:'course'}},{isCompleted:false,activeStudySeconds:30,lesson:{courseId:'course'}}]);
  mockDb.examSubmission.findMany.mockResolvedValue([{id:'attempt',examId:'exam',subExamId:null,percentage:25,totalScore:1,createdAt:new Date(),exam:{title:'Stored exam',passingScore:50},answers:[{isCorrect:true},{isCorrect:false}],reportSnapshot:{passingScore:20}}]);
  mockDb.examSubmission.count.mockResolvedValue(9);
  mockDb.exam.findMany.mockResolvedValue([{id:'yes',title:'Published',schoolId:'school',grade:'grade',startDate:new Date('2099-01-01')},{id:'other-grade',schoolId:'school',grade:'other'}]);
  const res=response(); await handler({user:{id:'me'},query:{}},res);
  expect(res.body).toMatchObject({xp:17,totalExams:9,avgScore:25,passRate:100,overallCourseProgress:25,activeStudySeconds:120});
  expect(res.body.courseProgresses[0]).toMatchObject({title:'Stored course',coverImage:'/uploads/actual.webp',totalLessons:4,completedLessonsCount:1,progressPercent:25});
  expect(res.body.upcomingTasks.map(item=>item.id)).toEqual(['yes']);
  expect(mockDb.lesson.groupBy.mock.calls[0][0].where).toEqual({courseId:{in:['course']},deletedAt:null});
  expect(mockDb.course.findMany.mock.calls[0][0].where).toEqual({schoolId:'school',grade:'grade',deletedAt:null});
});
test('database failure returns an error instead of a successful placeholder summary', async () => {
  mockDb.user.findUnique.mockRejectedValue(new Error('Database unavailable')); const error=jest.spyOn(console,'error').mockImplementation(()=>{});
  const res=response(); await handler({user:{id:'me'}},res); expect(res.statusCode).toBe(500); expect(res.body).not.toHaveProperty('avgScore'); expect(mockCacheWrite).not.toHaveBeenCalled(); error.mockRestore();
});
