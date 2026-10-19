import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {buildApp} from '../server/app.ts';
import {Store} from '../server/store.ts';
import {chat} from '../server/ai.ts';
import {chinaDay} from '../server/ai-access.ts';
const cookie=(r:any)=>String(r.headers['set-cookie']).split(';')[0];
async function setup(t:any){const root=mkdtempSync(join(tmpdir(),'zhixu-api-admin-'));let c=buildApp(new Store(root));await c.app.ready();t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});const send=(url:string,method:any='GET',payload?:any,session?:string)=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(session?{cookie:session}:{})}});const admin=await send('/auth/setup','POST',{username:'admin',name:'管理员',password:'test-password-2026'}),student=await send('/auth/register','POST',{username:'alice',name:'Alice',password:'test-password-2026'});return {get c(){return c;},send,admin:cookie(admin),student:cookie(student),user:student.json().user,reopen:async()=>{await c.app.close();c=buildApp(new Store(root));await c.app.ready();}};}
test('admin quota and token console is private, validates dates and persists independent overrides',async t=>{
 const x=await setup(t),g=cookie(await x.send('/auth/guest','POST'));
 for(const session of [x.student,g])assert.equal((await x.send('/ai/admin/stats','GET',undefined,session)).statusCode,403);
 assert.equal((await x.send('/ai/admin/stats?day=2026-02-30','GET',undefined,x.admin)).statusCode,400);
 assert.equal((await x.send('/ai/admin/stats?day=2026-10-16%27','GET',undefined,x.admin)).statusCode,400);
 for(const daily of [-1,1.2,10001,null])assert.equal((await x.send('/ai/admin','PATCH',{daily},x.admin)).statusCode,400);
 await x.send('/ai/admin','PATCH',{daily:12},x.admin);await x.send('/ai/admin','PATCH',{userId:x.user.id,daily:0},x.admin);
 assert.equal((await x.send('/ai/usage','GET',undefined,x.student)).json().limit,0);
 await x.reopen();let stats=(await x.send('/ai/admin/stats','GET',undefined,x.admin)).json();assert.equal(stats.daily,12);assert.equal(stats.users.find((u:any)=>u.id===x.user.id).override,0);assert.equal(stats.summary.totalTokens,null);
 await x.send('/ai/admin','PATCH',{userId:x.user.id,daily:null},x.admin);assert.equal((await x.send('/ai/usage','GET',undefined,x.student)).json().limit,12);
});
test('actual provider token usage, unknowns, failures and cached reads are recorded without private payloads',async t=>{
 const x=await setup(t);let mode='normal',calls=0;
 const ai=createServer(async(req,res)=>{for await(const p of req){}calls++;res.setHeader('content-type','application/json');if(mode==='http'){res.statusCode=503;res.end(JSON.stringify({usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5},error:'private-upstream-secret'}));return;}const usage=mode==='normal'?{prompt_tokens:11,completion_tokens:7,total_tokens:18}:mode==='alias'?{input_tokens:5,output_tokens:6}:mode==='invalid'?{prompt_tokens:-1,completion_tokens:'7',total_tokens:0.5}:undefined;res.end(JSON.stringify({choices:[{message:{content:mode==='empty'?'':'已保存的解析'}}],usage}));});await new Promise<void>(r=>ai.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>ai.close(()=>r())));
 x.c.store.saveConfig({baseUrl:`http://127.0.0.1:${(ai.address() as any).port}/v1`,model:'mock-secret-free',key:'must-not-appear'});
 const q=(await x.send('/questions','POST',{title:'加法',stem:'private-question-payload'},x.admin)).json();
 assert.equal((await x.send(`/questions/${q.id}/explanations`,'POST',{},x.student)).statusCode,200);
 assert.equal((await x.send(`/questions/${q.id}/explanations`,'POST',{},x.student)).statusCode,200);assert.equal(calls,1);
 mode='alias';await x.c.store.asUser(x.user,()=>chat(x.c.store,'system','private-answer-payload'));
 mode='unknown';await x.c.store.asUser(x.user,()=>chat(x.c.store,'system','unknown'));
 mode='invalid';await x.c.store.asUser(x.user,()=>chat(x.c.store,'system','invalid'));
 mode='http';await assert.rejects(x.c.store.asUser(x.user,()=>chat(x.c.store,'system','http')));
 mode='empty';await assert.rejects(x.c.store.asUser(x.user,()=>chat(x.c.store,'system','empty')));
 const r=await x.send('/ai/admin/stats','GET',undefined,x.admin),s=r.json();assert.equal(s.summary.calls,6);assert.equal(s.summary.success,4);assert.equal(s.summary.failed,2);assert.equal(s.summary.promptTokens,19);assert.equal(s.summary.completionTokens,15);assert.equal(s.summary.totalTokens,34);assert.equal(s.summary.unknownTokens,3);assert.equal(s.users.find((u:any)=>u.id===x.user.id).used,4);assert.equal(s.models.length,1);assert.equal(s.recent.find((r:any)=>r.errorCode==='http_503').totalTokens,5);
 assert.doesNotMatch(r.body,/private-question|private-answer|private-upstream|must-not-appear/);
 const history=(await x.send('/ai/admin/stats?day=2000-01-01','GET',undefined,x.admin)).json();assert.equal(history.summary.calls,0);
 await x.reopen();assert.equal((await x.send('/ai/admin/stats','GET',undefined,x.admin)).json().summary.totalTokens,34);
});
test('own API usage is separated from site quota, pending recovery and legacy counters remain truthful',async t=>{
 const x=await setup(t);await x.send('/ai/personal','PUT',{provider:'own',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',visionModel:'',key:'own-secret'},x.student);await x.send('/ai/admin','PATCH',{userId:x.user.id,daily:0},x.admin);
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}));try{await x.c.store.asUser(x.user,()=>chat(x.c.store,'system','text'));}finally{globalThis.fetch=original;}
 x.c.store.db.prepare('INSERT INTO ai_usage VALUES(?,?,?)').run(x.user.id,chinaDay(),9);
 x.c.store.aiAccess!.beginCall(x.user.id,'interrupted-model','beta',false);
 await x.reopen();const s=(await x.send('/ai/admin/stats?userId='+encodeURIComponent(x.user.id),'GET',undefined,x.admin)).json(),u=s.users.find((u:any)=>u.id===x.user.id);assert.equal(s.own.totalTokens,120);assert.equal(s.beta.totalTokens,null);assert.equal(u.used,9);assert.equal(u.legacyUsed,9);assert.equal(u.override,0);assert.equal(s.recent.find((r:any)=>r.model==='interrupted-model').errorCode,'interrupted');assert.equal(s.filteredCalls,2);assert.doesNotMatch(JSON.stringify(s),/own-secret/);
});
