import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {Store,id,now} from './store.ts';
import type {Auth,User} from './auth.ts';
import type {Attachment} from '../shared/schema.ts';
import {feedbackInput,feedbackCategories,feedbackStatuses,FEEDBACK_REWARD,type Feedback,type FeedbackAward} from '../shared/feedback.ts';
import {reconcileFeedbackRewards} from './shop.ts';
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function feedbackRoutes(app:FastifyInstance,store:Store,auth?:Auth){
 store.db.exec("CREATE VIEW IF NOT EXISTS v_feedback_catalog AS SELECT id,json_extract(data,'$.ownerId') AS owner_id,json_extract(data,'$.category') AS category,json_extract(data,'$.status') AS status,json_extract(data,'$.rewardCoins') AS reward_coins,json_extract(data,'$.createdAt') AS created_at FROM records WHERE kind='feedback';");
 const own=(req:any,key:string)=>{const item=store.get<Feedback>('feedback',key);if(!item||req.user?.guest||!req.user||item.ownerId!==req.user.id&&req.user.role!=='admin')throw fail('反馈不存在',404);return item;};
 app.get('/api/feedback/rewards',req=>req.user&&!req.user.guest?store.all<FeedbackAward>('feedbackAwards').filter(a=>a.ownerId===req.user!.id):[]);
 app.get('/api/feedback',req=>({items:!req.user||req.user.guest?[]:store.all<Feedback>('feedback').filter(f=>req.user!.role==='admin'||f.ownerId===req.user!.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),reward:FEEDBACK_REWARD}));
 app.post('/api/feedback',async req=>{
  if(!req.user||req.user.guest)throw fail('注册并登录后，就能提交反馈啦',403);
  const v=feedbackInput.parse(req.body),key=v.submissionId||id(),existing=store.get<Feedback>('feedback',key);
  if(existing){if(existing.ownerId!==req.user.id)throw fail('提交标识已使用，请重新打开反馈表单',409);return existing;}
  for(const imageId of v.images){const a=store.get<Attachment>('attachments',imageId);if(!a||a.ownerId!==req.user.id||!a.mime.startsWith('image/'))throw fail('请选择自己上传的问题截图');}
  const {submissionId,...values}=v;
  return store.put<Feedback>('feedback',{...values,id:key,ownerId:req.user.id,authorName:req.user.name,username:req.user.username,status:'pending',reply:'',rewardCoins:0,createdAt:now(),updatedAt:now()});
 });
 app.patch('/api/feedback/:id',async(req:any)=>{
  if(req.user?.role!=='admin'||req.user.guest)throw fail('仅管理员可以处理反馈',403);
  const v=z.object({status:z.enum(['pending','reviewing','adopted','resolved','declined']).optional(),reply:z.string().trim().max(6000).optional()}).refine(o=>Object.keys(o).length>0).parse(req.body);
  return store.transaction(()=>{
   const f=own(req,req.params.id),target=auth?.db.prepare('SELECT id,username,name,role FROM users WHERE id=?').get(f.ownerId) as User|undefined;
   if(!target)throw fail('反馈所属账号不存在，尚未处理或发放奖励',409);
   return store.asUser(target,()=>{
    let awardedAt=f.awardedAt,rewardCoins=f.rewardCoins;
    if(v.status==='adopted'){
     const awardId='feedback-'+f.id;
     if(!store.get('feedbackAwards',awardId))store.put<FeedbackAward>('feedbackAwards',{id:awardId,feedbackId:f.id,ownerId:f.ownerId,coins:FEEDBACK_REWARD,createdAt:now()});
     reconcileFeedbackRewards(store);awardedAt=awardedAt||now();rewardCoins=FEEDBACK_REWARD;
    }
    return store.put<Feedback>('feedback',{...f,...v,awardedAt,rewardCoins,adminId:req.user.id,updatedAt:now()});
   });
  });
 });
 app.get('/api/feedback/:id/images/:imageId',async(req:any,reply)=>{
  const f=own(req,req.params.id);if(!f.images.includes(req.params.imageId))throw fail('截图不存在',404);
  return store.context.exit(()=>{const a=store.get<Attachment>('attachments',req.params.imageId);if(!a||a.ownerId!==f.ownerId||!a.mime.startsWith('image/'))throw fail('截图不存在',404);reply.header('Cache-Control','private, no-store').type(a.mime);return reply.send(store.bytes(a.id));});
 });
}
