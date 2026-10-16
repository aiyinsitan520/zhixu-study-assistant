import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store,decodeRecord} from '../server/store.ts';
import {questionInput} from '../shared/schema.ts';
import {makeBackup,restoreBackup} from '../server/backup.ts';
import {buildApp} from '../server/app.ts';

test('device sync and backup retain edit timestamps so older copies cannot replace newer records',async t=>{
 const root=mkdtempSync(join(tmpdir(),'zhixu-sync-')),c=buildApp(new Store(root));await c.app.ready();
 t.after(async()=>{await c.app.close();rmSync(root,{recursive:true,force:true});});
 const send=(url:string,method:any='GET',payload?:any,cookie?:string)=>c.app.inject({url:'/api'+url,method,payload,headers:{host:'127.0.0.1:4317',...(cookie?{cookie}:{})}});
 const setup=await send('/auth/setup','POST',{username:'owner',password:'sync-test-password-123',name:'Owner'}),user=setup.json().user,cookie=String(setup.headers['set-cookie']).split(';')[0];
 const q=(await send('/questions','POST',{title:'Sync test',stem:'Question'},cookie)).json(),base=Date.now()+10000,createdAt=new Date(base).toISOString(),older=new Date(base+1000).toISOString(),newer=new Date(base+2000).toISOString();
 const attempt={id:randomUUID(),questionId:q.id,answer:'newer answer',images:[],correct:true,judgement:'人工',feedback:'newer feedback',createdAt,updatedAt:newer};
 const records={attempts:[attempt],progress:[{id:q.id,wrong:false,mastered:true,updatedAt:newer}],rewards:[{id:q.id,points:10,createdAt,updatedAt:newer}],explanations:[{id:randomUUID(),questionId:q.id,content:'newer explanation',model:'test',createdAt,updatedAt:newer}]};
 const uploaded=await send('/personal/sync','POST',{records},cookie);assert.equal(uploaded.statusCode,200,uploaded.body);
 const stale=structuredClone(records);stale.attempts[0]={...attempt,answer:'stale answer',correct:false,updatedAt:older};stale.progress[0]={...stale.progress[0],wrong:true,mastered:false,updatedAt:older};stale.rewards[0].updatedAt=older;stale.explanations[0]={...stale.explanations[0],content:'stale explanation',updatedAt:older};
 assert.equal((await send('/personal/sync','POST',{records:stale},cookie)).statusCode,200);
 const assertCurrent=async()=>{const actual=(await send('/personal','GET',undefined,cookie)).json();for(const [kind,items] of Object.entries(records))assert.deepEqual(actual[kind],items,kind);};
 await assertCurrent();const archive=makeBackup(c.store);restoreBackup(c.store,archive);await assertCurrent();
 c.store.quotaLimit=c.store.asUser(user,()=>c.store.usage().used)+5;
 const failed=await send('/personal/sync','POST',{records:{drafts:[{id:q.id,answer:randomBytes(1000).toString('hex'),images:[],revision:1,updatedAt:newer}]}},cookie);
 assert.equal(failed.statusCode,413,failed.body);assert.equal((await send('/personal','GET',undefined,cookie)).json().drafts.length,0);
});
test('compressed per-account records enforce quota atomically, survive reopening and backup, and exclude shared questions',()=>{
 const root=mkdtempSync(join(tmpdir(),'zhixu-storage-'));let s=new Store(root);const a={id:randomUUID(),username:'alice',name:'Alice',role:'student' as const},b={...a,id:randomUUID(),username:'bob'};
 const q={...questionInput.parse({title:'test',stem:'Shared '.repeat(10000)}),id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deleted:false,wrong:false,mastered:false};s.put('questions',q);
 s.asUser(a,()=>{assert.equal(s.usage().used,0);s.put('drafts',{id:q.id,answer:'推导过程'.repeat(10000),images:[],updatedAt:new Date().toISOString(),revision:1});assert.ok(s.usage().used<1500);const row=s.db.prepare('SELECT data FROM records WHERE kind=?').get('user-'+a.id+':drafts')!;assert.equal(JSON.parse(row.data as string).__gzip,1);assert.equal(decodeRecord(row.data as string).revision,1);});
 s.asUser(b,()=>{assert.equal(s.usage().used,0);assert.equal(s.get('drafts',q.id),undefined);});s.close();s=new Store(root);
 s.asUser(a,()=>{assert.equal((s.get<any>('drafts',q.id)).answer,'推导过程'.repeat(10000));s.quotaLimit=s.usage().used+50;assert.throws(()=>s.transaction(()=>{s.put('progress',{id:q.id,wrong:true,mastered:false});s.put('drafts',{id:q.id,answer:randomBytes(3000).toString('hex'),images:[],updatedAt:new Date().toISOString(),revision:2});}),/1 GB/);assert.equal(s.get('progress',q.id),undefined);assert.equal(s.get<any>('drafts',q.id)?.revision,1);assert.throws(()=>s.attach(Buffer.alloc(1000),'test.jpg','image/jpeg'),/1 GB/);});
 s.quotaLimit=1024**3;const archive=makeBackup(s);restoreBackup(s,archive);s.close();s=new Store(root);s.asUser(a,()=>assert.equal(s.get<any>('drafts',q.id)?.revision,1));s.asUser(b,()=>assert.equal(s.all('drafts').length,0));s.close();rmSync(root,{recursive:true,force:true});
});
