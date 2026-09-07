require('ts-node/register/transpile-only');
const path=require('path');
const source=path.resolve(__dirname,'../../../src/lib/cloudBackupArchive.ts');
const api=require('fs').existsSync(source)?require(source):{};
function storage({failRead=false,missing=false,wrongDelete=false,locked=false}={}){
 const state={records:[{id:'1',name:'first',data:{value:1}},{id:'2',name:'second',data:{value:2}}],archives:[],released:false};
 let draft;
 const client={release:()=>{state.released=true;},query:async(sql,params)=>{
  if(sql==='BEGIN'){draft=structuredClone(state);return {};}
  if(sql==='ROLLBACK'){draft=null;return {};}
  if(sql==='COMMIT'){Object.assign(state,draft);return {};}
  if(sql.includes('pg_try_advisory_xact_lock'))return{rows:[{locked:!locked}]};
  if(sql.startsWith('SELECT id'))return{rows:draft.records.map(({id,name})=>({id,name,created_at:'2025-01-01'}))};
  if(sql.startsWith('SELECT data')){if(params[0]==='2'&&failRead)throw Error('read failed'); return {rows:params[0]==='2'&&missing?[]:[{data:draft.records.find(r=>r.id===params[0]).data}]};}
  if(sql.startsWith('INSERT')){draft.archives.push(JSON.parse(params[2]));return{rowCount:1};}
  if(sql.startsWith('DELETE')){draft.records=[];return{rowCount:wrongDelete?1:2};}
  throw Error('Unexpected query '+sql);
 }};
 return {state,connect:async()=>client};
}
test.each([{failRead:true},{missing:true}])('archival failure %j preserves every original and publishes no archive',async failure=>{
 expect(typeof api.archiveCloudBatch).toBe('function');
 const pool=storage(failure);
 await expect(api.archiveCloudBatch(pool,async entries=>Buffer.from(JSON.stringify(entries)),{minimum:2,removeOriginals:true})).rejects.toThrow();
 expect(pool.state.records).toHaveLength(2); expect(pool.state.archives).toHaveLength(0); expect(pool.state.released).toBe(true);
});
test('successful archive includes all source records while retaining every original',async()=>{
 expect(typeof api.archiveCloudBatch).toBe('function');
 const pool=storage();
 await api.archiveCloudBatch(pool,async entries=>Buffer.from(JSON.stringify(entries)),{minimum:2,removeOriginals:true});
 expect(pool.state.records).toHaveLength(2);expect(pool.state.archives).toHaveLength(1);
 expect(pool.state.archives[0].count).toBe(2);
 expect(JSON.parse(Buffer.from(pool.state.archives[0].fileBase64,'base64').toString()).map(e=>e.data.value)).toEqual([1,2]);
});
test('distributed lock contention skips archive and deletion',async()=>{
 expect(typeof api.archiveCloudBatch).toBe('function');
 const pool=storage({locked:true});
 expect(await api.archiveCloudBatch(pool,async()=>{throw Error('should not run');},{minimum:2,removeOriginals:true})).toBeNull();
 expect(pool.state.records).toHaveLength(2);expect(pool.state.archives).toHaveLength(0);
});
test('compression failure rolls back without deleting originals',async()=>{
 expect(typeof api.archiveCloudBatch).toBe('function');
 const pool=storage();
 await expect(api.archiveCloudBatch(pool,async()=>{throw Error('zip failure');},{minimum:2,removeOriginals:true})).rejects.toThrow('zip failure');
 expect(pool.state.records).toHaveLength(2);expect(pool.state.archives).toHaveLength(0);
});

