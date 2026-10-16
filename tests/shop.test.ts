import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../server/app.ts';
import {Store} from '../server/store.ts';
import {makeBackup,restoreBackup} from '../server/backup.ts';
import {skins,skinById,defaultSkin} from '../shared/skins.ts';

test('claiming a correct reward mints coins exactly once and buys skins atomically',async t=>{
  const root=mkdtempSync(join(tmpdir(),'zhixu-shop-')),c=buildApp(new Store(root));
  await c.app.ready();t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});
  const send=(url:string,method:any='GET',payload?:any,cookie?:string)=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{})}});
  const password='shop-test-password-123';
  const setup=await send('/auth/setup','POST',{username:'owner',password,name:'Owner'});
  const admin=String(setup.headers['set-cookie']).split(';')[0];
  const invite=(await send('/auth/invites','POST',{uses:2},admin)).json().code;
  const alice=String((await send('/auth/register','POST',{username:'alice',password,name:'Alice',invite})).headers['set-cookie']).split(';')[0];
  const q=(await send('/questions','POST',{title:'求导',stem:'求 $x^2$ 的导数。',type:'单选',options:['A. $2x$','B. $x$'],answer:'A',answerConfirmed:true,answerOrigin:'人工'},admin)).json();

  const fresh=await send('/shop',undefined,undefined,alice);
  assert.equal(fresh.statusCode,200,fresh.body);
  assert.deepEqual(fresh.json().wallet,{id:'wallet',coins:0,earned:0,owned:[defaultSkin],activeSkin:defaultSkin,credited:[],createdAt:fresh.json().wallet.createdAt});
  assert.deepEqual(fresh.json().skins.map((s:any)=>s.id),skins.map(s=>s.id));

  // Coins are only paid for a question that is actually confirmed correct.
  const wrong=await send(`/questions/${q.id}/attempts`,'POST',{answer:'B'},alice);
  assert.equal((await send(`/questions/${q.id}/reward`,'POST',{},alice)).statusCode,400);
  const right=await send(`/questions/${q.id}/attempts`,'POST',{answer:'A'},alice);
  assert.equal(right.json().correct,true);
  const claim=await send(`/questions/${q.id}/reward`,'POST',{},alice);
  assert.equal(claim.statusCode,200,claim.body);
  assert.equal(claim.json().alreadyClaimed,false);assert.equal(claim.json().coinsEarned,10);assert.equal(claim.json().coins,10);
  // Re-claiming the same question must never mint coins twice.
  const again=await send(`/questions/${q.id}/reward`,'POST',{},alice);
  assert.equal(again.json().alreadyClaimed,true);assert.equal(again.json().coins,10);
  assert.equal((await send('/shop',undefined,undefined,alice)).json().wallet.earned,10);
  // The leaderboard rewards only the first correct attempt, matching the coin rule.
  assert.equal((await send('/bootstrap',undefined,undefined,alice)).json().stats.eligible.length,0);

  const ocean=skinById('ocean')!;
  const poor=await send(`/shop/skins/${ocean.id}`,'POST',{},alice);
  assert.equal(poor.statusCode,400,poor.body);assert.match(poor.json().error,/还需要 110 金币/);
  assert.deepEqual((await send('/shop',undefined,undefined,alice)).json().wallet.owned,[defaultSkin]);

  const wallet=(await send('/shop',undefined,undefined,alice)).json().wallet;
  const aliceUser=c.auth!.db.prepare("SELECT id,username,name,role FROM users WHERE username='alice'").get() as any;
  c.store.asUser(aliceUser,()=>c.store.put('wallet',{...wallet,coins:ocean.cost}));
  const bought=await send(`/shop/skins/${ocean.id}`,'POST',{},alice);
  assert.equal(bought.statusCode,200,bought.body);
  assert.equal(bought.json().purchased,true);assert.equal(bought.json().wallet.activeSkin,'ocean');assert.equal(bought.json().wallet.coins,0);
  assert.deepEqual(bought.json().wallet.owned,[defaultSkin,'ocean']);
  // Owning a skin re-selects it for free instead of charging again.
  const reselect=await send('/shop/active','POST',{id:defaultSkin},alice);
  assert.equal(reselect.json().wallet.activeSkin,defaultSkin);assert.equal(reselect.json().wallet.coins,0);
  const rebuy=await send(`/shop/skins/${ocean.id}`,'POST',{},alice);
  assert.equal(rebuy.json().purchased,false);assert.equal(rebuy.json().wallet.activeSkin,'ocean');assert.equal(rebuy.json().wallet.coins,0);
  assert.equal((await send('/shop/active','POST',{id:'does-not-exist'},alice)).statusCode,404);
  assert.equal((await send('/shop/skins/nope','POST',{},alice)).statusCode,404);
  // Wallets are per account.
  assert.equal((await send('/shop',undefined,undefined,admin)).json().wallet.coins,0);
  assert.deepEqual((await send('/shop',undefined,undefined,admin)).json().wallet.owned,[defaultSkin]);

  const archive=makeBackup(c.store);restoreBackup(c.store,archive);
  const restored=(await send('/shop',undefined,undefined,alice)).json().wallet;
  assert.equal(restored.activeSkin,'ocean');assert.deepEqual(restored.owned,[defaultSkin,'ocean']);
  assert.equal(restored.credited.length,1);
});

test('leaderboard counts participants and accuracy, and anonymity hides the real name',async t=>{
  const root=mkdtempSync(join(tmpdir(),'zhixu-board-')),c=buildApp(new Store(root));
  await c.app.ready();t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});
  const send=(url:string,method:any='GET',payload?:any,cookie?:string)=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{})}});
  const password='board-test-password-123';
  const setup=await send('/auth/setup','POST',{username:'owner',password,name:'站长'});
  const admin=String(setup.headers['set-cookie']).split(';')[0];
  const invite=(await send('/auth/invites','POST',{uses:3},admin)).json().code;
  const reg=async(username:string,name:string)=>String((await send('/auth/register','POST',{username,password,name,invite})).headers['set-cookie']).split(';')[0];
  const alice=await reg('alice','Alice'),bob=await reg('bob','Bob'),carol=await reg('carol','Carol');
  const mk=async(title:string,answer:string)=>(await send('/questions','POST',{title,stem:title,type:'单选',options:['A. 甲','B. 乙'],answer,answerConfirmed:true,answerOrigin:'人工'},admin)).json();
  const q1=await mk('题一','A'),q2=await mk('题二','B');

  const empty=await send('/leaderboard',undefined,undefined,alice);
  assert.equal(empty.statusCode,200,empty.body);
  assert.deepEqual({participants:empty.json().participants,entries:empty.json().entries,me:empty.json().me},{participants:0,entries:[],me:null});

  // Bob: 2/2 correct. Carol: 1/1 correct. Alice: 1/2 correct — distinct enough to pin the sort order.
  await send(`/questions/${q1.id}/attempts`,'POST',{answer:'A'},alice);
  await send(`/questions/${q2.id}/attempts`,'POST',{answer:'A'},alice);
  await send(`/questions/${q1.id}/attempts`,'POST',{answer:'A'},bob);
  await send(`/questions/${q2.id}/attempts`,'POST',{answer:'B'},bob);
  await send(`/questions/${q1.id}/attempts`,'POST',{answer:'A'},carol);

  const board=(await send('/leaderboard',undefined,undefined,alice)).json();
  assert.equal(board.participants,3);
  assert.deepEqual(board.entries.map((e:any)=>[e.name,e.attempts,e.correct,e.accuracy,e.activeDays,e.me]),[['Bob',2,2,100,1,false],['Carol',1,1,100,1,false],['Alice',2,1,50,1,true]]);
  assert.equal(board.me.name,'Alice');assert.equal(board.me.correct,1);
  assert.equal(board.anonymous,false);
  // A disabled account drops out of the ranking.
  const carolId=(c.auth!.db.prepare("SELECT id FROM users WHERE username='carol'").get() as any).id;
  await send('/auth/users/'+carolId,'PATCH',{disabled:true},admin);
  assert.equal((await send('/leaderboard',undefined,undefined,alice)).json().participants,2);
  // Disabling an account invalidates its session, so it must sign in again.
  assert.equal((await send('/profile','PUT',{anonymous:true},carol)).statusCode,401);
  await send('/auth/users/'+carolId,'PATCH',{disabled:false},admin);
  const relogin=await send('/auth/login','POST',{username:'carol',password});
  const carol2=String(relogin.headers['set-cookie']).split(';')[0];
  assert.equal((await send('/profile','PUT',{anonymous:true},carol2)).json().anonymous,true);
  const anon=(await send('/leaderboard',undefined,undefined,alice)).json();
  const hidden=anon.entries.find((e:any)=>e.name!=='Alice'&&e.name!=='Bob');
  assert.match(hidden.name,/^匿名同学 \d{4}$/);assert.equal(hidden.anonymous,true);
  const again=await send('/leaderboard',undefined,undefined,bob);
  assert.equal(again.json().entries.find((e:any)=>e.userId===carolId).name,hidden.name);
  // The owner still sees their own real name and can switch back.
  const mine=(await send('/leaderboard',undefined,undefined,carol2)).json();
  assert.equal(mine.me.name,'Carol');assert.equal(mine.me.anonymous,false);assert.equal(mine.anonymous,true);
  assert.equal((await send('/profile','PUT',{anonymous:false},carol2)).json().anonymous,false);
  assert.equal((await send('/leaderboard',undefined,undefined,alice)).json().entries.find((e:any)=>e.userId===carolId).name,'Carol');

  // Personal answers never leak through the ranking payload.
  assert.equal(JSON.stringify(anon).includes('answer'),false);
});
