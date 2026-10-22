process.env.JWT_SECRET = 'skills-hub-policy-regression-test-key-at-least-32';
const mockPrisma = {
  skillCluster:{findUnique:jest.fn(),findMany:jest.fn(),create:jest.fn(),update:jest.fn(),delete:jest.fn()},
  skillLesson:{findUnique:jest.fn(),delete:jest.fn()}, interactiveActivity:{findUnique:jest.fn(),findMany:jest.fn(),delete:jest.fn()},
  user:{findUnique:jest.fn(),update:jest.fn()},activityAttempt:{findMany:jest.fn(),count:jest.fn(),create:jest.fn()},xPHistory:{findMany:jest.fn(),count:jest.fn(),create:jest.fn()},school:{count:jest.fn()},systemSetting:{findUnique:jest.fn()}
};
jest.mock('../../../src/lib/prisma',()=>({__esModule:true,default:mockPrisma}));
jest.mock('../../../src/lib/redis',()=>({cacheGetJSON:jest.fn(),cacheSetJSON:jest.fn(),cacheDelete:jest.fn(),isRedisActive:()=>false}));
const router = require('../../../src/routes/skillsHub').default;
const access = require('../../../src/utils/skillAccess');
const {parseSkillExcelRows} = require('../../../src/utils/skillExcel');
const cluster = {id:'cluster',schoolId:'school-a',schoolIds:'["school-a"]',grade:'["الصف الأول الثانوي"]',isCentral:false,creatorId:'author'};
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
const handlers=(path,method)=>router.stack.find(layer=>layer.route?.path===path && layer.route.methods[method]).route.stack.map(layer=>layer.handle);
beforeEach(()=>{mockPrisma.systemSetting.findUnique.mockResolvedValue({value:'false'});mockPrisma.skillCluster.findUnique.mockResolvedValue(cluster);mockPrisma.skillLesson.findUnique.mockResolvedValue({id:'lesson',cluster});mockPrisma.interactiveActivity.findUnique.mockResolvedValue({id:'activity',lesson:{cluster}});mockPrisma.skillCluster.findMany.mockResolvedValue([]);mockPrisma.activityAttempt.findMany.mockResolvedValue([]);mockPrisma.xPHistory.findMany.mockResolvedValue([]);});
test.each(['/api/skills-hub/clusters/:id','/api/skills-hub/lessons/:id','/api/skills-hub/activities/:id'])('central deletion switch controls %s',async path=>{
 const route=handlers(path,'delete'),req={params:{id:'item'},user:{id:'teacher',role:'TEACHER',schoolId:'school-a'}};
 let res=response(),next=jest.fn();await route[2](req,res,next);expect(res.statusCode).toBe(403);expect(next).not.toHaveBeenCalled();
 mockPrisma.systemSetting.findUnique.mockResolvedValue({value:'true'});res=response();await route[2](req,res,next);expect(next).toHaveBeenCalled();await route[3](req,res);expect(res.statusCode).toBe(200);
 req.user.schoolId='school-b';res=response();await route[3](req,res);expect(res.statusCode).toBe(403);
 req.user={role:'SUPER_ADMIN'};mockPrisma.systemSetting.findUnique.mockResolvedValue({value:'false'});next.mockClear();await route[2](req,response(),next);expect(next).toHaveBeenCalled();
});
test('student progress cannot inspect a student in another school',async()=>{mockPrisma.user.findUnique.mockResolvedValue({id:'other',role:'STUDENT',schoolId:'school-b',grade:'الصف الأول الثانوي'});const res=response();await handlers('/api/skills-hub/progress','get').at(-1)({query:{userId:'other'},user:{id:'admin',role:'SCHOOL_ADMIN',schoolId:'school-a'}},res);expect(res.statusCode).toBe(403);expect(mockPrisma.skillCluster.findMany).not.toHaveBeenCalled();});
test('multi-school assignments persist and return every selection',async()=>{mockPrisma.school.count.mockResolvedValue(2);mockPrisma.skillCluster.create.mockImplementation(async({data})=>data);const res=response();await handlers('/api/skills-hub/clusters','post').at(-1)({user:{id:'admin',role:'SUPER_ADMIN'},body:{name:'Test',subject:'SAT',grades:['الصف الأول الثانوي'],schoolIds:['school-a','school-b']}},res);expect(res.body.cluster.schoolIds).toEqual(['school-a','school-b']);expect(JSON.parse(mockPrisma.skillCluster.create.mock.calls[0][0].data.schoolIds)).toHaveLength(2);});
test('JSON grade targets and multi-school access remain scoped',()=>{expect(access.canViewSkillCluster({role:'STUDENT',schoolId:'school-b'},{...cluster,schoolIds:'["school-a","school-b"]'},['الصف الأول الثانوي'])).toBe(true);expect(access.canViewSkillCluster({role:'STUDENT',schoolId:'school-b'},cluster,['الصف الأول الثانوي'])).toBe(false);expect(access.canViewSkillCluster({role:'STUDENT',schoolId:'school-a'},cluster,['الصف الثاني الثانوي'])).toBe(false);});
test('student activity payload hides answers without removing prompts',()=>{const raw={type:'MCQ',title:'Prompt',correctAnswer:'A',correctAnswerEn:'A',explanation:'Solution',options:'[{"text":"First","isCorrect":true},{"text":"Second"}]'};const result=access.skillActivityPayload(raw,true);expect(result.correctAnswer).toBeUndefined();expect(result.correctAnswerEn).toBeUndefined();expect(result.explanation).toBeUndefined();expect(result.options[0]).toEqual({text:'First'});expect(access.skillActivityPayload(raw,false).correctAnswer).toBe('A');});
test('crosswords and scrambled words expose only playable content',()=>{expect(access.skillActivityPayload({type:'CROSSWORD',options:{words:[{word:'CAT',clue:'Animal'}]}},true).options.words).toEqual([{clue:'Animal',length:3}]);const options=access.skillActivityPayload({type:'WORD_SCRAMBLE',options:{word:'CAT'}},true).options;expect(options.word).toBeUndefined();expect(options.letters.sort()).toEqual(['A','C','T']);});
test('Excel import rejects malformed rows before any write',()=>{const row={title:'Question',type:'MCQ',options:'["3","4"]',correctAnswer:'B'};expect(parseSkillExcelRows([row],'lesson')[0].lessonId).toBe('lesson');expect(()=>parseSkillExcelRows([row,{...row,options:'invalid'}],'lesson')).toThrow('Row 3');expect(()=>parseSkillExcelRows([{...row,correctAnswer:'Z'}],'lesson')).toThrow('correctAnswer');});

test('activity progress distinguishes a fresh activity from an incorrect saved attempt and reports awarded XP',async()=>{
 mockPrisma.user.findUnique.mockResolvedValue({id:'learner',role:'STUDENT',schoolId:'school-a',grade:'الصف الأول الثانوي'});
 const activities=[{id:'fresh',title:'جديد',titleEn:'Fresh activity',type:'MCQ',points:50},{id:'wrong',title:'Tried',type:'MCQ',points:50},{id:'correct',title:'Correct',type:'MCQ',points:50}];
 mockPrisma.skillCluster.findMany.mockResolvedValue([{...cluster,subject:'Math',skills:[{id:'skill',name:'Practice',activities}]}]);
 mockPrisma.activityAttempt.findMany.mockResolvedValue([{activityId:'wrong',stars:0,score:0,isCorrect:false},{activityId:'correct',stars:3,score:50,isCorrect:true}]);
 mockPrisma.xPHistory.findMany.mockResolvedValue([{sourceId:'skill',xp:7},{sourceId:'skill',xp:10}]);
 const res=response();await handlers('/api/skills-hub/progress','get').at(-1)({query:{},user:{id:'learner',role:'STUDENT'}},res);
 expect(res.statusCode).toBe(200);const returned=res.body.clusters[0];expect(returned.skills[0].activities[0].titleEn).toBe('Fresh activity');expect(returned.skills[0].activities.map(a=>a.hasAttempt)).toEqual([false,true,true]);expect(returned.stats.totalStarsEarned).toBe(3);expect(returned.stats.totalXPEarned).toBe(17);expect(returned.stats.completedActivities).toBe(1);
 expect(mockPrisma.xPHistory.findMany).toHaveBeenLastCalledWith({where:{userId:'learner',sourceType:'INTERACTIVE_ACTIVITY',sourceId:{in:['skill']}},select:{sourceId:true,xp:true}});
});

test('activity evaluation persists the submitted answer and only awards first-attempt XP',async()=>{
 mockPrisma.interactiveActivity.findUnique.mockResolvedValue({id:'activity',lessonId:'skill',type:'MCQ',options:'["4","5"]',correctAnswer:'4',points:25,xpPoints:7,lesson:{cluster}});
 mockPrisma.interactiveActivity.findMany.mockResolvedValue([]);mockPrisma.xPHistory.findMany.mockResolvedValue([]);mockPrisma.activityAttempt.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);mockPrisma.activityAttempt.create.mockResolvedValue({id:'saved-attempt'});
 const req={params:{id:'activity'},body:{selectedAnswer:'4',timeTaken:12,hintsUsed:0,attemptCount:1},user:{id:'learner',role:'STUDENT',schoolId:'school-a',grade:'الصف الأول الثانوي'}};
 const evaluate=handlers('/api/skills-hub/activities/:id/attempt','post').at(-1);let res=response();await evaluate(req,res);expect(res.statusCode).toBe(200);expect(res.body).toMatchObject({attemptId:'saved-attempt',isCorrect:true,score:25,stars:3,earnedXP:7});
 expect(mockPrisma.activityAttempt.create).toHaveBeenCalledWith({data:expect.objectContaining({userId:'learner',activityId:'activity',selectedAnswer:'4',timeTaken:12})});expect(mockPrisma.xPHistory.create).toHaveBeenCalledWith({data:expect.objectContaining({userId:'learner',questionId:'activity',xp:7,attemptNum:1})});
 res=response();await evaluate(req,res);expect(res.body.earnedXP).toBe(0);expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);expect(mockPrisma.user.update).toHaveBeenCalledWith({where:{id:'learner'},data:{xp:{increment:7}}});
});
