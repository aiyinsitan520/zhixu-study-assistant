import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store.ts';
import type {Auth,User} from './auth.ts';
import type {Question} from '../shared/schema.ts';
type Task={questionId:string;adminId:string;status:string;error:string;force:number};
const forbidden=()=>Object.assign(new Error('仅管理员可管理共享解析'),{statusCode:403});
export class SharedSolutions {
 private workers=new Map<number,Promise<void>>();
 get busy(){return this.workers.size>0;}
 private closing=false;
 private controller=new AbortController();
 private timer?:ReturnType<typeof setInterval>;
 constructor(private store:Store,private auth?:Auth){store.db.exec(`CREATE TABLE IF NOT EXISTS shared_solutions(questionId TEXT PRIMARY KEY,adminId TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS shared_solution_control(id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO shared_solution_control(id,paused) VALUES(1,0);
 UPDATE shared_solutions SET status='pending' WHERE status='running';`);if(!store.db.prepare('PRAGMA table_info(shared_solutions)').all().some(r=>r.name==='force'))store.db.exec('ALTER TABLE shared_solutions ADD COLUMN force INTEGER NOT NULL DEFAULT 0');if(!store.db.prepare('PRAGMA table_info(shared_solution_control)').all().some(r=>r.name==='concurrency'))store.db.exec('ALTER TABLE shared_solution_control ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 3');}
 get paused(){return !!this.store.db.prepare('SELECT paused FROM shared_solution_control WHERE id=1').get()?.paused;}
 get concurrency(){return Math.max(1,Math.min(8,Number(this.store.db.prepare('SELECT concurrency FROM shared_solution_control WHERE id=1').get()?.concurrency)||3));}
 state(id:string){const t=this.store.db.prepare('SELECT status FROM shared_solutions WHERE questionId=?').get(id);return t?{status:t.status,paused:this.paused}:undefined;}
 summary(){const qs=this.store.context.exit(()=>this.store.all<Question>('questions').filter(q=>!q.deleted&&!q.ownerId)),rows=this.store.db.prepare('SELECT status,COUNT(*) n FROM shared_solutions GROUP BY status').all();return {total:qs.length,ready:qs.filter(q=>q.answer&&q.explanation).length,detailed:qs.filter(q=>q.solutionVersion==='detailed-v1').length,missing:qs.filter(q=>!q.answer||!q.explanation).length,paused:this.paused,concurrency:this.concurrency,queue:Object.fromEntries(rows.map(r=>[String(r.status),Number(r.n)]))};}
 enqueue(ids:string[],user:User,force=false){for(const id of ids)this.store.db.prepare("INSERT INTO shared_solutions(questionId,adminId,status,force) VALUES(?,?,'pending',?) ON CONFLICT(questionId) DO UPDATE SET adminId=excluded.adminId,status='pending',error='',force=excluded.force WHERE shared_solutions.status IN ('done','skipped')").run(id,user.id,Number(force));this.store.onChange?.();setTimeout(()=>this.start(),0).unref();}
 start(){if(this.closing||this.paused)return;for(let lane=0;lane<this.concurrency;lane++)if(!this.workers.has(lane)){const promise=this.work(lane).finally(()=>this.workers.delete(lane));this.workers.set(lane,promise);}}
 progress(ids:string[]){const qs=ids.map(id=>this.store.get<Question>('questions',id)).filter((q):q is Question=>!!q&&!q.deleted&&!q.ownerId),ready=(q:Question)=>!!(q.answer&&q.explanation&&q.solutionVersion==='detailed-v1');return {total:qs.length,ready:qs.filter(ready).length,paused:this.paused,items:qs.map(q=>({id:q.id,title:q.title,ready:ready(q),status:this.state(q.id)?.status||'pending'}))};}
 private async work(lane:number){
  const blocked=new Set<string>();
  while(!this.closing&&!this.paused&&lane<this.concurrency){
   const tasks=this.store.db.prepare("SELECT * FROM shared_solutions WHERE status IN ('pending','waiting') ORDER BY rowid").all() as Task[],task=tasks.find(t=>!blocked.has(t.adminId));if(!task)break;
   const user=this.auth?.db.prepare("SELECT id,username,name,role FROM users WHERE id=? AND role='admin' AND disabled=0").get(task.adminId) as User|undefined;
   if(!user){this.status(task.questionId,'error','管理员账号不可用');continue;}
   await this.store.asUser(user,async()=>{
    const q=this.store.get<Question>('questions',task.questionId);
    if(!q||q.deleted||q.ownerId){this.status(task.questionId,'skipped','题目已删除或为私人题目');return;}
    if(q.answer&&q.explanation&&!task.force){this.status(q.id,'done','已有答案与解析，直接保留');return;}
    if(this.store.aiAccess!.usage(user).remaining<=0){blocked.add(user.id);this.wait(user.id);return;}
    const imageKey=(v:Question)=>v.sources.map(s=>s.imageId||'').filter(Boolean).sort().join('|'),page=imageKey(q);
    const batch=[{task,q}];
    if(page)for(const candidate of tasks){if(batch.length>=4)break;if(candidate.questionId===q.id||candidate.adminId!==user.id||candidate.force!==task.force)continue;const next=this.store.get<Question>('questions',candidate.questionId);if(!next||next.deleted||next.ownerId||((next.answer&&next.explanation)&&!candidate.force))continue;const images=new Set([...batch.flatMap(b=>b.q.sources.map(s=>s.imageId)),...next.sources.map(s=>s.imageId)].filter(Boolean));if(images.size<=4)batch.push({task:candidate,q:next});}
    for(const item of batch)this.status(item.q.id,'running','');
    try{const results=await this.store.aiResults!.sharedMany(batch.map(b=>b.q),this.controller.signal,!!task.force);for(let i=0;i<results.length;i++){const r=results[i];if(r.status==='fulfilled')this.status(batch[i].q.id,'done','');else if(this.closing)this.status(batch[i].q.id,'pending','服务重启后继续');else if((r.reason as any).statusCode===429&&this.store.aiAccess!.usage(user).remaining<=0){this.status(batch[i].q.id,'waiting','等待管理员额度');blocked.add(user.id);}else this.status(batch[i].q.id,'error',String(r.reason?.message||'生成未完成，请检查模型连接或题目信息后重试').slice(0,400));}}
    catch(e){if(this.closing){this.status(q.id,'pending','服务重启后继续');return;}if((e as any).statusCode===429&&this.store.aiAccess!.usage(user).remaining<=0){this.status(q.id,'waiting','等待管理员额度，北京时间零点后自动继续');blocked.add(user.id);this.wait(user.id);}else this.status(q.id,'error','生成未完成，请检查模型连接或题目信息后重试');}
   });
  }
 }
 private wait(adminId:string){this.store.db.prepare("UPDATE shared_solutions SET status='waiting',error='等待管理员额度，北京时间零点后自动继续' WHERE adminId=? AND status IN ('pending','waiting')").run(adminId);this.store.onChange?.();}
 private status(id:string,status:string,error:string){this.store.db.prepare('UPDATE shared_solutions SET status=?,error=? WHERE questionId=?').run(status,error,id);this.store.onChange?.();}
 register(app:FastifyInstance){
  app.addHook('onReady',async()=>{setTimeout(()=>this.start(),0).unref();this.timer=setInterval(()=>this.start(),30000);this.timer.unref();});
  app.get('/api/shared-solutions',req=>{const rows=this.store.db.prepare('SELECT * FROM shared_solutions').all();return req.user?.role==='admin'?rows:rows.map(r=>({questionId:r.questionId,status:r.status}));});
  app.get('/api/shared-solutions/summary',()=>this.summary());
  app.post('/api/shared-solutions/fill',req=>{if(req.user?.role!=='admin')throw forbidden();const {folderId,rebuildAI}=z.object({folderId:z.string().max(100).optional(),rebuildAI:z.boolean().optional()}).parse(req.body||{});const ids=this.store.context.exit(()=>this.store.all<Question>('questions').filter(q=>!q.deleted&&!q.ownerId&&(!folderId||q.folderId===folderId)&&(!q.answer||!q.explanation||(rebuildAI&&q.solutionVersion!=='detailed-v1'))).map(q=>q.id));this.enqueue(ids,req.user,!!rebuildAI);return this.summary();});
  app.post('/api/shared-solutions/control',req=>{if(req.user?.role!=='admin')throw forbidden();const v=z.object({paused:z.boolean().optional(),concurrency:z.number().int().min(1).max(8).optional()}).refine(v=>v.paused!==undefined||v.concurrency!==undefined).parse(req.body);if(v.paused!==undefined)this.store.db.prepare('UPDATE shared_solution_control SET paused=? WHERE id=1').run(Number(v.paused));if(v.concurrency!==undefined)this.store.db.prepare('UPDATE shared_solution_control SET concurrency=? WHERE id=1').run(v.concurrency);this.store.onChange?.();this.start();return this.summary();});
  app.post('/api/shared-solutions/retry',req=>{if(req.user?.role!=='admin')throw forbidden();this.store.db.exec("UPDATE shared_solutions SET status='pending',error='' WHERE status IN ('error','skipped')");this.store.onChange?.();this.start();return {ok:true};});
 }
 async close(){this.closing=true;if(this.timer)clearInterval(this.timer);this.controller.abort();await Promise.allSettled(this.workers.values());}
}
