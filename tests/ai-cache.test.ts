import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createCanvas} from '@napi-rs/canvas';
import {Store} from '../server/store.ts';
import {buildApp} from '../server/app.ts';
import {makeBackup,restoreBackup} from '../server/backup.ts';
async function setup(t:any,snapshots=false){
 const root=mkdtempSync(join(tmpdir(),'zhixu-cache-'));let c=buildApp(new Store(root),{snapshots});await c.app.ready();
 t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});
 const send=(url:string,method:any='GET',payload?:any,cookie?:string,extra:any={})=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{}),...extra}});
 const login=async(name:string,setup=false)=>{const r=await send('/auth/'+(setup?'setup':'register'),'POST',{username:name,name,password:'Cache-test-2026'});assert.equal(r.statusCode,200,r.body);return {cookie:String(r.headers['set-cookie']).split(';')[0],user:r.json().user};};
 const admin=await login('admin',true),alice=await login('alice'),bob=await login('bob');let calls=0;
 const server=createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;calls++;const sys=JSON.parse(text).messages[0].content;const content=sys.includes('只返回 JSON')?JSON.stringify({answer:'2',explanation:'共享解析'+calls}):sys.includes('输出 JSON')?JSON.stringify({correct:true,feedback:'逐步批改'+calls}):'私人解析'+calls;await new Promise(r=>setTimeout(r,20));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 c.store.saveConfig({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'mock',visionModel:'vision',key:'excluded-api-secret'});
 const question=async(data:any={})=>{const r=await send('/questions','POST',{title:'缓存题',stem:'1+1',...data},admin.cookie);assert.equal(r.statusCode,200,r.body);return r.json();};
 return {get c(){return c;},get calls(){return calls;},root,send,admin,alice,bob,question,reopen:async()=>{await c.app.close();c=buildApp(new Store(root),{snapshots});await c.app.ready();}};
}
test('personal explanations coalesce, persist, invalidate on edits and never leak across accounts',async t=>{
 const x=await setup(t),q=await x.question(),url='/questions/'+q.id+'/explanations';
 const results=await Promise.all([1,2,3].map(()=>x.send(url,'POST',{},x.alice.cookie)));for(const r of results)assert.equal(r.statusCode,200,r.body);
 assert.equal(x.calls,1);assert.equal(new Set(results.map(r=>r.json().id)).size,1);assert.equal((await x.send('/ai/usage','GET',undefined,x.alice.cookie)).json().used,1);
 assert.equal((await x.send('/questions/'+q.id,'GET',undefined,x.bob.cookie)).json().explanations.length,0);
 assert.equal((await x.send('/questions/'+q.id,'GET',undefined,x.admin.cookie)).json().question.explanation,'');
 await x.reopen();assert.equal((await x.send(url,'POST',{},x.alice.cookie)).json().id,results[0].json().id);assert.equal(x.calls,1);
 await x.send('/questions/'+q.id,'PATCH',{stem:'2+2'},x.admin.cookie);await x.send(url,'POST',{},x.alice.cookie);assert.equal(x.calls,2);
 await x.send(url,'POST',{force:true},x.alice.cookie);assert.equal(x.calls,3);
 const zip=makeBackup(x.c.store);restoreBackup(x.c.store,zip);await x.send(url,'POST',{},x.alice.cookie);assert.equal(x.calls,3);
});
test('admin shared solution is persisted once and serves all students without consuming their quota',async t=>{
 const x=await setup(t),q=await x.question({answer:'保留原答案',answerOrigin:'原文'}),url='/questions/'+q.id+'/explanations';
 const r=await x.send(url,'POST',{},x.admin.cookie);assert.equal(r.statusCode,200,r.body);assert.equal(x.calls,1);
 for(const student of [x.alice,x.bob]){const a=await x.send(url,'POST',{},student.cookie);assert.equal(a.statusCode,200);assert.match(a.json().content,/共享解析/);assert.equal((await x.send('/ai/usage','GET',undefined,student.cookie)).json().used,0);}
 assert.equal(x.calls,1);await x.reopen();const detail=(await x.send('/questions/'+q.id,'GET',undefined,x.bob.cookie)).json();assert.equal(detail.question.answer,'保留原答案');assert.match(detail.question.explanation,/共享解析/);await x.send(url,'POST',{},x.admin.cookie);assert.equal(x.calls,1);
});
test('legacy migration publishes admin solutions only and leaves student explanations private',async t=>{
 const x=await setup(t),a=await x.question(),b=await x.question();const old=(questionId:string,content:string)=>({id:randomUUID(),questionId,content,model:'old',createdAt:new Date().toISOString()});
 x.c.store.asUser(x.admin.user,()=>x.c.store.put('explanations',old(a.id,'原管理员解析')));x.c.store.asUser(x.alice.user,()=>x.c.store.put('explanations',old(b.id,'不可公开的私人解析')));
 await x.reopen();assert.equal((await x.send('/questions/'+a.id,'GET',undefined,x.bob.cookie)).json().question.explanation,'原管理员解析');const privateDetail=(await x.send('/questions/'+b.id,'GET',undefined,x.bob.cookie)).json();assert.equal(privateDetail.question.explanation,'');assert.deepEqual(privateDetail.explanations,[]);
 await x.send('/questions/'+b.id+'/explanations','POST',{},x.alice.cookie);assert.equal(x.calls,0);const before=x.c.store.db.prepare('SELECT COUNT(*) n FROM v_ai_result_catalog').get()!.n;await x.reopen();assert.equal(x.c.store.db.prepare('SELECT COUNT(*) n FROM v_ai_result_catalog').get()!.n,before);
});
test('device AI archives input photos and reviews, reuses server grading, and preserves adoption after restart and ZIP restore',async t=>{
 const x=await setup(t),q=await x.question(),bytes=createCanvas(20,20).toBuffer('image/png'),url='data:image/png;base64,'+bytes.toString('base64');
 const body={questionId:q.id,mode:'grade',answer:'2',images:[url]},first=await x.send('/personal/ai','POST',body,x.alice.cookie);assert.equal(first.statusCode,200,first.body);assert.equal(x.calls,1);
 const second=await x.send('/personal/ai','POST',body,x.alice.cookie);assert.equal(second.json().id,first.json().id);assert.equal(x.calls,1);
 const records=x.c.store.asUser(x.alice.user,()=>x.c.store.all<any>('aiResults')),arch=records.find(a=>a.mode==='grade');assert.equal(arch.answer,'2');assert.equal(arch.images.length,1);assert.deepEqual(x.c.store.bytes(arch.images[0]),bytes);
 assert.equal((await x.send('/attachments/'+arch.images[0],'GET',undefined,x.bob.cookie)).statusCode,404);
 const attempt=(await x.send('/questions/'+q.id+'/attempts','POST',{answer:'2',images:arch.images},x.alice.cookie)).json(),gradeUrl='/attempts/'+attempt.id+'/grade';
 assert.equal((await x.send(gradeUrl,'POST',{},x.alice.cookie)).json().id,first.json().id);assert.equal(x.calls,1);
 await x.send('/attempts/'+attempt.id,'PATCH',{correct:true,reviewId:first.json().id},x.alice.cookie);assert.equal((await x.send(gradeUrl,'POST',{},x.alice.cookie)).json().decision,'adopted');assert.equal(x.calls,1);
 restoreBackup(x.c.store,makeBackup(x.c.store));await x.reopen();assert.equal((await x.send('/personal/ai','POST',body,x.alice.cookie)).json().id,first.json().id);assert.equal((await x.send(gradeUrl,'POST',{},x.alice.cookie)).json().decision,'adopted');assert.equal(x.calls,1);
 const restored=x.c.store.asUser(x.alice.user,()=>x.c.store.all<any>('aiResults')).find(a=>a.mode==='grade');assert.deepEqual(x.c.store.bytes(restored.images[0]),bytes);
});
test('gzip preserves bootstrap contents and private attachment validation precedes conditional caching',async t=>{
 const x=await setup(t),q=await x.question({stem:'传输压缩测试'.repeat(2000)}),a=x.c.store.asUser(x.alice.user,()=>x.c.store.attach(Buffer.from('private-content'),'private.png','image/png'));
 const plain=await x.send('/bootstrap','GET',undefined,x.alice.cookie),compressed=await x.send('/bootstrap','GET',undefined,x.alice.cookie,{'accept-encoding':'gzip'});
 assert.equal(compressed.headers['content-encoding'],'gzip');assert.equal(gunzipSync(compressed.rawPayload).toString(),plain.body);assert.ok(compressed.rawPayload.length<plain.rawPayload.length/4);
 assert.equal((await x.send('/bootstrap','GET',undefined,x.alice.cookie,{'accept-encoding':'gzip;q=0, *;q=1'})).headers['content-encoding'],undefined);
 const file=await x.send('/attachments/'+a.id,'GET',undefined,x.alice.cookie);assert.equal(file.headers['cache-control'],'private, no-cache');assert.equal((await x.send('/attachments/'+a.id,'GET',undefined,x.alice.cookie,{'if-none-match':file.headers.etag})).statusCode,304);assert.equal((await x.send('/attachments/'+a.id,'GET',undefined,x.bob.cookie,{'if-none-match':file.headers.etag})).statusCode,404);
});
test('automatic SQLite snapshots preserve account database, AI archives and verified blobs; retention keeps seven complete sets',async t=>{
 const x=await setup(t,true),q=await x.question();await x.send('/personal/ai','POST',{questionId:q.id,mode:'explain'},x.alice.cookie);const blob=x.c.store.asUser(x.alice.user,()=>x.c.store.attach(Buffer.from('snapshot-content'),'original.txt','text/plain'));
 assert.equal((await x.send('/data-overview','GET',undefined,x.alice.cookie)).statusCode,403);
 for(let i=0;i<8;i++)await x.c.snapshots!.flush();const dir=x.c.snapshots!.directory,latest=JSON.parse(readFileSync(join(dir,'latest.json'),'utf8')),db=new DatabaseSync(join(dir,'snapshots',latest.database),{readOnly:true});
 try{assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(db.prepare('SELECT COUNT(*) n FROM v_ai_result_catalog').get()!.n,1);}finally{db.close();}
 const accounts=new DatabaseSync(join(dir,'snapshots',latest.accounts),{readOnly:true});try{assert.equal(accounts.prepare('SELECT COUNT(*) n FROM users').get()!.n,3);}finally{accounts.close();}
 const ref=latest.files.find((f:any)=>f.id===blob.id),saved=readFileSync(join(dir,'objects',ref.sha256));assert.equal(createHash('sha256').update(saved).digest('hex'),blob.hash);assert.equal(saved.toString(),'snapshot-content');assert.equal(readdirSync(join(dir,'snapshots')).filter(n=>n.endsWith('.json')).length,7);assert.equal(readdirSync(dir).includes('secrets.json'),false);
 const overview=(await x.send('/data-overview','GET',undefined,x.admin.cookie)).json();assert.equal(overview.aiResults,1);assert.ok(overview.backup.lastBackup);
 const restored=join(x.root,'restored');execFileSync(process.execPath,['scripts/restore-snapshot.mjs','--backup-dir',dir,'--output-dir',restored]);const recovered=new Store(restored);try{assert.equal(recovered.all<any>('questions')[0].id,q.id);assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM v_ai_result_catalog').get()!.n,1);assert.equal(recovered.bytes(blob.id).toString(),'snapshot-content');}finally{recovered.close();}
 assert.throws(()=>execFileSync(process.execPath,['scripts/restore-snapshot.mjs','--backup-dir',dir,'--output-dir',restored],{stdio:'pipe'}),/已经存在/);
});
