import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store.ts';
import type {Auth,User} from './auth.ts';
import {betaModels,visionChoices,type AIUsage} from '../shared/ai-models.ts';
import {randomUUID} from 'node:crypto';
import type {CallTotals,APIAdminStats} from '../shared/ai-admin.ts';
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const chinaDay=(date=new Date())=>date.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export class AIAccess {
 constructor(private store:Store){store.db.exec(`CREATE TABLE IF NOT EXISTS ai_policy(id TEXT PRIMARY KEY,daily INTEGER NOT NULL,model TEXT NOT NULL DEFAULT '',visionModel TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS ai_usage(userId TEXT NOT NULL,day TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(userId,day));
 INSERT OR IGNORE INTO ai_policy(id,daily) VALUES('*',100);
 CREATE TABLE IF NOT EXISTS ai_calls(id TEXT PRIMARY KEY,userId TEXT NOT NULL,day TEXT NOT NULL,createdAt TEXT NOT NULL,model TEXT NOT NULL,provider TEXT NOT NULL,vision INTEGER NOT NULL,status TEXT NOT NULL,durationMs INTEGER,promptTokens INTEGER,completionTokens INTEGER,totalTokens INTEGER,errorCode TEXT);
 CREATE INDEX IF NOT EXISTS ai_calls_day_user ON ai_calls(day,userId,createdAt);
 CREATE TABLE IF NOT EXISTS ai_metadata(id TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT OR IGNORE INTO ai_metadata VALUES('trackingSince',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 UPDATE ai_calls SET status='error',errorCode='interrupted' WHERE status='pending';
 UPDATE ai_policy SET model='' WHERE model IN ('cn:glm-5.1','cn:glm-5.2');
 UPDATE ai_policy SET visionModel='' WHERE visionModel IN ('cn:glm-5.1','cn:glm-5.2');`);}
 private changed(){this.store.changeSeq++;this.store.onChange?.();}
 beginCall(userId:string,model:string,provider:'beta'|'own',vision:boolean){const id=randomUUID(),start=Date.now();this.store.db.prepare("INSERT INTO ai_calls(id,userId,day,createdAt,model,provider,vision,status) VALUES(?,?,?,?,?,?,?,'pending')").run(id,userId,chinaDay(),new Date(start).toISOString(),model,provider,Number(vision));this.changed();let ended=false;return (status:'success'|'error',usage?:unknown,errorCode?:string)=>{if(ended)return;ended=true;const u=usage as any,token=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null,p=token(u?.prompt_tokens)??token(u?.input_tokens),c=token(u?.completion_tokens)??token(u?.output_tokens),total=token(u?.total_tokens)??(p!==null&&c!==null&&Number.isSafeInteger(p+c)?p+c:null);this.store.db.prepare('UPDATE ai_calls SET status=?,durationMs=?,promptTokens=?,completionTokens=?,totalTokens=?,errorCode=? WHERE id=?').run(status,Date.now()-start,p,c,total,errorCode??null,id);this.changed();};}
 stats(auth:Auth|undefined,day:string,userId?:string):APIAdminStats{
  const totals=(where:string,args:string[]):CallTotals=>this.store.db.prepare(`SELECT COUNT(*) calls,COALESCE(SUM(status='success'),0) success,COALESCE(SUM(status='error'),0) failed,COALESCE(SUM(status='pending'),0) pending,SUM(promptTokens) promptTokens,SUM(completionTokens) completionTokens,SUM(totalTokens) totalTokens,COALESCE(SUM(totalTokens IS NULL),0) unknownTokens FROM ai_calls WHERE day=? ${where}`).get(day,...args) as any;
  const users=(auth?.db.prepare('SELECT id,name,username,disabled,role FROM users ORDER BY rowid').all()||[]).map((u:any)=>{const usage=this.usage(u,day),beta=totals("AND userId=? AND provider='beta'",[u.id]);return {...u,...usage,override:this.policy(u.id).override,beta,own:totals("AND userId=? AND provider='own'",[u.id]),legacyUsed:Math.max(0,usage.used-beta.success-beta.pending)};});
  const names=new Map(users.map(u=>[u.id,u]));
  const recent=this.store.db.prepare('SELECT * FROM ai_calls WHERE day=?'+(userId?' AND userId=?':'')+' ORDER BY createdAt DESC,rowid DESC LIMIT 100').all(day,...(userId?[userId]:[])).map((r:any)=>({...r,name:names.get(r.userId)?.name||'已移除账号',username:names.get(r.userId)?.username||''}));
  const models=this.store.db.prepare('SELECT DISTINCT model,provider,vision FROM ai_calls WHERE day=? ORDER BY model,provider,vision').all(day).map((r:any)=>({...r,usage:totals('AND model=? AND provider=? AND vision=?',[r.model,r.provider,String(r.vision)])}));
  return {day,daily:this.policy('*').limit,summary:totals('',[]),beta:totals("AND provider='beta'",[]),own:totals("AND provider='own'",[]),users,models,recent:recent as any,filteredCalls:totals(userId?'AND userId=?':'',userId?[userId]:[]).calls,trackingSince:(this.store.db.prepare("SELECT value FROM ai_metadata WHERE id='trackingSince'").get()?.value as string)||null};
 }
 policy(userId:string){const common=this.store.db.prepare("SELECT daily FROM ai_policy WHERE id='*'").get() as any;const own=this.store.db.prepare('SELECT * FROM ai_policy WHERE id=?').get(userId) as any;return {limit:own?.daily>=0?own.daily:common.daily,model:own?.model||'',visionModel:own?.visionModel||'',override:own?.daily>=0?own.daily:null};}
 usage(user:User,day=chinaDay()):AIUsage{const p=this.policy(user.id),row=this.store.db.prepare('SELECT used FROM ai_usage WHERE userId=? AND day=?').get(user.id,day) as any,used=row?.used||0,c=this.store.publicConfig();return {day,used,limit:user.guest?0:p.limit,remaining:user.guest?0:Math.max(0,p.limit-used),model:p.model,visionModel:p.visionModel,defaultModel:c.model,defaultVisionModel:c.visionModel,guest:!!user.guest};}
 reserve(user:User){if(user.guest)throw fail('游客暂不开放 AI，请免费注册账号后使用每日额度',403);const day=chinaDay();this.store.transaction(()=>{const u=this.usage(user,day);if(u.remaining<=0)throw fail('今日 AI 额度已用完，北京时间零点重置，可联系管理员调整',429);this.store.db.prepare('INSERT INTO ai_usage(userId,day,used) VALUES(?,?,1) ON CONFLICT(userId,day) DO UPDATE SET used=used+1').run(user.id,day);});this.changed();let refunded=false;return ()=>{if(!refunded){this.store.db.prepare('UPDATE ai_usage SET used=MAX(0,used-1) WHERE userId=? AND day=?').run(user.id,day);refunded=true;this.changed();}};}
 register(app:FastifyInstance,auth?:Auth){
  app.get('/api/ai/admin/stats',req=>{if(req.user?.role!=='admin')throw fail('仅管理员可查看调用统计',403);const v=z.object({day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d).optional(),userId:z.string().max(100).optional()}).parse(req.query);return this.stats(auth,v.day||chinaDay(),v.userId);});
  app.get('/api/ai/usage',req=>this.usage(req.user||{id:'local',username:'local',name:'本机',role:'admin'}));
  app.put('/api/ai/preferences',req=>{if(!req.user||req.user.guest)throw fail('请先注册或登录',403);const v=z.object({model:z.string().refine(s=>!s||betaModels.some(m=>m.id===s)),visionModel:z.string().refine(s=>!s||visionChoices.some(m=>m.id===s))}).parse(req.body),p=this.policy(req.user.id);this.store.db.prepare('INSERT INTO ai_policy(id,daily,model,visionModel) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,visionModel=excluded.visionModel').run(req.user.id,p.override??-1,v.model,v.visionModel);this.changed();return this.usage(req.user);});
  app.get('/api/ai/admin',req=>{if(req.user?.role!=='admin')throw fail('仅管理员可调整额度',403);return {daily:this.policy('*').limit,users:(auth?.db.prepare('SELECT id,name,username,disabled FROM users ORDER BY rowid').all()||[]).map(u=>({...u,...this.usage({...u,role:'student'} as User),override:this.policy(String(u.id)).override}))};});
  app.patch('/api/ai/admin',req=>{if(req.user?.role!=='admin')throw fail('仅管理员可调整额度',403);const v=z.object({userId:z.string().min(1).optional(),daily:z.number().int().min(0).max(10000).nullable()}).parse(req.body);if(!v.userId&&v.daily===null)throw fail('默认额度不能为空');if(v.userId&&!auth?.db.prepare('SELECT id FROM users WHERE id=?').get(v.userId))throw fail('用户不存在',404);this.store.db.prepare('INSERT INTO ai_policy(id,daily) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET daily=excluded.daily').run(v.userId||'*',v.daily??-1);this.changed();return {ok:true};});
 }
}
