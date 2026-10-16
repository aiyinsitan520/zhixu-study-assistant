import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {buildApp} from '../server/app.ts';
import {Store} from '../server/store.ts';
import {makeBackup,restoreBackup} from '../server/backup.ts';
import {inferKnowledge,knowledgeChapters,knowledgeTopics} from '../shared/knowledge.ts';
import type {Question} from '../shared/schema.ts';

async function setup(t:any){
 const root=mkdtempSync(join(tmpdir(),'zhixu-notices-'));let c=buildApp(new Store(root));await c.app.ready();
 t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});
 const send=(url:string,method:any='GET',payload?:any,cookie?:string)=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{})}});
 const password='qa-notices-password-123';
 const owner=await send('/auth/setup','POST',{username:'owner',password,name:'管理员'});
 const admin=String(owner.headers['set-cookie']).split(';')[0];
 const invite=(await send('/auth/invites','POST',{uses:2},admin)).json().code;
 const alice=await send('/auth/register','POST',{username:'alice',password,name:'学生',invite});
 const student=String(alice.headers['set-cookie']).split(';')[0];
 return {send,admin,student,get store(){return c.store;},async restart(){await c.app.close();c=buildApp(new Store(root));await c.app.ready();}};
}
const sample={title:'积分练习',stem:'计算 $\\int_0^1 x^2\\,dx$。',subject:'高等数学'};

test('announcements require login and only admins may publish or change them',async t=>{
 const c=await setup(t);
 for(const method of ['GET','POST'])assert.equal((await c.send('/announcements',method,method==='POST'?{title:'x',content:'y'}:undefined)).statusCode,401);
 assert.equal((await c.send('/announcements','POST',{title:'周计划',content:'完成练习'},c.student)).statusCode,403);
 const posted=await c.send('/announcements','POST',{title:'周计划',content:'**周一**：练习积分',pinned:true},c.admin);assert.equal(posted.statusCode,200,posted.body);
 const a=posted.json();assert.equal(a.authorName,'管理员');assert.equal(a.published,true);
 for(const body of [{published:false},{pinned:false},{content:'改动'}])assert.equal((await c.send('/announcements/'+a.id,'PATCH',body,c.student)).statusCode,403);
 assert.equal((await c.send('/announcements?admin=true')).statusCode,401);
 assert.equal((await c.send('/announcements?admin=true','GET',undefined,c.student)).json()[0].id,a.id);
 for(const body of [{title:' ',content:'test'},{title:'test',content:''},{title:'a'.repeat(101),content:'test'}])assert.equal((await c.send('/announcements','POST',body,c.admin)).statusCode,400);
 for(const body of [{},{published:'yes'},{authorName:'冒名'},{title:''}])assert.equal((await c.send('/announcements/'+a.id,'PATCH',body,c.admin)).statusCode,400);
 const edit=(await c.send('/announcements/'+a.id,'PATCH',{title:'新周计划'},c.admin)).json();assert.equal(edit.pinned,true);assert.equal(edit.content,a.content);
 const b=(await c.send('/announcements','POST',{title:'普通消息',content:'练习'},c.admin)).json();
 assert.equal((await c.send('/announcements','GET',undefined,c.student)).json()[0].id,a.id);
 await c.send('/announcements/'+a.id,'PATCH',{published:false},c.admin);
 assert.deepEqual((await c.send('/announcements','GET',undefined,c.student)).json().map((v:any)=>v.id),[b.id]);
 assert.equal((await c.send('/announcements','GET',undefined,c.admin)).json().length,2);
 await c.send('/announcements/'+a.id,'PATCH',{published:true},c.admin);
 assert.equal((await c.send('/announcements','GET',undefined,c.student)).json()[0].id,a.id);
 assert.equal((await c.send('/announcements/00000000-0000-4000-8000-000000000000','PATCH',{title:'missing'},c.admin)).statusCode,404);
 await c.restart();assert.equal((await c.send('/announcements','GET',undefined,c.student)).json().length,2);
});

test('announcements and manual knowledge tags survive backup, restore and old archives',async t=>{
 const c=await setup(t),old=makeBackup(c.store);
 const a=(await c.send('/announcements','POST',{title:'恢复测试',content:'长期保留',pinned:true},c.admin)).json();
 await c.send('/announcements/'+a.id,'PATCH',{published:false},c.admin);
 const q=(await c.send('/questions','POST',{...sample,knowledgeSource:'manual',knowledgePoints:['parts','definite-integral']},c.admin)).json();
 const archive=makeBackup(c.store);
 restoreBackup(c.store,old);assert.equal(c.store.all('announcements').length,0);
 restoreBackup(c.store,archive);
 assert.equal(c.store.get<any>('announcements',a.id).published,false);
 assert.deepEqual(c.store.get<Question>('questions',q.id)!.knowledgePoints,['parts','definite-integral']);
});

test('knowledge inference recognizes textbook calculus topics without inventing tags for unrelated or ambiguous material',()=>{
 assert.equal(knowledgeChapters.length,12);assert.equal(new Set(knowledgeTopics.map(t=>t.id)).size,knowledgeTopics.length);
 const infer=(stem:string,subject='高等数学',materialKind='question')=>inferKnowledge({title:'练习',stem,subject,materialKind});
 assert.ok(infer('计算极限 $\\lim_{x\\to0}\\frac{\\sin x}{x}$').includes('function-limit'));
 assert.deepEqual(infer('求数列极限 $\\lim_{n\\to\\infty} a_n$'),['sequence-limit']);
 assert.ok(infer('计算 $\\int_0^1 x^2 dx$').includes('definite-integral'));
 assert.ok(infer('计算不定积分 $\\int x^2 dx$').includes('antiderivative'));
 assert.ok(!infer('计算不定积分 $\\int x^2 dx$').includes('definite-integral'));
 assert.ok(!infer('换元求极限').includes('substitution'));
 assert.ok(infer('求偏导数 $\\partial f/\\partial x$').includes('partial'));
 assert.ok(!infer('求偏导数 $\\partial f/\\partial x$').includes('derivative'));
 assert.ok(infer('计算二重积分 $\\iint_D xy dxdy$').includes('double-integral'));
 assert.ok(!infer('计算三重积分 $\\iiint_V xyz dV$').includes('double-integral'));
 assert.deepEqual(infer('展开为傅里叶级数'),['fourier']);
 assert.deepEqual(infer('见附图回答'),[]);assert.deepEqual(infer('计算矩阵的极限','线性代数'),[]);assert.deepEqual(infer('一页极限练习','高等数学','page'),[]);
});

test('legacy and new questions classify automatically; manual choices survive edits, student progress and restart',async t=>{
 const c=await setup(t);
 const old={...sample,id:'legacy-question',type:'计算',answer:'1/3',sources:[],subquestions:[],options:[],explanation:'',answerOrigin:'无',answerConfirmed:false,folderId:null,deleted:false,wrong:false,mastered:false,materialKind:'question',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 c.store.put('questions',old);
 assert.ok((await c.send('/bootstrap','GET',undefined,c.student)).json().questions[0].knowledgePoints.includes('definite-integral'));
 const q=(await c.send('/questions','POST',sample,c.admin)).json();assert.ok(q.knowledgePoints.includes('definite-integral'));
 const edited=(await c.send('/questions/'+q.id,'PATCH',{stem:'求函数的偏导数'},c.admin)).json();assert.deepEqual(edited.knowledgePoints,['partial']);
 const tagged=(await c.send('/questions/'+q.id,'PATCH',{knowledgeSource:'manual',knowledgePoints:['parts']},c.admin)).json();assert.deepEqual(tagged.knowledgePoints,['parts']);
 await c.send('/questions/'+q.id,'PATCH',{wrong:true},c.student);
 assert.equal((await c.send('/questions/'+q.id,'PATCH',{knowledgePoints:['gradient']},c.student)).statusCode,403);
 assert.equal((await c.send('/questions/'+q.id,'PATCH',{knowledgePoints:['invented-topic']},c.admin)).statusCode,400);
 await c.send('/questions/'+q.id,'PATCH',{stem:'改为求极限'},c.admin);
 await c.restart();
 const detail=(await c.send('/questions/'+q.id,'GET',undefined,c.student)).json().question;assert.deepEqual(detail.knowledgePoints,['parts']);assert.equal(detail.wrong,true);assert.equal(detail.stem,'改为求极限');
 const automatic=(await c.send('/questions/'+q.id,'PATCH',{knowledgeSource:'auto'},c.admin)).json();assert.deepEqual(automatic.knowledgePoints,['function-limit']);
});

test('AI classification validates responses, skips manual choices, persists results, and preserves concurrent edits',async t=>{
 const c=await setup(t);let reply:any,mutate:(()=>void)|undefined,lastBody:any;
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;lastBody=JSON.parse(raw);mutate?.();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 c.store.saveConfig({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'qa-classifier',visionModel:'qa-vision-classifier',key:'fake-test-key'});
 const create=async(body:object)=>(await c.send('/questions','POST',{...sample,title:'应用题',stem:'讨论下列关系',...body},c.admin)).json();
 const image=c.store.attach(Buffer.from('mock image bytes'),'crop.png','image/png');
 const q=await create({sources:[{attachmentId:image.id,imageId:image.id,name:'原题裁切'}]}),manual=await create({knowledgeSource:'manual',knowledgePoints:[]});
 assert.equal((await c.send('/knowledge/classify','POST',{ids:[q.id]})).statusCode,401);
 assert.equal((await c.send('/knowledge/classify','POST',{ids:[q.id]},c.student)).statusCode,403);
 reply={questions:[{id:q.id,knowledgePoints:['invented']}]};assert.equal((await c.send('/knowledge/classify','POST',{ids:[q.id]},c.admin)).statusCode,400);assert.deepEqual(c.store.get<Question>('questions',q.id)!.knowledgePoints,[]);
 reply={questions:[{id:'wrong-id',knowledgePoints:['parts']}]};assert.equal((await c.send('/knowledge/classify','POST',{ids:[q.id]},c.admin)).statusCode,400);
 reply={questions:[{id:q.id,knowledgePoints:['parts']}]};
 const valid=await c.send('/knowledge/classify','POST',{ids:[q.id,manual.id]},c.admin);assert.equal(valid.statusCode,200,valid.body);assert.equal(valid.json().classified,1);assert.equal(valid.json().skipped,1);
 assert.equal(lastBody.model,'qa-vision-classifier');assert.equal(lastBody.messages[1].content[1].type,'image_url');assert.equal(JSON.parse(lastBody.messages[1].content[0].text).题目[0].imageNumber,1);
 assert.equal(c.store.get<Question>('questions',q.id)!.knowledgeSource,'AI');assert.deepEqual(c.store.get<Question>('questions',q.id)!.knowledgePoints,['parts']);
 const concurrent=await create({});reply={questions:[{id:concurrent.id,knowledgePoints:['parts']}]};mutate=()=>c.store.put('questions',{...c.store.get<Question>('questions',concurrent.id)!,knowledgeSource:'manual',knowledgePoints:['gradient'],updatedAt:'2099-01-01T00:00:00Z'});
 const conflict=await c.send('/knowledge/classify','POST',{ids:[concurrent.id]},c.admin);assert.equal(conflict.json().classified,0);assert.equal(conflict.json().skipped,1);assert.deepEqual(c.store.get<Question>('questions',concurrent.id)!.knowledgePoints,['gradient']);
 await c.restart();assert.deepEqual(c.store.get<Question>('questions',q.id)!.knowledgePoints,['parts']);
});
