import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {buildApp} from '../server/app.ts';
import {makeBackup,restoreBackup} from '../server/backup.ts';
async function setup(t:any){
 const root=mkdtempSync(join(tmpdir(),'zhixu-feedback-'));let c=buildApp(new Store(root));await c.app.ready();t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});
 const send=(url:string,method:any='GET',payload?:any,cookie?:string)=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{})}});
 const login=async(name:string,setup=false)=>{const r=await send('/auth/'+(setup?'setup':'register'),'POST',{username:name,name,password:'Feedback-test-2026'});assert.equal(r.statusCode,200,r.body);return {cookie:String(r.headers['set-cookie']).split(';')[0],user:r.json().user};};
 const admin=await login('admin',true),alice=await login('alice'),bob=await login('bob');
 return {get c(){return c;},send,admin,alice,bob,reopen:async()=>{await c.app.close();c=buildApp(new Store(root));await c.app.ready();}};
}
test('feedback submissions are idempotent, private, and screenshots are visible only to the submitter and admins',async t=>{
 const x=await setup(t),image=x.c.store.asUser(x.alice.user,()=>x.c.store.attach(Buffer.from('feedback screenshot'),'bug.png','image/png')),submissionId=randomUUID(),payload={submissionId,title:'按钮没有反应',content:'点击封面没有跳转，请扩大点击区域',category:'bug',images:[image.id],ownerId:x.bob.user.id,rewardCoins:1000};
 const r=await x.send('/feedback','POST',payload,x.alice.cookie);assert.equal(r.statusCode,200,r.body);const f=r.json();assert.equal(f.ownerId,x.alice.user.id);assert.equal(f.rewardCoins,0);
 assert.equal((await x.send('/feedback','POST',payload,x.alice.cookie)).json().id,f.id);assert.equal((await x.send('/feedback','GET',undefined,x.alice.cookie)).json().items.length,1);assert.deepEqual((await x.send('/feedback','GET',undefined,x.bob.cookie)).json().items,[]);assert.equal((await x.send('/feedback','GET',undefined,x.admin.cookie)).json().items.length,1);
 assert.equal((await x.send('/feedback/'+f.id,'PATCH',{status:'adopted'},x.alice.cookie)).statusCode,403);
 for(const user of [x.alice,x.admin]){const photo=await x.send('/feedback/'+f.id+'/images/'+image.id,'GET',undefined,user.cookie);assert.equal(photo.statusCode,200);assert.equal(photo.body,'feedback screenshot');assert.match(String(photo.headers['cache-control']),/no-store/);}
 assert.equal((await x.send('/attachments/'+image.id,'GET',undefined,x.admin.cookie)).statusCode,404);assert.equal((await x.send('/feedback/'+f.id+'/images/'+image.id,'GET',undefined,x.bob.cookie)).statusCode,404);
 assert.equal((await x.send('/feedback','POST',{...payload,submissionId:randomUUID()},x.bob.cookie)).statusCode,400);
 const guest=await x.send('/auth/guest','POST'),g=String(guest.headers['set-cookie']).split(';')[0];assert.equal((await x.send('/feedback','POST',payload,g)).statusCode,403);assert.deepEqual((await x.send('/feedback/rewards','GET',undefined,g)).json(),[]);
 restoreBackup(x.c.store,makeBackup(x.c.store));const restored=(await x.send('/feedback','GET',undefined,x.alice.cookie)).json().items[0];assert.notEqual(restored.images[0],image.id);assert.equal((await x.send('/feedback/'+f.id+'/images/'+restored.images[0],'GET',undefined,x.admin.cookie)).body,'feedback screenshot');
});
test('adoption credits exactly 1000 coins to the submitting account across concurrency, status changes, restarts and backup restore',async t=>{
 const x=await setup(t),f=(await x.send('/feedback','POST',{title:'希望增加反馈功能',content:'便于汇总Bug',category:'suggestion'},x.alice.cookie)).json(),url='/feedback/'+f.id;
 const reviews=await Promise.all(Array.from({length:8},()=>x.send(url,'PATCH',{status:'adopted',reply:'谢谢你，我们采纳啦！'},x.admin.cookie)));for(const r of reviews)assert.equal(r.statusCode,200,r.body);
 const wallet=async(user=x.alice)=>(await x.send('/shop','GET',undefined,user.cookie)).json().wallet;assert.equal((await wallet()).coins,1000);assert.equal((await wallet()).earned,1000);assert.equal((await wallet(x.admin)).coins,0);assert.equal((await wallet(x.bob)).coins,0);assert.equal(x.c.store.all('feedbackAwards').length,1);
 await x.send(url,'PATCH',{status:'reviewing'},x.admin.cookie);await x.send(url,'PATCH',{status:'adopted'},x.admin.cookie);assert.equal((await wallet()).coins,1000);
 restoreBackup(x.c.store,makeBackup(x.c.store));await x.reopen();assert.equal((await x.send(url,'PATCH',{status:'adopted'},x.admin.cookie)).statusCode,200);assert.equal((await wallet()).coins,1000);const list=(await x.send('/feedback','GET',undefined,x.alice.cookie)).json().items;assert.equal(list[0].rewardCoins,1000);assert.equal(list[0].reply,'谢谢你，我们采纳啦！');assert.equal((await x.send('/feedback/rewards','GET',undefined,x.alice.cookie)).json().length,1);
});
test('uploading an older device wallet retains the adoption reward once and keeps unrelated device coins',async t=>{
 const x=await setup(t),f=(await x.send('/feedback','POST',{title:'设备反馈',content:'设备模式也应收到奖励'},x.alice.cookie)).json();await x.send('/feedback/'+f.id,'PATCH',{status:'adopted'},x.admin.cookie);
 const device={id:'wallet',coins:40,earned:40,owned:['forest'],activeSkin:'forest',credited:[],createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()+10000).toISOString()},sync=()=>x.send('/personal/sync','POST',{records:{wallet:[device]}},x.alice.cookie);
 for(let i=0;i<2;i++){const r=await sync();assert.equal(r.statusCode,200,r.body);const w=(await x.send('/shop','GET',undefined,x.alice.cookie)).json().wallet;assert.equal(w.coins,1040);assert.equal(w.earned,1040);assert.ok(w.credited.includes('feedback-'+f.id));}
});
test('failed quota checks roll back the feedback status, award ledger and wallet together',async t=>{
 const x=await setup(t),f=(await x.send('/feedback','POST',{title:'原子性验证',content:'奖励不能只发一半'},x.alice.cookie)).json();x.c.store.quotaLimit=0;
 const r=await x.send('/feedback/'+f.id,'PATCH',{status:'adopted'},x.admin.cookie);assert.equal(r.statusCode,413,r.body);assert.equal(x.c.store.all('feedbackAwards').length,0);assert.equal(x.c.store.get<any>('feedback',f.id).status,'pending');assert.equal((await x.send('/shop','GET',undefined,x.alice.cookie)).json().wallet.coins,0);
 x.c.store.quotaLimit=1024**3;assert.equal((await x.send('/feedback/'+f.id,'PATCH',{status:'adopted'},x.admin.cookie)).statusCode,200);assert.equal((await x.send('/shop','GET',undefined,x.alice.cookie)).json().wallet.coins,1000);
});
