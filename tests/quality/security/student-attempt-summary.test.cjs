process.env.JWT_SECRET='student-ui-test-key-not-for-production-2026';
require('ts-node/register/transpile-only');
const mockAttempts=jest.fn(async()=>[{id:'own-result',subExamId:'child',createdAt:new Date('2026-01-01')}]);
const mockExam={id:'exam',title:'School exam',status:'PUBLISHED',schoolId:'school',isCentral:false,schools:[],grade:null,grades:null,questions:[],modules:[{id:'module',subExams:[],subModules:[],_count:{questions:0}}]};
jest.mock('../../../src/lib/prisma',()=>({__esModule:true,default:{
 exam:{findUnique:jest.fn(async()=>mockExam),findMany:jest.fn(async()=>[mockExam])},
 examSubmission:{findMany:mockAttempts},
 user:{findUnique:jest.fn(async()=>({id:'student',schoolId:'school',grade:'Grade 3'}))}
}}));
jest.mock('../../../src/lib/redis',()=>({cacheGetJSON:jest.fn(async()=>null),cacheSetJSON:jest.fn(async()=>{}),cacheDelete:jest.fn(async()=>{})}));
jest.mock('../../../src/scripts/clean-duplicates-and-empty',()=>({runSafeDeduplicationAndEmptyCleanup:jest.fn()}));
const prisma=require('../../../src/lib/prisma').default;
const {getExamHandler10}=require('../../../src/controllers/examEditing');
const {getExamHandler3}=require('../../../src/controllers/examManagement');
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
test('exam details request only the signed-in student attempt identities',async()=>{
 const res=response();await getExamHandler10({params:{id:'exam'},query:{includeQuestions:'false'},user:{id:'student',role:'STUDENT',schoolId:'school',grade:'Grade 3'}},res);
 expect(res.statusCode).toBe(200);expect(mockAttempts).toHaveBeenCalledWith({where:{examId:'exam',userId:'student'},select:{id:true,subExamId:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 expect(res.body.submissions[0].id).toBe('own-result');
});
test('exam list relation is filtered to the current student without scores or answers',async()=>{
 const res=response();await getExamHandler3({params:{},query:{},user:{id:'student',role:'STUDENT',schoolId:'school',grade:'Grade 3'}},res);
 expect(res.statusCode).toBe(200);expect(prisma.exam.findMany.mock.calls.at(-1)[0].include.submissions).toEqual({where:{userId:'student'},select:{id:true,subExamId:true,createdAt:true}});
});
test('a student outside the assigned school cannot read attempt identities',async()=>{
 prisma.user.findUnique.mockResolvedValueOnce({id:'other',schoolId:'other-school',grade:'Grade 3'});
 const res=response();await getExamHandler10({params:{id:'exam'},query:{includeQuestions:'false'},user:{id:'other',role:'STUDENT',schoolId:'other-school',grade:'Grade 3'}},res);
 expect(res.statusCode).toBe(403);expect(mockAttempts).not.toHaveBeenCalled();
});
