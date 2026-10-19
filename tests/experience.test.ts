import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createCanvas} from '@napi-rs/canvas';
import {Store} from '../server/store.ts';
import {buildApp} from '../server/app.ts';
import {chinaDay} from '../server/ai-access.ts';
import {makeBackup,restoreBackup} from '../server/backup.ts';
import {readWallet} from '../server/shop.ts';
import {insertAtSelection,formulaText} from '../src/math-input.ts';

async function fixture(t:any){
 const root=mkdtempSync(join(tmpdir(),'zhixu-ux-'));let app=buildApp(new Store(root));await app.app.ready();let calls=0;
 const mock=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;calls++;const body=JSON.parse(raw),user=body.messages[1].content,data=JSON.parse(Array.isArray(user)?user[0].text:user),solution={answer:'2',explanation:'步骤：$1+1=2$，检查单位。'},output=body.messages[0].content.includes('"solutions"')?{solutions:data.questions.map((q:any)=>({id:q.id,...solution}))}:solution;await new Promise(r=>setTimeout(r,15));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:20,completion_tokens:15,total_tokens:35}}));});
 await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.app.close();await new Promise<void>(r=>mock.close(()=>r()));rmSync(root,{recursive:true,force:true});});
 const send=(url:string,method:any='GET',payload?:any,cookie?:string)=>app.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{})}});
 const login=async(name:string,setup=false)=>{const r=await send('/auth/'+(setup?'setup':'register'),'POST',{username:name,name,password:'Experience-test-2026'});assert.equal(r.statusCode,200,r.body);return {user:r.json().user,cookie:String(r.headers['set-cookie']).split(';')[0]};};
 const admin=await login('ux_admin',true),student=await login('ux_student');
 app.store.saveConfig({baseUrl:`http://127.0.0.1:${(mock.address() as any).port}/v1`,model:'mock',visionModel:'mock',key:'qa-only'});
 const q=async(data:any={})=>{const r=await send('/questions','POST',{title:'入库体验题',stem:'1+1',...data},admin.cookie);assert.equal(r.statusCode,200,r.body);return r.json();};
 const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('后台队列未在测试期限内到达预期状态');};
 return {get c(){return app;},get calls(){return calls;},admin,student,send,q,wait,reopen:async()=>{await app.app.close();app=buildApp(new Store(root));await app.app.ready();}};
}

test('math input replaces the selection, preserves adjacent text and creates readable templates',()=>{
 assert.deepEqual(insertAtSelection('先写 x 再解释',3,4,'π'),{value:'先写 π 再解释',cursor:4});
 assert.deepEqual(insertAtSelection('证明：',3,3,formulaText('fraction',['x+1','2'])),{value:'证明：$\\frac{x+1}{2}$',cursor:18});
 assert.equal(formulaText('integral',['x^2','x','0','1']),'$\\int_{0}^{1} x^2 \\, dx$');
 assert.equal(formulaText('limit',['x','0','x^2']),'$\\lim_{x \\to 0} x^2$');
});

test('question GET retrieves archived device explanation with no AI calls and no cross-account leak',async t=>{
 const x=await fixture(t),q=await x.q();
 const saved=await x.send('/personal/ai','POST',{questionId:q.id,mode:'explain'},x.student.cookie);assert.equal(saved.statusCode,200,saved.body);assert.equal(x.calls,1);
 x.c.store.asUser(x.student.user,()=>{for(const e of x.c.store.all<any>('explanations'))x.c.store.remove('explanations',e.id);});
 await x.reopen();for(let i=0;i<3;i++){const d=await x.send('/questions/'+q.id,'GET',undefined,x.student.cookie);assert.equal(d.json().explanations[0].id,saved.json().id);}
 assert.equal(x.calls,1);assert.deepEqual((await x.send('/questions/'+q.id,'GET',undefined,x.admin.cookie)).json().explanations,[]);
});

test('free beta skin is permanent, costs no coins, survives sync and backup restore, and stays account scoped',async t=>{
 const x=await fixture(t),before=(await x.send('/shop','GET',undefined,x.student.cookie)).json().wallet,backup=makeBackup(x.c.store);
 for(let i=0;i<2;i++){const r=await x.send('/shop/skins/glass','POST',{},x.student.cookie);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().wallet.coins,before.coins);assert.equal(r.json().wallet.owned.filter((s:string)=>s==='glass').length,1);}
 await x.send('/personal/sync','POST',{records:{wallet:[before]}},x.student.cookie);
 restoreBackup(x.c.store,backup);await x.reopen();assert.ok((await x.send('/shop','GET',undefined,x.student.cookie)).json().wallet.owned.includes('glass'));assert.ok(!(await x.send('/shop','GET',undefined,x.admin.cookie)).json().wallet.owned.includes('glass'));
 const portable=makeBackup(x.c.store),newRoot=mkdtempSync(join(tmpdir(),'zhixu-gift-')),fresh=buildApp(new Store(newRoot),{auth:false});try{restoreBackup(fresh.store,portable);assert.ok(fresh.store.asUser(x.student.user,()=>readWallet(fresh.store)).owned.includes('glass'));}finally{await fresh.app.close();rmSync(newRoot,{recursive:true,force:true});}
});

test('shared backlog respects quota, pauses persistently, resumes on a new day and never regenerates completed results',async t=>{
 const x=await fixture(t);await x.send('/shared-solutions/control','POST',{paused:true},x.admin.cookie);
 const one=await x.q(),two=await x.q({title:'第二题'}),partial=await x.q({answer:'',explanation:'老师原有讲解',explanationOrigin:'原文'});
 await x.send('/ai/admin','PATCH',{daily:1},x.admin.cookie);
 assert.equal((await x.send('/shared-solutions/fill','POST',{},x.student.cookie)).statusCode,403);
 await x.send('/shared-solutions/fill','POST',{},x.admin.cookie);await x.send('/shared-solutions/fill','POST',{},x.admin.cookie);await x.reopen();
 assert.equal((await x.send('/shared-solutions/summary','GET',undefined,x.admin.cookie)).json().paused,true);assert.equal(x.calls,0);
 await x.send('/shared-solutions/control','POST',{paused:false},x.admin.cookie);
 await x.wait(()=>x.c.store.db.prepare("SELECT COUNT(*) n FROM shared_solutions WHERE status='done'").get()?.n===1&&x.c.store.db.prepare("SELECT COUNT(*) n FROM shared_solutions WHERE status='waiting'").get()?.n===2);
 assert.equal(x.calls,1);assert.equal(x.c.store.aiAccess!.usage(x.admin.user).used,1);
 const day=chinaDay();x.c.store.db.prepare('UPDATE ai_usage SET day=? WHERE userId=? AND day=?').run('2000-01-01',x.admin.user.id,day);
 await x.reopen();await x.wait(()=>x.c.store.db.prepare("SELECT COUNT(*) n FROM shared_solutions WHERE status='done'").get()?.n===2&&x.c.store.db.prepare("SELECT COUNT(*) n FROM shared_solutions WHERE status='waiting'").get()?.n===1);assert.equal(x.calls,2);
 await x.send('/ai/admin','PATCH',{daily:2},x.admin.cookie);await x.send('/shared-solutions/control','POST',{paused:false},x.admin.cookie);
 await x.wait(()=>x.c.store.db.prepare("SELECT COUNT(*) n FROM shared_solutions WHERE status='done'").get()?.n===3);assert.equal(x.calls,3);
 const final=(await x.send('/questions/'+partial.id,'GET',undefined,x.student.cookie)).json();assert.equal(final.question.answer,'2');assert.equal(final.question.explanation,'老师原有讲解');
 await x.send('/shared-solutions/fill','POST',{},x.admin.cookie);for(const q of [one,two,partial]){for(let i=0;i<2;i++)assert.ok((await x.send('/questions/'+q.id,'GET',undefined,x.student.cookie)).json().question.explanation);}assert.equal(x.calls,3);assert.equal(x.c.store.aiAccess!.usage(x.student.user).used,0);
});

test('four image questions batch once, retain separate answers and reuse results on repeated clicks',async t=>{
 const x=await fixture(t),qs=[];
 await x.send('/shared-solutions/control','POST',{paused:true},x.admin.cookie);
 for(let i=0;i<4;i++){const a=x.c.store.attach(createCanvas(20+i,20).toBuffer('image/png'),'题图'+i+'.png','image/png');qs.push(await x.q({sources:[{attachmentId:a.id,imageId:a.id,name:a.name,page:1}]}));}
 await x.send('/shared-solutions/fill','POST',{rebuildAI:true},x.admin.cookie);await x.send('/shared-solutions/control','POST',{paused:false},x.admin.cookie);
 const interactive=x.send('/questions/'+qs[0].id+'/explanations','POST',{},x.admin.cookie);
 await x.wait(()=>x.c.store.db.prepare("SELECT COUNT(*) n FROM shared_solutions WHERE status='done'").get()?.n===4);assert.equal((await interactive).statusCode,200);assert.equal(x.calls,1);
 for(const q of qs){const d=(await x.send('/questions/'+q.id,'GET',undefined,x.student.cookie)).json().question;assert.equal(d.answer,'2');assert.equal(d.solutionVersion,'detailed-v1');}
 await x.send('/shared-solutions/fill','POST',{rebuildAI:true},x.admin.cookie);await new Promise(r=>setTimeout(r,30));assert.equal(x.calls,1);
 assert.equal((await x.send('/ai/preferences','PUT',{model:'cn:glm-5.1',visionModel:''},x.student.cookie)).statusCode,400);
 assert.equal((await x.send('/ai/preferences','PUT',{model:'cn:glm-5.2',visionModel:''},x.student.cookie)).statusCode,400);
 const usage=(await x.send('/ai/usage','GET',undefined,x.student.cookie)).json();assert.equal(usage.defaultModel,'mock');assert.equal(usage.defaultVisionModel,'mock');
 await x.send('/questions/'+qs[0].id,'PATCH',{stem:'新题干需要重新核对'},x.admin.cookie);assert.equal((await x.send('/questions/'+qs[0].id,'GET',undefined,x.admin.cookie)).json().question.solutionVersion,undefined);
});
