import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID,createHash } from 'node:crypto';
import { zipSync,unzipSync,strToU8,strFromU8 } from 'fflate';
import { createCanvas } from '@napi-rs/canvas';
import { Store } from '../server/store.ts';
import { buildApp } from '../server/app.ts';
import { parseAI } from '../server/ai.ts';
import { questionInput,importOutput,type ImportJob } from '../shared/schema.ts';
import { officePath } from '../server/importer.ts';

const sample={title:'积分练习',stem:'计算 $\\int_0^1 x\\,dx$。',type:'计算',subject:'高等数学',answer:'1/2',answerOrigin:'人工',answerConfirmed:true};
async function setup(t:any){const root=mkdtempSync(join(tmpdir(),'study-test-'));const ctx=buildApp(new Store(root),{auth:false});await ctx.app.ready();t.after(async()=>{await ctx.app.close();rmSync(root,{recursive:true,force:true});});return {...ctx,root};}
async function request(ctx:any,url:string,method='GET',payload?:any){const r=await ctx.app.inject({url:'/api'+url,method,payload});assert.equal(r.statusCode,200,r.body);return r.json();}
function multipart(name:string,data:Uint8Array){const boundary='study-test-boundary';return {headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),data,Buffer.from(`\r\n--${boundary}--\r\n`)])};}
async function upload(ctx:any,name:string,bytes:Uint8Array,url='/imports'){const r=await ctx.app.inject({url:'/api'+url,method:'POST',...multipart(name,bytes)});assert.equal(r.statusCode,200,r.body);return r.json();}
async function finished(ctx:any,id:string){for(let n=0;n<1000;n++){const j=ctx.store.get('jobs',id) as ImportJob;if(!ctx.importer.active.has(id))return j;await new Promise(r=>setTimeout(r,10));}throw new Error('Import timed out');}
function pdf(pages=1){
  const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(let i=0;i<pages;i++){const stream=`BT /F1 18 Tf 30 170 Td (Integral I = 1/2. Page ${i+1}) Tj ET 30 30 100 80 re S`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
  let out='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);
}
async function provider(t:any,ctx:any,respond?:(body:any,n:number)=>{status?:number;content?:string}|Promise<{status?:number;content?:string}>){
  let calls=0;const bodies:any[]=[];
  const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);bodies.push(body);calls++;const reply=await respond?.(body,calls)||{content:JSON.stringify({questions:[{...sample,options:[],explanation:'',subquestions:[]}]})};res.writeHead(reply.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:reply.content||''}}]}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const port=(server.address() as any).port;
  await request(ctx,'/settings','PUT',{baseUrl:`http://127.0.0.1:${port}/v1`,visionBaseUrl:'',model:'test-text',visionModel:'test-vision',key:'test-secret-not-real'});
  return {bodies,get calls(){return calls;}};
}

test('folder cycles are rejected; delete and restore preserves nesting and questions',async t=>{
  const c=await setup(t);const a=await request(c,'/folders','POST',{name:'高数'});const b=await request(c,'/folders','POST',{name:'积分',parentId:a.id});const q=await request(c,'/questions','POST',{...sample,folderId:b.id});
  const cycle=await c.app.inject({url:'/api/folders/'+a.id,method:'PATCH',payload:{parentId:b.id}});assert.equal(cycle.statusCode,400);
  await request(c,'/folders/'+a.id,'PATCH',{deleted:true});let d=await request(c,'/bootstrap');assert.equal(d.questions[0].deleted,true);assert.equal(d.folders.every((f:any)=>f.deleted),true);
  await request(c,'/folders/'+a.id,'PATCH',{deleted:false});d=await request(c,'/bootstrap');assert.equal(d.questions[0].deleted,false);assert.equal(d.questions[0].folderId,b.id);
  await request(c,'/folders/'+b.id,'PATCH',{name:'定积分',parentId:null});assert.equal((await request(c,'/questions/'+q.id)).question.stem,sample.stem);
});
test('drafts survive app restart and attachments retain bytes',async t=>{
  const root=mkdtempSync(join(tmpdir(),'study-restart-'));let c=buildApp(new Store(root),{auth:false});await c.app.ready();
  const q=await request(c,'/questions','POST',sample);const image=createCanvas(40,40).toBuffer('image/png');const a=await upload(c,'answer.png',image,'/attachments');await request(c,`/questions/${q.id}/draft`,'PUT',{answer:'$1/2$',images:[a.id]});await c.app.close();
  c=buildApp(new Store(root),{auth:false});await c.app.ready();t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});const detail=await request(c,'/questions/'+q.id);assert.deepEqual(detail.draft.images,[a.id]);assert.equal(detail.draft.answer,'$1/2$');assert.deepEqual(c.store.bytes(a.id),image);
});
test('objective judgement, wrong book and reward are idempotent; correction revokes invalid reward',async t=>{
  const c=await setup(t);const q=await request(c,'/questions','POST',{...sample,type:'多选',options:['A. 1','B. 2','C. 3'],answer:'AC'});
  const wrong=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'A'});assert.equal(wrong.correct,false);assert.equal((await request(c,'/bootstrap')).stats.wrong,1);
  const correct=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'C，A'});assert.equal(correct.correct,true);
  const rewards=await Promise.all(Array.from({length:8},()=>request(c,`/questions/${q.id}/reward`,'POST')));assert.equal(rewards.filter(r=>!r.alreadyClaimed).length,1);assert.equal((await request(c,'/bootstrap')).stats.points,10);
  await request(c,'/attempts/'+correct.id,'PATCH',{correct:false});assert.equal((await request(c,'/bootstrap')).stats.points,0);
  const unconfirmed=await request(c,'/questions','POST',{...sample,type:'判断',answer:'正确',answerConfirmed:false});assert.equal((await request(c,`/questions/${unconfirmed.id}/attempts`,'POST',{answer:'正确'})).correct,null);
});
test('AI assessment is advisory and explanations preserve source answers',async t=>{
  const c=await setup(t);await provider(t,c,(b)=>({content:b.messages[0].content.includes('输出 JSON')?JSON.stringify({correct:true,feedback:'推导完整。'}):'## 解题步骤\n令 $u=x^2$。'}));
  const q=await request(c,'/questions','POST',sample),a=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'一半'});assert.equal(a.correct,null);
  const g=await request(c,'/attempts/'+a.id+'/grade','POST');assert.equal(g.suggestedCorrect,true);assert.equal((await request(c,'/bootstrap')).stats.eligible.length,0);
  await request(c,`/attempts/${a.id}`,'PATCH',{correct:true});await request(c,`/questions/${q.id}/reward`,'POST');await request(c,`/questions/${q.id}/explanations`,'POST');const d=await request(c,`/questions/${q.id}`);assert.equal(d.question.answer,'1/2');assert.equal(d.explanations.length,1);
});
test('backup restores records and source images, excludes keys, rejects corrupted archive atomically',async t=>{
  const c=await setup(t);await provider(t,c);const folder=await request(c,'/folders','POST',{name:'试卷'});const img=createCanvas(10,10).toBuffer('image/png');const a=await upload(c,'figure.png',img,'/attachments');const q=await request(c,'/questions','POST',{...sample,folderId:folder.id,sources:[{attachmentId:a.id,imageId:a.id,name:'figure.png'}]});await request(c,'/folders/'+folder.id,'PATCH',{deleted:true});
  const r=await c.app.inject({url:'/api/backup'});assert.equal(r.statusCode,200);const files=unzipSync(r.rawPayload);assert.ok(!strFromU8(files['manifest.json']).includes('test-secret-not-real'));
  await request(c,'/questions','POST',{...sample,title:'备份之后创建'});await upload(c,'backup.zip',r.rawPayload,'/restore');const restored=await request(c,'/bootstrap');assert.equal(restored.questions.length,1);assert.notEqual(restored.questions[0].sources[0].imageId,a.id);assert.deepEqual(c.store.bytes(restored.questions[0].sources[0].imageId),img);assert.equal(c.store.privateConfig().key,'test-secret-not-real');
  await request(c,'/folders/'+folder.id,'PATCH',{deleted:false});assert.equal((await request(c,'/questions/'+q.id)).question.deleted,false);assert.equal(readdirSync(join(c.root,'backups')).length,1);
  files['attachments/'+a.id]=new Uint8Array([1,2,3]);const bad=await c.app.inject({url:'/api/restore',method:'POST',...multipart('bad.zip',zipSync(files))});assert.equal(bad.statusCode,400);assert.equal((await request(c,'/bootstrap')).questions.length,1);
});
test('TXT import, validation, draft edits and double commit preserve ids',async t=>{
  const c=await setup(t);await provider(t,c);const j=await upload(c,'exam.txt',Buffer.from('1. 计算积分'));let done=await finished(c,j.id);assert.equal(done.status,'review');assert.equal(done.drafts.length,1);assert.equal(done.drafts[0].answerOrigin,'原文');assert.equal(done.drafts[0].answerConfirmed,false);
  done.drafts[0].title='人工校对标题';done.drafts[0].answerConfirmed=true;await request(c,`/imports/${j.id}/drafts`,'PUT',done.drafts);const a=await request(c,`/imports/${j.id}/commit`,'POST'),b=await request(c,`/imports/${j.id}/commit`,'POST');assert.deepEqual(a.ids,b.ids);assert.equal((await request(c,'/bootstrap')).questions.length,1);
  const repeat=await upload(c,'exam.txt',Buffer.from('1. 计算积分'));await finished(c,repeat.id);assert.deepEqual(repeat.duplicates,['exam.txt']);
  assert.throws(()=>parseAI('{"questions":[{"stem":"incomplete"}]}',importOutput));
});
test('real multi-page PDF renders source images and retries only failed pages',async t=>{
  const c=await setup(t);const mock=await provider(t,c,(_b,n)=>n===2?{status:429}:{content:JSON.stringify({questions:[{...sample,title:'第 '+n+' 页'}]})});const j=await upload(c,'math.pdf',pdf(2));let done=await finished(c,j.id);assert.equal(done.tasks.length,2);assert.equal(done.status,'error');assert.equal(done.drafts.length,1);assert.ok(done.tasks[0].imageId);assert.equal(mock.calls,2);
  await request(c,`/imports/${j.id}/retry`,'POST');done=await finished(c,j.id);assert.equal(done.status,'review');assert.equal(mock.calls,3);assert.equal(done.drafts.length,2);assert.ok(done.tasks[0].text?.includes('Integral'));assert.equal(mock.bodies[0].model,'test-vision');assert.equal(mock.bodies[0].messages[1].content[1].type,'image_url');
});
test('photo import uses vision; malformed model output stays recoverable',async t=>{
  const c=await setup(t);await provider(t,c,(_b,n)=>({content:n===1?'not JSON':JSON.stringify({questions:[{...sample,knowledgePoints:['definite-integral']}]})}));const j=await upload(c,'photo.png',createCanvas(80,80).toBuffer('image/png'));let done=await finished(c,j.id);assert.equal(done.status,'error');assert.match(done.tasks[0].error||'',/结构/);await request(c,`/imports/${j.id}/retry`,'POST');done=await finished(c,j.id);assert.equal(done.status,'review');assert.equal(done.drafts.length,1);
  assert.equal(done.drafts[0].knowledgeSource,'AI');assert.deepEqual(done.drafts[0].knowledgePoints,['definite-integral']);await request(c,`/imports/${j.id}/commit`,'POST');assert.deepEqual((await request(c,'/questions/'+done.drafts[0].id)).question.knowledgePoints,['definite-integral']);
});
test('missing key, corrupt PDF, unsupported file and missing Word dependency are explicit',async t=>{
  const c=await setup(t);const text=await upload(c,'paper.txt',Buffer.from('题目'));assert.match((await finished(c,text.id)).tasks[0].error||'',/设置/);
  const broken=await upload(c,'broken.pdf',Buffer.from('bad pdf'));assert.equal((await finished(c,broken.id)).status,'error');
  const unsupported=await c.app.inject({url:'/api/imports',method:'POST',...multipart('test.exe',Buffer.from('bad'))});assert.equal(unsupported.statusCode,400);
  if(!officePath()){const word=await upload(c,'math.docx',Buffer.from('fake'));assert.match((await finished(c,word.id)).errors[0],/LibreOffice/);}
});
test('cancellation aborts pending model call and retry remains possible',async t=>{
  const c=await setup(t);let started=false;
  const server=createServer(async(req,res)=>{for await(const _ of req){}started=true;setTimeout(()=>{if(!res.destroyed)res.end(JSON.stringify({choices:[{message:{content:'{"questions":[]}'}}]}));},200);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
  await request(c,'/settings','PUT',{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,visionBaseUrl:'',model:'mock',visionModel:'mock',key:'fake'});const j=await upload(c,'slow.txt',Buffer.from('slow'));
  for(let n=0;n<100&&!started;n++)await new Promise(r=>setTimeout(r,10));assert.ok(started);await request(c,`/imports/${j.id}/cancel`,'POST');const done=await finished(c,j.id);assert.equal(done.status,'cancelled');assert.equal(done.drafts.length,0);
});
test('cross-origin writes and DNS rebinding are blocked; settings never echo keys',async t=>{
  const c=await setup(t);await provider(t,c);const result=await c.app.inject({url:'/api/settings'});assert.ok(!result.body.includes('test-secret-not-real'));assert.equal(result.json().hasKey,true);
  const foreign=await c.app.inject({url:'/api/questions',method:'POST',headers:{origin:'https://evil.example'},payload:sample});assert.equal(foreign.statusCode,403);
  const rebound=await c.app.inject({url:'/api/bootstrap',headers:{host:'evil.example'}});assert.equal(rebound.statusCode,403);
});

test('import respects each draft folder including root; invalid targets roll back the whole batch',async t=>{
  const c=await setup(t);await provider(t,c);
  const source=await request(c,'/folders','POST',{name:'导入默认'}),target=await request(c,'/folders','POST',{name:'校对目标'});
  const j=await upload(c,'folders.txt',Buffer.from('题目'),'/imports?folderId='+source.id);
  const done=await finished(c,j.id),first=done.drafts[0];
  const drafts=[{...first,folderId:target.id},{...first,id:randomUUID(),folderId:null},{...first,id:randomUUID(),folderId:source.id}];
  await request(c,`/imports/${j.id}/drafts`,'PUT',drafts);
  await request(c,`/folders/${source.id}`,'PATCH',{deleted:true});
  const failed=await c.app.inject({url:`/api/imports/${j.id}/commit`,method:'POST'});
  assert.equal(failed.statusCode,400);assert.equal(c.store.all('questions').length,0);assert.equal(c.store.get<ImportJob>('jobs',j.id)?.status,'review');
  drafts[2].folderId='missing-folder';await request(c,`/imports/${j.id}/drafts`,'PUT',drafts);
  assert.equal((await c.app.inject({url:`/api/imports/${j.id}/commit`,method:'POST'})).statusCode,404);
  assert.equal(c.store.all('questions').length,0);
  await request(c,`/imports/${j.id}/drafts`,'PUT',drafts.slice(0,2));
  const result=await request(c,`/imports/${j.id}/commit`,'POST');
  assert.equal((await request(c,'/questions/'+result.ids[0])).question.folderId,target.id);
  assert.equal((await request(c,'/questions/'+result.ids[1])).question.folderId,null);
});

test('AI review and adoption survive restart and backup; stale review cannot be adopted',async t=>{
  const c=await setup(t);await provider(t,c,()=>({content:JSON.stringify({correct:true,feedback:'推导完整，可确认。'})}));
  const q=await request(c,'/questions','POST',sample),a=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'1/2'});
  const first=await request(c,`/attempts/${a.id}/grade`,'POST');
  let detail=await request(c,'/questions/'+q.id);
  assert.equal(detail.attempts[0].correct,null);assert.equal(detail.attempts[0].aiReview.id,first.id);
  assert.equal(detail.attempts[0].aiReview.decision,'pending');
  const second=await request(c,`/attempts/${a.id}/grade`,'POST',{force:true});
  assert.equal((await c.app.inject({url:'/api/attempts/'+a.id,method:'PATCH',payload:{correct:true,reviewId:first.id}})).statusCode,409);
  await request(c,`/attempts/${a.id}`,'PATCH',{correct:true,reviewId:second.id});
  detail=await request(c,'/questions/'+q.id);assert.equal(detail.attempts[0].aiReview.decision,'adopted');assert.doesNotMatch(detail.attempts[0].feedback,/待确认/);
  // A fresh application and connection to the same file verifies persistence beyond React state.
  const reopened=buildApp(new Store(c.root),{auth:false});await reopened.app.ready();
  try{assert.deepEqual((await request(reopened,'/questions/'+q.id)).attempts,detail.attempts);}finally{await reopened.app.close();}
  const backup=await c.app.inject({url:'/api/backup'});assert.equal(backup.statusCode,200);
  await request(c,`/attempts/${a.id}`,'PATCH',{correct:false});
  assert.equal((await request(c,'/questions/'+q.id)).attempts[0].aiReview.decision,'overridden');
  await upload(c,'review.zip',backup.rawPayload,'/restore');
  assert.deepEqual((await request(c,'/questions/'+q.id)).attempts,detail.attempts);
});

test('draft revisions reject conflicts and prevent delayed departure saves overwriting newer answers',async t=>{
  const c=await setup(t),q=await request(c,'/questions','POST',sample),url=`/questions/${q.id}/draft`;
  await request(c,url,'POST',{answer:'最新内容',revision:3});
  await request(c,url,'PUT',{answer:'较早内容',revision:2});
  const d=(await request(c,'/questions/'+q.id)).draft;assert.equal(d.answer,'最新内容');assert.equal(d.revision,3);
  assert.deepEqual(await request(c,url,'POST',{answer:'最新内容',revision:3}),d);
  assert.equal((await c.app.inject({url:'/api'+url,method:'PUT',payload:{answer:'另一个页面',revision:3}})).statusCode,409);
  await request(c,url,'PUT',{answer:'后续修改',revision:4});
  assert.equal((await request(c,'/questions/'+q.id)).draft.answer,'后续修改');
});

test('badges count distinct correct questions before rewards and follow manual corrections',async t=>{
  const c=await setup(t),q=await request(c,'/questions','POST',{...sample,type:'单选',answer:'A'});
  const a=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'A'}),b=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'A'});
  let stats=(await request(c,'/bootstrap')).stats;assert.equal(stats.correctQuestions,1);assert.equal(stats.points,0);assert.equal(stats.correct,2);
  await request(c,`/questions/${q.id}/reward`,'POST');
  await request(c,`/attempts/${a.id}`,'PATCH',{correct:false});
  stats=(await request(c,'/bootstrap')).stats;assert.equal(stats.correctQuestions,1);assert.equal(stats.points,10);
  await request(c,`/attempts/${b.id}`,'PATCH',{correct:false});
  stats=(await request(c,'/bootstrap')).stats;assert.equal(stats.correctQuestions,0);assert.equal(stats.points,0);
});

for(const operation of ['grade','explanations'])test(`restore and backup wait for pending AI ${operation}; failures release the gate`,async t=>{
  const c=await setup(t);let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(r=>release=r),began=new Promise<void>(r=>started=r);
  await provider(t,c,async()=>{started();await gate;return {content:operation==='grade'?JSON.stringify({correct:true,feedback:'建议正确'}):'解析'};});
  t.after(()=>release());
  const q=await request(c,'/questions','POST',sample),a=await request(c,`/questions/${q.id}/attempts`,'POST',{answer:'一半'});
  const backup=await c.app.inject({url:'/api/backup'});
  const pending=request(c,operation==='grade'?`/attempts/${a.id}/grade`:`/questions/${q.id}/explanations`,'POST');
  await began;
  const restore=await c.app.inject({url:'/api/restore',method:'POST',...multipart('backup.zip',backup.rawPayload)});assert.equal(restore.statusCode,409);
  assert.equal((await c.app.inject({url:'/api/backup'})).statusCode,409);
  await request(c,`/attempts/${a.id}`,'PATCH',{correct:false});release();await pending;
  assert.equal((await request(c,'/questions/'+q.id)).attempts[0].correct,false);
  await upload(c,'backup.zip',backup.rawPayload,'/restore');
  assert.equal((await request(c,'/questions/'+q.id)).explanations.length,0);
  assert.equal((await c.app.inject({url:'/api/restore',method:'POST',...multipart('bad.zip',Buffer.from('broken'))})).statusCode,400);
  await request(c,'/questions','POST',{...sample,title:'恢复失败后仍可写入'});
});

test('restore accepts archives over the former 100 MB upload limit',async t=>{
  const c=await setup(t),bytes=Buffer.alloc(100*1024*1024+1,7),aid=randomUUID();
  const value={id:aid,name:'large.png',mime:'image/png',hash:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  const archive=zipSync({'manifest.json':strToU8(JSON.stringify({version:1,records:[{kind:'attachments',id:aid,value}]})),['attachments/'+aid]:bytes},{level:0});
  await upload(c,'large.zip',archive,'/restore');
  const restored=c.store.all<{id:string}>('attachments')[0];assert.equal(c.store.bytes(restored.id).length,bytes.length);
});
