import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store.ts';
import type {Auth,User} from './auth.ts';
import type {Question} from '../shared/schema.ts';
import {chat,parseAI} from './ai.ts';
const output=z.object({answer:z.string().trim().min(1).max(30000),explanation:z.string().trim().min(1).max(100000)});
export class SharedSolutions {
 private running?:Promise<void>;
 get busy(){return !!this.running;}
 private closing=false;
 private controller=new AbortController();
 constructor(private store:Store,private auth?:Auth){store.db.exec("CREATE TABLE IF NOT EXISTS shared_solutions(questionId TEXT PRIMARY KEY,adminId TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT ''); UPDATE shared_solutions SET status='pending' WHERE status='running';");}
 enqueue(ids:string[],user:User){for(const id of ids)this.store.db.prepare("INSERT OR IGNORE INTO shared_solutions(questionId,adminId,status) VALUES(?,?,'pending')").run(id,user.id);setTimeout(()=>this.start(),0);}
 start(){if(!this.running&&!this.closing){this.running=this.work().finally(()=>{this.running=undefined;});}}
 private async work(){while(!this.closing){const task=this.store.db.prepare("SELECT * FROM shared_solutions WHERE status='pending' LIMIT 1").get() as any;if(!task)break;const row=this.auth?.db.prepare("SELECT id,username,name,role FROM users WHERE id=? AND role='admin' AND disabled=0").get(task.adminId) as User|undefined;if(!row){this.status(task.questionId,'error','管理员账号不可用');continue;}await this.store.asUser(row,async()=>{const q=this.store.get<Question>('questions',task.questionId);if(!q||q.deleted||q.ownerId){this.status(task.questionId,'skipped','题目已删除或为私人题目');return;}if(q.answer&&q.explanation){this.status(q.id,'done','已有答案与解析，保留原文');return;}this.status(q.id,'running','');try{const images=q.sources.flatMap(s=>s.imageId?[s.imageId]:[]);const result=parseAI(await chat(this.store,'你是大学数学助教。忠实根据题干和原图解题，给出答案与详细步骤、知识点、易错点。若信息不完整，明确指出缺失条件，不能编造。只返回 JSON {"answer":"参考答案，数学用LaTeX","explanation":"中文Markdown详细解析"}。',JSON.stringify({title:q.title,stem:q.stem,options:q.options,subquestions:q.subquestions,originalAnswer:q.answer}),images,this.controller.signal),output);const current=this.store.get<Question>('questions',q.id);if(!current||current.deleted||['stem','answer','explanation','sources','subquestions','options'].some(k=>JSON.stringify((current as any)[k])!==JSON.stringify((q as any)[k]))){this.status(q.id,'skipped','生成期间题目被修改，保留人工修改');return;}this.store.context.exit(()=>this.store.put('questions',{...current,answer:current.answer||result.answer,explanation:current.explanation||result.explanation,explanationOrigin:current.explanation?current.explanationOrigin:'AI',answerOrigin:current.answer?current.answerOrigin:'AI',answerConfirmed:current.answer?current.answerConfirmed:false,updatedAt:new Date().toISOString()}));this.status(q.id,'done','');}catch(e){this.status(q.id,this.closing?'pending':'error',(e as Error).message);}});}}
 private status(id:string,status:string,error:string){this.store.db.prepare('UPDATE shared_solutions SET status=?,error=? WHERE questionId=?').run(status,error,id);}
 register(app:FastifyInstance){app.addHook('onReady',async()=>{setTimeout(()=>this.start(),0);});app.get('/api/shared-solutions',req=>{const rows=this.store.db.prepare('SELECT * FROM shared_solutions').all();return req.user?.role==='admin'?rows:rows.map(r=>({questionId:r.questionId,status:r.status}));});app.post('/api/shared-solutions/retry',req=>{if(req.user?.role!=='admin')throw Object.assign(new Error('仅管理员可重试共享解析'),{statusCode:403});this.store.db.exec("UPDATE shared_solutions SET status='pending',error='' WHERE status IN ('error','skipped')");this.start();return {ok:true};});}
 async close(){this.closing=true;this.controller.abort();await this.running;}
}
