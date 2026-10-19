import Fastify from 'fastify';
import {AIAccess} from './ai-access.ts';
import {SharedSolutions} from './shared-solutions.ts';
import {AIResults} from './ai-results.ts';
import {Snapshots} from './snapshots.ts';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {personalAISettings} from './personal-ai.ts';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { extname } from 'node:path';
import { createCanvas,loadImage } from '@napi-rs/canvas';
import {personalRoutes} from './personal.ts';
import {announcementRoutes} from './announcements.ts';
import {knowledgeRoutes} from './knowledge.ts';
import {shopRoutes,creditReward,readWallet} from './shop.ts';
import {leaderboardRoutes} from './leaderboard.ts';
import {feedbackRoutes} from './feedback.ts';
import {withKnowledge} from '../shared/knowledge.ts';
import { Store,id,now } from './store.ts';
import { questionInput,attemptInput,draftInput,gradingOutput } from '../shared/schema.ts';
import { BACKUP_UPLOAD_LIMIT } from '../shared/limits.ts';
import type { Question,Folder,Attempt,Draft,Attachment,ImportJob,ImportDraft,Explanation,Reward,Stats } from '../shared/schema.ts';
import { Importer,officePath,allowedExtensions,mimeFor } from './importer.ts';
import { chat,parseAI,effectiveAIConfig } from './ai.ts';
import { makeBackup,restoreBackup } from './backup.ts';
import { Auth } from './auth.ts';

const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const normalize=(s:string)=>s.trim().toUpperCase().replace(/[\s,，、;；]/g,'').split('').sort().join('');
const judge=(q:Question,answer:string):boolean|null=>{
  if(!q.answerConfirmed||!q.answer)return null;
  if(q.type==='判断'){const b=(s:string)=>['对','正确','TRUE','是','√'].includes(s.trim().toUpperCase())?true:['错','错误','FALSE','否','×'].includes(s.trim().toUpperCase())?false:null;const a=b(answer),v=b(q.answer);return a===null||v===null?null:a===v;}
  if(q.type==='单选'||q.type==='多选')return normalize(q.answer)===normalize(answer);
  return null;
};
export function buildApp(store=new Store(),options:{auth?:boolean;publicOrigin?:string;snapshots?:boolean}={}){
  const app=Fastify({logger:false,bodyLimit:5*1024*1024});
  const auth=options.auth===false?undefined:new Auth(store.root);
  const publicOrigin=options.publicOrigin||process.env.STUDY_PUBLIC_ORIGIN;
  const publicHost=publicOrigin?new URL(publicOrigin).host:undefined;
  const importer=new Importer(store);
  const aiAccess=store.aiAccess=new AIAccess(store);
  const aiResults=store.aiResults=new AIResults(store);
  aiResults.migrate(auth);
  aiResults.migrateReviews(auth);
  const snapshots=(options.snapshots??process.env.NODE_ENV==='production')?new Snapshots(store,auth):undefined;
  if(snapshots){store.onChange=()=>snapshots.schedule();snapshots.schedule();}
  const solutions=new SharedSolutions(store,auth);
  if(snapshots)app.addHook('onResponse',async(req)=>{if(req.url.startsWith('/api/auth/')&&!['GET','HEAD'].includes(req.method))snapshots.schedule();});
  const compress=promisify(gzip);
  app.addHook('onSend',async(req,reply,payload)=>{
    if(!String(reply.getHeader('content-type')||'').includes('application/json')||reply.getHeader('content-encoding'))return payload;
    reply.header('Vary','Accept-Encoding');
    const enc=String(req.headers['accept-encoding']||'').split(',').map(s=>s.trim().split(';'));
    const allowed=enc.find(e=>e[0]==='gzip')||enc.find(e=>e[0]==='*');
    if(!allowed||allowed.slice(1).some(s=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(s)))return payload;
    if(typeof payload!=='string'&&!Buffer.isBuffer(payload))return payload;
    if(Buffer.byteLength(payload)<1024)return payload;
    const bytes=await compress(payload,{level:6});reply.header('Content-Encoding','gzip').removeHeader('Content-Length');return bytes;
  });
  app.register(multipart,{limits:{fileSize:100*1024*1024,files:20,fields:20}});
  let activeWrites=0,restoring=false;
  app.addHook('onRoute',route=>{const handler=route.handler;route.handler=function(req,reply){return store.asUser(req.user,()=>handler.call(this,req,reply));};});
  // Hold the gate through awaited AI calls and multipart uploads, including failures.
  app.addHook('onRoute',route=>{
    if(!['POST','PUT','PATCH','DELETE'].some(m=>[route.method].flat().includes(m as any)))return;
    const handler=route.handler;
    route.handler=async function(req,reply){
      const restore=route.url==='/api/restore';
      if(restoring)throw fail('正在恢复备份，请稍后重试',409);
      if(restore){if(activeWrites||importer.active.size||solutions.busy)throw fail('请等待正在进行的保存、AI 请求或导入完成后再恢复',409);restoring=true;}
      else activeWrites++;
      try{return await handler.call(this,req,reply);}
      finally{if(restore)restoring=false;else activeWrites--;}
    };
  });
  app.addHook('onRequest',async(req,reply)=>{
    const host=req.headers.host||'';
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)&&host!==publicHost)return reply.code(403).send({error:'访问地址未授权'});
    if(req.headers.origin&&req.headers.origin!==`http://${host}`&&req.headers.origin!==`https://${host}`)return reply.code(403).send({error:'不允许跨站请求'});
    if(req.headers['sec-fetch-site']==='cross-site'&&!['GET','HEAD'].includes(req.method))return reply.code(403).send({error:'不允许跨站请求'});
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('Referrer-Policy','same-origin').header('X-Frame-Options','DENY');
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if(host===publicHost)reply.header('Strict-Transport-Security','max-age=31536000');
    if(req.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
    if(!auth)return;
    req.user=auth.user(req);
    const path=req.url.split('?')[0];
    if(path.startsWith('/api/')&&!['/api/health','/api/auth/status','/api/auth/setup','/api/auth/login','/api/auth/register','/api/auth/guest'].includes(path)&&!req.user)return reply.code(401).send({error:'请先登录'});
    if(req.user?.guest&&!['GET','HEAD'].includes(req.method)&&path!=='/api/auth/logout')return reply.code(403).send({error:'游客仅在当前设备体验，AI、上传与服务器保存需先注册账号'});
    if(req.user?.role==='student'){
      const admin=/^\/api\/(settings|backup|restore|demo)(\/|$)/.test(path)&&!(req.method==='GET'&&path==='/api/folders');
      if(admin)return reply.code(403).send({error:'只有管理员可以管理共享题库和站点设置'});
    }
  });
  app.setErrorHandler((e,req,reply)=>{const err=e as Error&{statusCode?:number};reply.code(err instanceof z.ZodError?400:err.statusCode||400).send({error:err instanceof z.ZodError?'输入内容不完整或格式不正确':err.message});});
  const get=<T,>(kind:string,key:string):T=>{const v=store.get<T>(kind,key);if(!v)throw fail('记录不存在',404);return v;};
  const activeFolder=(key:string|null)=>{if(key&&get<Folder>('folders',key).deleted)throw fail('目标文件夹已在回收站');};
  const images=(ids:string[])=>{for(const key of ids){if(!get<Attachment>('attachments',key).mime.startsWith('image/'))throw fail('作答附件必须是图片');}};
  const validateSources=(q:z.infer<typeof questionInput>)=>{for(const s of q.sources){get('attachments',s.attachmentId);if(s.imageId)images([s.imageId]);}};
  const newQuestion=(data:z.infer<typeof questionInput>,key:string=id()):Question=>withKnowledge({...data,id:key,createdAt:now(),updatedAt:now(),deleted:false,wrong:false,mastered:false});
  const stats=():Stats=>{
    const qs=store.all<Question>('questions').filter(q=>!q.deleted),ats=store.all<Attempt>('attempts'),rewards=store.all<Reward>('rewards');
    const claimed=rewards.map(r=>r.id),points=rewards.reduce((n,r)=>n+r.points,0),correct=ats.filter(a=>a.correct===true);
    const days=new Map<string,number>();for(const a of ats){const d=new Date(a.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});days.set(d,(days.get(d)||0)+1);}
    return {questions:qs.length,attempts:ats.length,correct:correct.length,correctQuestions:new Set(correct.map(a=>a.questionId)).size,wrong:qs.filter(q=>q.wrong&&!q.mastered).length,points,level:Math.floor(points/100)+1,eligible:qs.filter(q=>!claimed.includes(q.id)&&correct.some(a=>a.questionId===q.id)),claimed,mastered:qs.filter(q=>q.mastered).length,activeDays:days.size,recent:[...days.entries()].sort().slice(-14).map(([date,count])=>({date,count}))};
  };
  auth?.register(app);
  aiAccess.register(app,auth);
  personalAISettings(app,store);
  solutions.register(app);
  snapshots?.register(app);
  personalRoutes(app,store);
  announcementRoutes(app,store);
  knowledgeRoutes(app,store);
  shopRoutes(app,store);
  leaderboardRoutes(app,store,auth);
  feedbackRoutes(app,store,auth);
  app.get('/api/documents',()=>store.all('documents'));
  app.get('/api/health',req=>({ok:true,...(!auth||req.user?.role==='admin'?{dataDir:store.root,office:!!officePath(),node:process.version}:{})}));
  // Lists need question metadata; load the saved solution only for the opened
  // question so a large solved bank does not slow every login and refresh.
  app.get('/api/bootstrap',req=>({folders:store.all('folders'),questions:store.all<Question>('questions').map(q=>({...q,explanation:'',hasExplanation:!!q.explanation})),jobs:store.all('jobs'),attempts:store.all<Attempt>('attempts').reverse(),stats:stats()}));
  app.post('/api/folders',async(req)=>{const v=z.object({name:z.string().trim().min(1).max(80),parentId:z.string().nullable().default(null)}).parse(req.body);activeFolder(v.parentId);if(req.user?.role==='student'&&v.parentId&&!get<Folder>('folders',v.parentId).ownerId)throw fail('个人文件夹不能建在共享文件夹内',403);return store.put('folders',{...v,id:id(),deleted:false,...(req.user?.role==='student'?{ownerId:req.user.id}:{})});});
  app.patch('/api/folders/:id',async(req:any)=>{
    const f=get<Folder>('folders',req.params.id);if(req.user?.role==='student'&&f.ownerId!==req.user.id)throw fail('只有管理员可管理共享文件夹',403);const v=z.object({name:z.string().trim().min(1).max(80).optional(),parentId:z.string().nullable().optional(),deleted:z.boolean().optional()}).parse(req.body);
    if(v.parentId!==undefined){activeFolder(v.parentId);if(req.user?.role==='student'&&v.parentId&&!get<Folder>('folders',v.parentId).ownerId)throw fail('请选择个人文件夹',403);let parent=v.parentId;while(parent){if(parent===f.id)throw fail('不能把文件夹移动到自身或其子文件夹');parent=get<Folder>('folders',parent).parentId;}}
    return store.transaction(()=>{
      if(v.deleted===true){const tree=new Set([f.id]);let changed=true;const fs=store.all<Folder>('folders');while(changed){changed=false;for(const item of fs)if(item.parentId&&tree.has(item.parentId)&&!tree.has(item.id)){tree.add(item.id);changed=true;}}
        const batch=id();for(const item of fs)if(tree.has(item.id)&&!item.deleted)store.put('folders',{...item,deleted:true,deletedBatch:batch});
        for(const q of store.all<Question>('questions'))if(q.folderId&&tree.has(q.folderId)&&!q.deleted)store.put('questions',{...q,deleted:true,deletedBatch:batch});
        return get<Folder>('folders',f.id);
      }
      if(v.deleted===false){const batch=f.deletedBatch;const parent=f.parentId?store.get<Folder>('folders',f.parentId):undefined;if(parent?.deleted)f.parentId=null;
        if(batch){for(const item of store.all<Folder>('folders'))if(item.deletedBatch===batch)store.put('folders',{...item,parentId:item.id===f.id?f.parentId:item.parentId,deleted:false,deletedBatch:undefined});for(const q of store.all<Question&{deletedBatch?:string}>('questions'))if(q.deletedBatch===batch)store.put('questions',{...q,deleted:false,deletedBatch:undefined});}
      }
      return store.put('folders',{...f,...v,deletedBatch:v.deleted===false?undefined:f.deletedBatch});
    });
  });
  app.post('/api/questions',async(req)=>{const v=questionInput.parse(req.body);activeFolder(v.folderId);validateSources(v);if(req.user?.role==='student'&&v.folderId&&!get<Folder>('folders',v.folderId).ownerId)throw fail('请选择个人文件夹',403);const q=store.put('questions',{...newQuestion(v),...(req.user?.role==='student'?{ownerId:req.user.id}:{})});return q;});
  app.patch('/api/questions/:id',async(req:any)=>{
    if(req.user?.role==='student'&&get<Question>('questions',req.params.id).ownerId!==req.user.id&&Object.keys(req.body||{}).some(k=>!['wrong','mastered'].includes(k)))throw fail('只有管理员可以修改共享题目',403);
    const q=get<Question>('questions',req.params.id);
    const parsed=questionInput.partial().extend({deleted:z.boolean().optional(),wrong:z.boolean().optional(),mastered:z.boolean().optional()}).parse(req.body);
    // Optional fields with defaults are populated by Zod; PATCH may change only supplied keys.
    const v=Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.hasOwn(req.body,key))) as typeof parsed;
    if(v.folderId!==undefined){activeFolder(v.folderId);if(req.user?.role==='student'&&v.folderId&&!get<Folder>('folders',v.folderId).ownerId)throw fail('请选择个人文件夹',403);}
    const contentChanged=['title','stem','type','options','subquestions','sources','answer'].some(key=>Object.hasOwn(v,key)&&JSON.stringify((v as any)[key])!==JSON.stringify((q as any)[key]));
    const result=withKnowledge({...q,...v,...(v.explanation!==undefined&&v.explanation!==q.explanation?{explanationOrigin:'人工' as const}:{}),...(contentChanged&&!Object.hasOwn(v,'solutionVersion')?{solutionVersion:undefined,solutionCompletedAt:undefined}:{}),updatedAt:now()});if(v.deleted===false&&result.folderId&&get<Folder>('folders',result.folderId).deleted)result.folderId=null;validateSources(result);
    return store.put('questions',result);
  });
  app.get('/api/questions/:id',async(req:any)=>({question:get<Question>('questions',req.params.id),draft:store.get<Draft>('drafts',req.params.id)||{answer:'',images:[]},attempts:store.all<Attempt>('attempts').filter(a=>a.questionId===req.params.id).reverse(),explanations:aiResults.savedExplanations(get<Question>('questions',req.params.id)),solutionTask:solutions.state(req.params.id),claimed:!!store.get('rewards',req.params.id)}));
  const saveDraft=async(req:any)=>{
    get('questions',req.params.id);const v=draftInput.parse(req.body);images(v.images);
    const old=store.get<Draft>('drafts',req.params.id),revision=v.revision??((old?.revision??0)+1);
    if(old&&revision<(old.revision??0))return old;
    if(old&&revision===(old.revision??0)){
      if(v.answer===old.answer&&JSON.stringify(v.images)===JSON.stringify(old.images))return old;
      throw fail('草稿已在其他页面更新，请重新打开题目后再编辑',409);
    }
    return store.put('drafts',{...v,revision,id:req.params.id,updatedAt:now()});
  };
  app.put('/api/questions/:id/draft',saveDraft);
  app.post('/api/questions/:id/draft',saveDraft);
  app.post('/api/questions/:id/attempts',async(req:any)=>{
    const q=get<Question>('questions',req.params.id);if(q.deleted)throw fail('请先还原题目');const v=attemptInput.parse(req.body);images(v.images);if(!v.answer.trim()&&!v.images.length)throw fail('请先填写答案或上传作答照片');
    const correct=judge(q,v.answer);const a:Attempt={...v,id:id(),questionId:q.id,correct,judgement:'自动',feedback:correct===null?'待确认判分，可使用 AI 辅助批改或自行判分。':correct?'答案正确。':'答案与已确认的参考答案不一致。',createdAt:now()};
    return store.transaction(()=>{if(correct===false)store.put('questions',{...q,wrong:true,mastered:false});return store.put('attempts',a);});
  });
  app.patch('/api/attempts/:id',async(req:any)=>{
    const a=get<Attempt>('attempts',req.params.id);const v=z.object({correct:z.boolean(),reviewId:z.string().uuid().optional()}).parse(req.body);const q=get<Question>('questions',a.questionId);
    if(v.reviewId&&(!a.aiReview||a.aiReview.id!==v.reviewId||a.aiReview.suggestedCorrect!==v.correct))throw fail('AI 建议已更新或无法判分，请刷新后确认',409);
    return store.transaction(()=>{if(!v.correct)store.put('questions',{...q,wrong:true,mastered:false});const updated=store.put<Attempt>('attempts',{...a,correct:v.correct,judgement:'人工',feedback:v.reviewId?(v.correct?'已采纳 AI 建议并确认答对。':'已采纳 AI 建议并确认需复习。'):(v.correct?'已人工确认答对。':'已人工确认需复习。'),...(a.aiReview?{aiReview:{...a.aiReview,decision:v.reviewId?'adopted':'overridden',confirmedAt:now()}}:{})});if(!store.all<Attempt>('attempts').some(x=>x.questionId===q.id&&x.correct===true))store.remove('rewards',q.id);return updated;});
  });
  app.post('/api/attempts/:id/grade',async(req:any)=>{
    const a=get<Attempt>('attempts',req.params.id),q=get<Question>('questions',a.questionId);
    const {force}=z.object({force:z.boolean().default(false)}).parse(req.body||{});
    const review=await aiResults.grade(q,a.answer,a.images,[],force),current=get<Attempt>('attempts',a.id);
    if(current.aiReview?.id===review.id)return current.aiReview;
    store.put('attempts',{...current,aiReview:review});return review;
  });
  app.post('/api/questions/:id/explanations',async(req:any)=>{
    const q=get<Question>('questions',req.params.id),{force}=z.object({force:z.boolean().default(false)}).parse(req.body||{});
    return aiResults.explain(q,force);
  });
  app.post('/api/questions/:id/reward',async(req:any)=>store.transaction(()=>{const q=get<Question>('questions',req.params.id);if(q.deleted)throw fail('题目已在回收站');if(!store.all<Attempt>('attempts').some(a=>a.questionId===q.id&&a.correct===true))throw fail('需要先确认本题作答正确');const old=store.get<Reward>('rewards',q.id);if(old)return {...old,alreadyClaimed:true,coins:readWallet(store).coins,coinsEarned:0};const wallet=creditReward(store,q.id);return {...store.put('rewards',{id:q.id,points:10,createdAt:now()}),alreadyClaimed:false,coins:wallet.coins,coinsEarned:10};}));
  app.post('/api/attachments',async(req)=>{const file=await req.file();if(!file)throw fail('请选择文件');const ext=extname(file.filename).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))throw fail('作答照片支持 JPG、PNG、WebP');const b=await file.toBuffer();if(b.length>15*1024*1024)throw fail('单张图片最多 15 MB');let compressed:Buffer,resized=false;try{const image=await loadImage(b);if(image.width*image.height>60000000)throw new Error();const scale=Math.min(1,2400/Math.max(image.width,image.height)),canvas=createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale))),ctx=canvas.getContext('2d');resized=scale<1;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);compressed=canvas.toBuffer('image/jpeg',85);}catch{throw fail('图片无法读取或尺寸过大，请重新选择');}const keepOriginal=!resized&&compressed.length>=b.length&&ext!=='.webp';const bytes=keepOriginal?b:compressed,mime=keepOriginal?mimeFor(file.filename):'image/jpeg',name=keepOriginal?file.filename:file.filename.replace(/\.[^.]+$/,'.jpg');const hash=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),existing=store.all<Attachment>('attachments').find(a=>a.ownerId===req.user?.id&&a.hash===hash);if(existing)return existing;return store.attach(bytes,name,mime);});
  app.get('/api/attachments/:id',async(req:any,reply)=>{const a=get<Attachment>('attachments',req.params.id),etag='"'+a.hash+'"';reply.header('Cache-Control','private, no-cache').header('ETag',etag);if(req.headers['if-none-match']===etag)return reply.code(304).send();reply.type(a.mime).header('Content-Disposition',`${a.mime.startsWith('image/')||a.mime==='application/pdf'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);return reply.send(store.bytes(a.id));});
  app.post('/api/imports',async(req:any)=>{
    const folderId=typeof req.query.folderId==='string'&&req.query.folderId?req.query.folderId:null;activeFolder(folderId);if(req.user?.role==='student'&&folderId&&!get<Folder>('folders',folderId).ownerId)throw fail('请保存到个人文件夹，或选择未分类',403);if(importer.active.size>=3)throw fail('导入任务较多，请稍后重试',429);if(req.user?.role==='student'&&store.all<ImportJob>('jobs').some(j=>importer.active.has(j.id)))throw fail('请先等待当前个人导入完成',429);
    const files:Attachment[]=[];const duplicates:string[]=[];const known=new Set(store.all<Attachment>('attachments').map(a=>a.hash));
    for await(const part of req.parts()){if(part.type!=='file')continue;if(!allowedExtensions.includes(extname(part.filename).toLowerCase()))throw fail(`不支持 ${part.filename}，请使用 PDF、Word、TXT 或图片`);const b=await part.toBuffer();if(b.length>50*1024*1024)throw fail('单个导入文件最多 50 MB');const a=store.attach(b,part.filename,mimeFor(part.filename),req.user?.role!=='student');if(known.has(a.hash))duplicates.push(a.name);known.add(a.hash);files.push(a);}
    if(!files.length)throw fail('请选择至少一个文件');
    const j:ImportJob={...(req.user?.role==='student'?{ownerId:req.user.id}:{}),id:id(),name:files.map(a=>a.name).join('、'),folderId,attachmentIds:files.map(a=>a.id),status:'preparing',tasks:[],drafts:[],errors:[],duplicates,createdAt:now()};store.put('jobs',j);void importer.run(j.id);return j;
  });
  app.get('/api/imports/:id/solutions',(req:any)=>{if(req.user?.role!=='admin')throw fail('仅管理员可查看整份资料解析进度',403);const j=get<ImportJob>('jobs',req.params.id);return solutions.progress(j.committedIds||[]);});
  app.get('/api/imports/:id',async(req:any)=>get<ImportJob>('jobs',req.params.id));
  app.post('/api/imports/:id/cancel',async(req:any)=>{get('jobs',req.params.id);importer.cancel(req.params.id);return {ok:true};});
  app.post('/api/imports/:id/retry',async(req:any)=>{const j=get<ImportJob>('jobs',req.params.id);if(j.status==='committed')throw fail('已入库任务不能重试');void importer.run(j.id);return {ok:true};});
  app.put('/api/imports/:id/drafts',async(req:any)=>{const j=get<ImportJob>('jobs',req.params.id);if(importer.active.has(j.id)||j.status==='committed')throw fail('请等识别完成或取消后再校对');const drafts=z.array(questionInput.extend({id:z.string().uuid()})).max(1000).parse(req.body);drafts.forEach(validateSources);if(new Set(drafts.map(d=>d.id)).size!==drafts.length)throw fail('草稿标识重复');return store.put('jobs',{...j,drafts});});
  app.post('/api/imports/:id/commit',async(req:any)=>store.transaction(()=>{const j=get<ImportJob>('jobs',req.params.id);if(j.status==='committed')return {ids:j.committedIds};if(importer.active.has(j.id))throw fail('请先等待识别结束或取消');if(!j.drafts.length)throw fail('没有待入库题目');const ids:string[]=[];for(const d of j.drafts){const data=questionInput.parse(d);activeFolder(data.folderId);validateSources(data);if(req.user?.role==='student'&&data.folderId&&!get<Folder>('folders',data.folderId).ownerId)throw fail('请选择个人文件夹',403);store.put('questions',{...newQuestion(data,d.id),...(j.ownerId?{ownerId:j.ownerId}:{})});ids.push(d.id);}store.put('jobs',{...j,status:'committed',committedIds:ids});if(req.user?.role==='admin')solutions.enqueue(ids,req.user,true);return {ids};}));
  app.get('/api/settings',()=>store.publicConfig());
  app.put('/api/settings',async(req)=>{
    const endpoint=z.string().refine(v=>{try{return ['http:','https:'].includes(new URL(v).protocol)&&!new URL(v).username&&!new URL(v).password;}catch{return false;}},'接口地址无效');
    const c=z.object({baseUrl:endpoint,visionBaseUrl:z.union([endpoint,z.literal('')]),model:z.string().max(200),visionModel:z.string().max(200),key:z.string().max(2000).optional(),visionKey:z.string().max(2000).optional(),clearKeys:z.boolean().optional()}).parse(req.body);
    const {clearKeys,...values}=c;if(!values.key)delete values.key;if(!values.visionKey)delete values.visionKey;if(clearKeys){values.key='';values.visionKey='';}return store.saveConfig(values);
  });
  app.post('/api/settings/test',async(req)=>{const {vision}=z.object({vision:z.boolean().default(false)}).parse(req.body||{});let imgs:string[]=[];if(vision){const canvas=createCanvas(64,64);const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,64,64);imgs=[store.attach(canvas.toBuffer('image/png'),'模型能力测试.png','image/png').id];}try{const answer=await chat(store,'按要求简短回答。',vision?'图片里的色块是什么颜色？仅回答中文颜色。':'请只回复“连接成功”。',imgs,undefined,vision);if(vision&&!answer.includes('红'))throw fail('连接成功，但图片识别测试未通过，请确认模型支持图片');return {ok:true,message:vision?'图片识别测试通过':'文字连接测试通过'};}finally{for(const aid of imgs){store.remove('attachments',aid);const {unlinkSync}=await import('node:fs');unlinkSync(store.file(aid));}}});
  app.get('/api/backup',async(_,reply)=>{if(importer.active.size||activeWrites||restoring||solutions.busy)throw fail('请等待保存、AI 请求或导入完成后再备份',409);reply.header('Content-Disposition','attachment; filename="study-backup.zip"').type('application/zip');return reply.send(Buffer.from(makeBackup(store)));});
  app.post('/api/restore',async(req)=>{const f=await req.file({limits:{fileSize:BACKUP_UPLOAD_LIMIT,files:1}});if(!f)throw fail('请选择备份 ZIP');return restoreBackup(store,await f.toBuffer());});
  app.post('/api/demo',()=>{
    if(store.all<Folder>('folders').some(f=>f.id==='demo-math'))return {ok:true};
    store.transaction(()=>{
      store.put('folders',{id:'demo-math',name:'示例 · 考研数学',parentId:null,deleted:false});
      const samples=[
        {title:'定积分与对称性',subject:'高等数学',type:'计算',stem:'计算定积分：\n\n$$I=\\int_0^1 \\frac{x}{1+x^2}\\,dx$$',answer:'$\\frac12\\ln 2$',explanation:'令 $u=1+x^2$，则 $du=2x\\,dx$。上下限为 $1,2$，因此 $I=\\frac12\\int_1^2 u^{-1}du=\\frac12\\ln2$。'},
        {title:'矩阵的特征值',subject:'线性代数',type:'单选',stem:'矩阵 $A$ 的特征值为：\n\n$$A=\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}$$',options:['A. 1，3','B. 2，2','C. −1，3','D. 0，4'],answer:'A',explanation:'特征多项式为 $(2-\\lambda)^2-1=(\\lambda-1)(\\lambda-3)$。'},
        {title:'分段函数的连续性',subject:'高等数学',type:'计算',stem:'已知\n\n$$f(x)=\\begin{cases}\\frac{\\sin x}{x},&x\\ne0\\\\a,&x=0\\end{cases}$$\n\n确定使 $f$ 在 $x=0$ 连续的常数 $a$。',answer:'$a=1$',subquestions:['求 $\\lim_{x\\to0}f(x)$。','说明连续所需的条件。']},
        {title:'独立事件与条件概率',subject:'概率论',type:'判断',stem:'若事件 $A$、$B$ 相互独立且 $P(B)>0$，则 $P(A\\mid B)=P(A)$。',answer:'正确',explanation:'由独立性和条件概率定义，$P(A\\mid B)=P(AB)/P(B)=P(A)$。'},
        {title:'柯西不等式的证明',subject:'线性代数',type:'证明',stem:'对于任意 $u,v\\in\\mathbb{R}^n$，证明\n\n$$|u^Tv|\\leq\\|u\\|\\,\\|v\\|$$\n\n并说明等号成立的条件。',answer:'当且仅当两个向量线性相关时取等号。'},
      ];
      for(const s of samples)store.put('questions',newQuestion(questionInput.parse({...s,folderId:'demo-math',answerOrigin:s.answer?'人工':'无',answerConfirmed:true})));
    });return {ok:true};
  });
  app.addHook('onClose',async()=>{await solutions.close();for(const c of importer.active.values())c.abort();while(importer.active.size)await new Promise(r=>setTimeout(r,10));store.onChange=undefined;await snapshots?.close();auth?.close();store.close();});
  return {app,store,importer,auth,snapshots};
}
