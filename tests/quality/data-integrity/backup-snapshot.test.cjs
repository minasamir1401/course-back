require('ts-node/register/transpile-only');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { Prisma } = require('@prisma/client');
const source = path.resolve(__dirname, '../../../src/lib/backupSnapshot.ts');
const api = require('fs').existsSync(source) ? require(source) : {};
const models = Prisma.dmmf.datamodel.models;
function database(seed = {}) {
  const tables = Object.fromEntries(models.map(m => [m.name[0].toLowerCase() + m.name.slice(1), new Map((seed[m.name[0].toLowerCase() + m.name.slice(1)] || []).map(r => [r.id, structuredClone(r)]))]));
  let txActive = false;
  const tx = {};
  for (const m of models) {
    const key = m.name[0].toLowerCase() + m.name.slice(1);
    const validate = row => {
      for (const rel of m.fields.filter(f => f.kind === 'object' && f.relationFromFields?.length)) {
        const value = row[rel.relationFromFields[0]];
        if (value != null && !tables[rel.type[0].toLowerCase() + rel.type.slice(1)].has(value)) throw Error(`Missing parent ${rel.type}/${value} for ${m.name}`);
      }
    };
    tx[key] = { findUnique: async ({where}) => tables[key].get(where.id),
      findMany: async args => {
        if (!txActive) throw Error('Read outside snapshot');
        if (!args?.take || args.take > 500) throw Error('Unbounded read');
        if (m.fields.some(f => f.name === 'deletedAt') && args.where?.deletedAt === undefined) throw Error('Soft deletes excluded');
        let rows = [...tables[key].values()].sort((a,b) => a.id.localeCompare(b.id));
        if (args.cursor) rows = rows.slice(rows.findIndex(r => r.id === args.cursor.id) + 1);
        return rows.slice(0, args.take).map(r => structuredClone(r));
      },
      upsert: async ({where,create,update}) => {
        const row = {...(tables[key].get(where.id) || create), ...update};
        validate(row); tables[key].set(where.id,row); return row;
      },
      update: async ({where,data}) => {
        const row = {...tables[key].get(where.id),...data}; validate(row); tables[key].set(where.id,row); return row;
      }
    };
  }
  return {tables, $transaction: async (fn, options) => {
    if (options.isolationLevel !== 'RepeatableRead' && options.isolationLevel !== 'Serializable') throw Error('No consistent isolation');
    txActive = true; try {return await fn(tx);} finally {txActive=false;}
  }};
}
const fixture = {
  school:[{id:'s',name:'School'}],
  user:[{id:'child',name:'Child',username:'child',password:'hash',schoolId:'s',classroomId:'room',parentId:'parent'}, {id:'parent',name:'Parent',username:'parent',password:'hash',schoolId:'s'}],
  classroom:[{id:'room',name:'Room',grade:'1',schoolId:'s',teacherId:'parent'}],
  course:[{id:'c',title:'Course',schoolId:'s',creatorId:'parent',deletedAt:'2025-01-01T00:00:00Z',schools:[{id:'s'}]}],
  lesson:[{id:'l',courseId:'c',title:'Lesson',slides:{text:'saved'},deletedAt:null}],
  examFolder:[{id:'f',title:'Folder',schoolId:'s'}],
  exam:[{id:'e',title:'Exam',folderId:'f',courseId:'c',schools:[{id:'s'}]}],
  examModule:[{id:'a-child',examId:'e',title:'Child',parentModuleId:'z-parent'},{id:'z-parent',examId:'e',title:'Parent'}],
  subExam:[{id:'sub',moduleId:'a-child',title:'Sub'}],
  question:[{id:'q',examId:'e',moduleId:'a-child',subExamId:'sub',text:'Question',options:'[]',correctAnswer:'1',xpPoints:21,indicator:'kept'}],
  examSubmission:[{id:'es',examId:'e',subExamId:'sub',userId:'child',totalScore:1}],
  studentAnswer:[{id:'sa',submissionId:'es',questionId:'q',userId:'child',selectedAnswer:'1',isCorrect:true}],
  deletedTombstone:[{id:'dt',entityType:'lesson',entityId:'deleted',deletedAt:'2025-01-01T00:00:00Z'}]
};
let dir;
beforeEach(async () => {dir=await fs.mkdtemp(path.join(os.tmpdir(),'backup-test-'));});
afterEach(async () => {await fs.rm(dir,{recursive:true,force:true});});
test('full snapshot streams every schema model and restores parent cycles and all scalar fields into an empty database', async () => {
  expect(typeof api.writeFullSnapshot).toBe('function');
  const file=path.join(dir,'backup-full-test.json');
  await api.writeFullSnapshot(database(fixture),file);
  const payload=JSON.parse(await fs.readFile(file,'utf8'));
  expect(payload.data.examModule).toHaveLength(2);
  expect(payload.data.deletedTombstone).toHaveLength(1);
  expect(payload.data.examFolder).toHaveLength(1);
  expect(payload.data.user[0].password).toBe('hash');
  expect(payload.data.course[0].deletedAt).toBe('2025-01-01T00:00:00Z');
  const target=database();
  await api.restoreSnapshot(target,payload);
  expect(target.tables.question.get('q')).toMatchObject({moduleId:'a-child',subExamId:'sub',xpPoints:21,indicator:'kept'});
  expect(target.tables.user.get('child')).toMatchObject({parentId:'parent',classroomId:'room'});
  expect(target.tables.examModule.get('a-child').parentModuleId).toBe('z-parent');
  expect(target.tables.studentAnswer.size).toBe(1);
  expect(target.tables.course.get('c').schools).toEqual({set:[{id:'s'}]});
});
test('read failure leaves no published snapshot or temporary file', async () => {
  expect(typeof api.writeFullSnapshot).toBe('function');
  const db=database(); db.$transaction=async fn=>fn({school:{findMany:async()=>{throw Error('read failed');}}});
  await expect(api.writeFullSnapshot(db,path.join(dir,'backup-full-fail.json'))).rejects.toThrow('read failed');
  expect(await fs.readdir(dir)).toEqual([]);
});
test('version 2 rejects missing collections and count mismatches before any database mutation', async () => {
  expect(typeof api.restoreSnapshot).toBe('function');
  const db=database();
  await expect(api.restoreSnapshot(db,{version:'2.0',data:{course:[],lesson:[]},counts:{}})).rejects.toThrow(/missing|incomplete/i);
  expect(db.tables.course.size).toBe(0);
});
test('legacy merge keeps fields absent from old backups and refuses incomplete user creation', async () => {
  expect(typeof api.restoreSnapshot).toBe('function');
  const db=database({course:[{id:'c',title:'Current',creatorId:null,description:'keep'}]});
  await api.restoreSnapshot(db,{version:'1.0',data:{course:[{id:'c',title:'Old'}],lesson:[]}});
  expect(db.tables.course.get('c').description).toBe('keep');
  await expect(api.restoreSnapshot(database(),{data:{course:[],lesson:[],user:[{id:'u',username:'u'}]}})).rejects.toThrow(/password|incomplete/i);
});
test('retention of generated full snapshots never deletes partial, uploaded, or legacy backups', async () => {
  expect(typeof api.pruneFullSnapshots).toBe('function');
  for (const name of ['backup-full-1.json','backup-full-2.json','auto_hourly_1.json','backup-old.json','backup-uploaded-1.json']) await fs.writeFile(path.join(dir,name),'{}');
  await api.pruneFullSnapshots(dir,1);
  const names=await fs.readdir(dir);
  expect(names.filter(n=>n.startsWith('backup-full-'))).toHaveLength(1);
  expect(names).toEqual(expect.arrayContaining(['auto_hourly_1.json','backup-old.json','backup-uploaded-1.json']));
});
test('private directory rejects uploads descendants, including symlink aliases', async () => {
  expect(typeof api.ensureBackupStorage).toBe('function');
  const uploads=path.join(dir,'uploads'); await fs.mkdir(uploads);
  await expect(api.ensureBackupStorage(path.join(uploads,'backups'),uploads)).rejects.toThrow(/public|uploads/i);
  await fs.symlink(uploads,path.join(dir,'alias'),'junction');
  await expect(api.ensureBackupStorage(path.join(dir,'alias','private'),uploads)).rejects.toThrow(/public|uploads/i);
});
test('legacy copy preserves originals and existing private copies', async () => {
  expect(typeof api.ensureBackupStorage).toBe('function');
  const uploads=path.join(dir,'uploads'), legacy=path.join(uploads,'backups'), dest=path.join(dir,'private');
  await fs.mkdir(legacy,{recursive:true}); await fs.writeFile(path.join(legacy,'backup-old.json'),'old');
  await api.ensureBackupStorage(dest,uploads);
  expect(await fs.readFile(path.join(dest,'backup-old.json'),'utf8')).toBe('old');
  await fs.writeFile(path.join(dest,'backup-old.json'),'new');
  await api.ensureBackupStorage(dest,uploads);
  expect(await fs.readFile(path.join(legacy,'backup-old.json'),'utf8')).toBe('old');
  expect(await fs.readFile(path.join(dest,'backup-old.json'),'utf8')).toBe('new');
});
test.each(['/backups/secret.json','/%62ackups/secret.json','/BACKUPS/secret.json','/backups%5csecret.json','//backups/secret.json','/other/../backups/secret.json'])('anonymous static backup request %s is blocked',async url=>{
  expect(typeof api.blockPublicBackups).toBe('function');
  const app=express(); app.use('/uploads',api.blockPublicBackups); app.use('/uploads',(_req,res)=>res.send('secret'));
  const result=await request(app).get('/uploads'+url);
  expect(result.status).toBe(404); expect(result.headers['cache-control']).toBe('no-store');
});

