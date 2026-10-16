import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store.ts';
import type {Auth,User} from './auth.ts';
import {betaModels,visionChoices,type AIUsage} from '../shared/ai-models.ts';
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const chinaDay=(date=new Date())=>date.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export class AIAccess {
 constructor(private store:Store){store.db.exec(`CREATE TABLE IF NOT EXISTS ai_policy(id TEXT PRIMARY KEY,daily INTEGER NOT NULL,model TEXT NOT NULL DEFAULT '',visionModel TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS ai_usage(userId TEXT NOT NULL,day TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(userId,day));
 INSERT OR IGNORE INTO ai_policy(id,daily) VALUES('*',30);`);}
 policy(userId:string){const common=this.store.db.prepare("SELECT daily FROM ai_policy WHERE id='*'").get() as any;const own=this.store.db.prepare('SELECT * FROM ai_policy WHERE id=?').get(userId) as any;return {limit:own?.daily>=0?own.daily:common.daily,model:own?.model||'',visionModel:own?.visionModel||'',override:own?.daily>=0?own.daily:null};}
 usage(user:User,day=chinaDay()):AIUsage{const p=this.policy(user.id),row=this.store.db.prepare('SELECT used FROM ai_usage WHERE userId=? AND day=?').get(user.id,day) as any,used=row?.used||0;return {day,used,limit:user.guest?0:p.limit,remaining:user.guest?0:Math.max(0,p.limit-used),model:p.model,visionModel:p.visionModel,guest:!!user.guest};}
 reserve(user:User){if(user.guest)throw fail('游客暂不开放 AI，请免费注册账号后使用每日额度',403);const day=chinaDay();this.store.transaction(()=>{const u=this.usage(user,day);if(u.remaining<=0)throw fail('今日 AI 额度已用完，北京时间零点重置，可联系管理员调整',429);this.store.db.prepare('INSERT INTO ai_usage(userId,day,used) VALUES(?,?,1) ON CONFLICT(userId,day) DO UPDATE SET used=used+1').run(user.id,day);});let refunded=false;return ()=>{if(!refunded){this.store.db.prepare('UPDATE ai_usage SET used=MAX(0,used-1) WHERE userId=? AND day=?').run(user.id,day);refunded=true;}};}
 register(app:FastifyInstance,auth?:Auth){
  app.get('/api/ai/usage',req=>this.usage(req.user||{id:'local',username:'local',name:'本机',role:'admin'}));
  app.put('/api/ai/preferences',req=>{if(!req.user||req.user.guest)throw fail('请先注册或登录',403);const v=z.object({model:z.string().refine(s=>!s||betaModels.some(m=>m.id===s)),visionModel:z.string().refine(s=>!s||visionChoices.some(m=>m.id===s))}).parse(req.body),p=this.policy(req.user.id);this.store.db.prepare('INSERT INTO ai_policy(id,daily,model,visionModel) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,visionModel=excluded.visionModel').run(req.user.id,p.override??-1,v.model,v.visionModel);return this.usage(req.user);});
  app.get('/api/ai/admin',req=>{if(req.user?.role!=='admin')throw fail('仅管理员可调整额度',403);return {daily:this.policy('*').limit,users:(auth?.db.prepare('SELECT id,name,username,disabled FROM users ORDER BY rowid').all()||[]).map(u=>({...u,...this.usage({...u,role:'student'} as User),override:this.policy(String(u.id)).override}))};});
  app.patch('/api/ai/admin',req=>{if(req.user?.role!=='admin')throw fail('仅管理员可调整额度',403);const v=z.object({userId:z.string().optional(),daily:z.number().int().min(0).max(10000).nullable()}).parse(req.body);if(!v.userId&&v.daily===null)throw fail('默认额度不能为空');if(v.userId&&!auth?.db.prepare('SELECT id FROM users WHERE id=?').get(v.userId))throw fail('用户不存在',404);this.store.db.prepare('INSERT INTO ai_policy(id,daily) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET daily=excluded.daily').run(v.userId||'*',v.daily??-1);return {ok:true};});
 }
}
