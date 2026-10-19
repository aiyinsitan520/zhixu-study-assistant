import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Store,decodeRecord,id,now} from './store.ts';
import type {Auth,User} from './auth.ts';
import type {Question,Explanation,Attachment} from '../shared/schema.ts';
import {gradingOutput} from '../shared/schema.ts';
import {chat,parseAI,effectiveAIConfig} from './ai.ts';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const structured=z.object({answer:z.string().trim().min(1).max(30000),explanation:z.string().trim().min(1).max(100000)});
export const solutionVersion='detailed-v1';
const solutionPrompt='你是认真负责的大学数学助教。忠实根据指定题干和原图解题，给出答案与详细步骤。图片可能包含其他题，只解指定题号，不得串题。每个小题都要完整回答，不能只写最终结论或“同理可得”。explanation 使用中文 Markdown，包含：题意核对、知识点与公式、分步推导（逐步说明依据）、各小题最终答案、易错点与验算。answer 简明列出所有小题结论。数学用 $ 或 $$ 包裹 LaTeX，JSON 中反斜杠必须正确转义。若原图看不清或条件缺失，准确说明缺少什么、哪些小题无法确定，不能编造条件或假装已解决。';
type Review={id:string;suggestedCorrect:boolean|null;feedback:string;createdAt:string;model:string;decision:'pending';fingerprint?:string};
export type AIArchive={id:string;questionId:string;mode:'explain'|'grade';fingerprint:string;result:Explanation|Review;createdAt:string;answer?:string;images?:string[]};
export class AIResults {
 private pending=new Map<string,Promise<any>>();
 constructor(private store:Store){store.db.exec(`CREATE VIEW IF NOT EXISTS v_library_catalog AS SELECT kind,id,json_extract(data,'$.ownerId') AS owner_id,json_extract(data,'$.folderId') AS folder_id,COALESCE(json_extract(data,'$.title'),json_extract(data,'$.name')) AS title,json_extract(data,'$.deleted') AS deleted FROM records WHERE kind IN ('questions','folders','documents','jobs');
 CREATE VIEW IF NOT EXISTS v_attachment_catalog AS SELECT id,json_extract(data,'$.ownerId') AS owner_id,json_extract(data,'$.name') AS name,json_extract(data,'$.mime') AS mime,json_extract(data,'$.size') AS bytes,json_extract(data,'$.hash') AS sha256 FROM records WHERE kind='attachments';
 CREATE VIEW IF NOT EXISTS v_ai_result_catalog AS SELECT kind AS scope,id,json_extract(data,'$.questionId') AS question_id,json_extract(data,'$.mode') AS mode,json_extract(data,'$.fingerprint') AS fingerprint,json_extract(data,'$.result.model') AS model,json_extract(data,'$.createdAt') AS created_at FROM records WHERE kind='aiResults' OR kind GLOB 'user-*:aiResults';`);}
 signature(q:Question){return digest({id:q.id,stem:q.stem,type:q.type,options:q.options,subquestions:q.subquestions,answer:q.answer,source:q.sources.map(s=>({page:s.page,hash:this.store.get<Attachment>('attachments',s.imageId||s.attachmentId)?.hash}))});}
 private key(mode:string,fingerprint:string){return digest({mode,fingerprint});}
 private cached<T>(mode:string,fingerprint:string):T|undefined{return this.store.get<AIArchive>('aiResults',this.key(mode,fingerprint))?.result as T|undefined;}
 private save(mode:AIArchive['mode'],fingerprint:string,q:Question,result:Explanation|Review,extra:Partial<AIArchive>={}){const key=this.key(mode,fingerprint);const previous=this.store.get<AIArchive>('aiResults',key);if(previous&&previous.result.id!==result.id)this.store.put('aiResults',{...previous,id:'history-'+previous.result.id});this.store.put('aiResults',{...extra,id:key,questionId:q.id,mode,fingerprint,result,createdAt:now()});return result;}
 private once<T>(key:string,work:()=>Promise<T>,global=false):Promise<T>{const scope=global?'global':this.store.context.getStore()?.id||'shared',k=scope+':'+key;const old=this.pending.get(k);if(old)return old;const promise=work().finally(()=>this.pending.delete(k));this.pending.set(k,promise);return promise;}
 private model(images:boolean){const c=effectiveAIConfig(this.store);return images?c.visionModel:c.model;}
 private gradeFingerprint(q:Question,answer:string,images:string[]=[],inlineImages:string[]=[]){return digest({question:this.signature(q),answer,images:[...images.map(id=>this.store.get<Attachment>('attachments',id)?.hash||id),...inlineImages.map(url=>createHash('sha256').update(Buffer.from(url.split(',')[1],'base64')).digest('hex'))]});}
 sharedValue(q:Question):Explanation|undefined{return q.explanation?{id:'shared-'+q.id,questionId:q.id,content:q.explanation,model:q.explanationOrigin==='AI'?'共享 AI 解析':'共享题库',createdAt:q.updatedAt}:undefined;}
 savedExplanations(q:Question):Explanation[]{
  // Archives belong to the current account; reading a question never starts AI.
  const history=this.store.all<Explanation>('explanations').filter(e=>e.questionId===q.id);
  const archived=this.store.all<AIArchive>('aiResults').filter(a=>a.mode==='explain'&&a.questionId===q.id).map(a=>a.result as Explanation);
  return [...new Map([...archived,...history].map(e=>[e.id,e])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 archiveImportedExplanation(q:Question,ex:Explanation){
  // Older device results remain historical when the question has since changed.
  const fingerprint=ex.fingerprint||(ex.createdAt>=q.updatedAt?this.signature(q):digest({legacy:ex.id}));
  if(!this.cached('explain',fingerprint))this.save('explain',fingerprint,q,{...ex,fingerprint});
 }
 async explain(q:Question,force=false):Promise<Explanation>{
  if(!force){const shared=this.sharedValue(q);if(shared)return shared;}
  if(!q.ownerId&&this.store.context.getStore()?.role==='admin')return this.shared(q,undefined,force);
  const fingerprint=this.signature(q),key=this.key('explain',fingerprint);
  if(!force){const cached=this.cached<Explanation>('explain',fingerprint);if(cached)return cached;const old=this.store.all<Explanation>('explanations').filter(e=>e.questionId===q.id&&e.fingerprint===fingerprint).at(-1);if(old){this.save('explain',fingerprint,q,old);return old;}}
  return this.once(key,async()=>{const imgs=q.sources.flatMap(s=>s.imageId?[s.imageId]:[]),content=await chat(this.store,'你是大学数学与理工课程辅导老师。用中文 Markdown 分为：知识点、解题步骤、结论、易错点。公式用 $ 或 $$。明确不确定之处；如果题目信息不全请请求补充，不要编造图形条件。',JSON.stringify({题干:q.stem,小题:q.subquestions,选项:q.options,参考答案:q.answer,来源:q.answerOrigin}),imgs);const result:Explanation={id:id(),questionId:q.id,content,createdAt:now(),model:this.model(!!imgs.length),fingerprint};this.save('explain',fingerprint,q,result);this.store.put('explanations',result);return result;});
 }
 async shared(q:Question,signal?:AbortSignal,force=false):Promise<Explanation>{
  if(!force&&q.answer){const existing=this.sharedValue(q);if(existing)return existing;}
  const fingerprint=this.signature(q),key=this.key('explain',fingerprint);
  return this.once(key,async()=>{const imgs=[...new Set(q.sources.flatMap(s=>s.imageId?[s.imageId]:[]))],result=parseAI(await chat(this.store,solutionPrompt+'只返回 JSON {"answer":"所有小题答案","explanation":"中文Markdown详细解析"}。',JSON.stringify({title:q.title,stem:q.stem,options:q.options,subquestions:q.subquestions,originalAnswer:q.answer}),imgs,signal),structured);return this.persistShared(q,result,fingerprint,force);},true);
 }
 private persistShared(q:Question,result:z.infer<typeof structured>,fingerprint:string,force:boolean){
  const current=this.store.get<Question>('questions',q.id),model=this.model(q.sources.some(s=>!!s.imageId));
  if(q.explanation&&q.explanationOrigin!=='AI')this.store.context.exit(()=>{const signature=digest({original:q.id,content:q.explanation});if(!this.cached('explain',signature))this.save('explain',signature,q,{id:'source-'+q.id,questionId:q.id,content:q.explanation,model:'原文 / 原有解析',createdAt:q.createdAt,fingerprint:signature});});
  const explanation:Explanation={id:id(),questionId:q.id,content:result.explanation,model,createdAt:now(),fingerprint};
  this.store.context.exit(()=>this.save('explain',fingerprint,q,explanation));
  if(!current||current.deleted||current.ownerId||this.signature(current)!==fingerprint||current.explanation!==q.explanation)throw Object.assign(new Error('生成期间题目被修改，AI结果已归档，未覆盖人工内容'),{statusCode:409});
  const keepAnswer=!!current.answer&&(!force||current.answerOrigin!=='AI'||current.answerConfirmed);
  this.store.context.exit(()=>this.store.put('questions',{...current,answer:keepAnswer?current.answer:result.answer,explanation:!force&&current.explanation?current.explanation:result.explanation,explanationOrigin:!force&&current.explanation?current.explanationOrigin:'AI',answerOrigin:keepAnswer?current.answerOrigin:'AI',answerConfirmed:keepAnswer?current.answerConfirmed:false,solutionVersion,solutionModel:model,solutionCompletedAt:now(),updatedAt:now()}));
  return explanation;
 }
 async sharedMany(qs:Question[],signal?:AbortSignal,force=false):Promise<PromiseSettledResult<Explanation>[]> {
  if(qs.length===1)return Promise.allSettled([this.shared(qs[0],signal,force)]);
  // At most four images/questions per call, with explicit image-to-ID mapping.
  // still keyed and persisted independently; interactive calls join the same job.
  let request:Promise<Map<string,z.infer<typeof structured>>>|undefined;
  const generate=()=>request??=(async()=>{
   const imgs=[...new Set(qs.flatMap(q=>q.sources.flatMap(s=>s.imageId?[s.imageId]:[])))];
   const schema=z.object({solutions:z.array(structured.extend({id:z.string()})).length(qs.length)}).refine(v=>new Set(v.solutions.map(s=>s.id)).size===qs.length&&v.solutions.every(s=>qs.some(q=>q.id===s.id)));
   const output=parseAI(await chat(this.store,solutionPrompt+'输入中 imageNumbers 是该题对应的图片序号（从1开始，按图片发送顺序），每个 id 只能使用自己对应的原图，禁止混用其他题图。只返回 JSON {"solutions":[{"id":"输入中的id，原样保留","answer":"所有小题答案","explanation":"中文Markdown详细解析"}]}。必须覆盖每个指定 id，不要合并或遗漏，不能使用省略号代替推导。',JSON.stringify({questions:qs.map(q=>({id:q.id,title:q.title,stem:q.stem,imageNumbers:q.sources.filter(s=>s.imageId).map(s=>imgs.indexOf(s.imageId!)+1),subquestions:q.subquestions,options:q.options,originalAnswer:q.answer}))}),imgs,signal),schema);
   return new Map(output.solutions.map(s=>[s.id,s]));
  })();
  return Promise.allSettled(qs.map(q=>{const fingerprint=this.signature(q);return this.once(this.key('explain',fingerprint),async()=>this.persistShared(q,(await generate()).get(q.id)!,fingerprint,force),true).catch(e=>{if(signal?.aborted||(e as any).statusCode===409)throw e;return this.shared(q,signal,force);});}));
 }
 async grade(q:Question,answer:string,images:string[]=[],inlineImages:string[]=[],force=false):Promise<Review>{
  const fingerprint=this.gradeFingerprint(q,answer,images,inlineImages),key=this.key('grade',fingerprint);
  if(!force){const cached=this.cached<Review>('grade',fingerprint);if(cached)return cached;}
  return this.once(key,async()=>{const source=q.sources.flatMap(s=>s.imageId?[s.imageId]:[]),result=parseAI(await chat(this.store,'逐步检查学生数学作答，参考答案也可能有误。不清楚返回correct=null。输出 JSON {"correct":true或false或null,"feedback":"中文Markdown评语与依据"}。由用户最终确认。',JSON.stringify({题干:q.stem,小题:q.subquestions,参考答案:q.answer,作答:answer,图片顺序:`前${source.length}张是原题，其余是学生作答`}),[...source,...images],undefined,false,inlineImages),gradingOutput),review:Review={id:id(),suggestedCorrect:result.correct,feedback:result.feedback,model:this.model(!!(source.length||images.length||inlineImages.length)),createdAt:now(),decision:'pending',fingerprint};const saved=[...images];for(const url of inlineImages){const [header,b64]=url.split(','),buffer=Buffer.from(b64,'base64'),hash=createHash('sha256').update(buffer).digest('hex'),old=this.store.all<Attachment>('attachments').find(a=>a.ownerId===this.store.context.getStore()?.id&&a.hash===hash);saved.push(old?.id||this.store.attach(buffer,'AI批改作答照片',header.slice(5).split(';')[0]).id);}this.save('grade',fingerprint,q,review,{answer,images:saved});return review;});
 }
 migrateReviews(auth?:Auth){return this.store.context.exit(()=>{
  let count=0;
  const rows=this.store.db.prepare("SELECT kind,data FROM records WHERE kind='attempts' OR kind GLOB 'user-*:attempts'").all();
  for(const row of rows){
   const a=decodeRecord(String(row.data));if(!a.aiReview)continue;
   const owner=String(row.kind).startsWith('user-')?String(row.kind).slice(5,-9):undefined;
   const user=owner?auth?.db.prepare('SELECT id,username,name,role FROM users WHERE id=?').get(owner) as User|undefined:undefined;
   if(owner&&!user)continue;
   this.store.asUser(user,()=>{const q=this.store.get<Question>('questions',a.questionId);if(!q)return;const fingerprint=a.aiReview.fingerprint||this.gradeFingerprint(q,a.answer,a.images);if(!this.cached('grade',fingerprint)){this.save('grade',fingerprint,q,{...a.aiReview,decision:'pending',confirmedAt:undefined,fingerprint},{answer:a.answer,images:a.images});count++;}});
  }
  return count;
 });}
 migrate(auth?:Auth){return this.store.context.exit(()=>{let shared=0,personal=0;const records=this.store.db.prepare("SELECT kind,data FROM records WHERE kind='explanations' OR kind GLOB 'user-*:explanations'").all();for(const row of records){const ex=decodeRecord(String(row.data)) as Explanation,q=this.store.get<Question>('questions',ex.questionId);if(!q||q.deleted)continue;const owner=String(row.kind).startsWith('user-')?String(row.kind).slice(5,-13):undefined;const user=owner?auth?.db.prepare('SELECT id,username,name,role FROM users WHERE id=?').get(owner) as User|undefined:undefined;const publish=!q.ownerId&&(!owner||user?.role==='admin');if(publish&&!q.explanation){this.store.put('questions',{...q,explanation:ex.content,explanationOrigin:'AI',updatedAt:now()});shared++;}if(owner&&!user)continue;this.store.asUser(publish?undefined:user,()=>{const fingerprint=ex.fingerprint||this.signature(q),key=this.key('explain',fingerprint);if(!ex.fingerprint)this.store.put('explanations',{...ex,fingerprint},true);if(!this.store.get('aiResults',key)){this.save('explain',fingerprint,q,{...ex,fingerprint});if(!publish)personal++;}});}for(const q of this.store.all<Question>('questions'))if(!q.deleted&&!q.ownerId&&q.explanation){const fingerprint=this.signature(q);if(!this.cached('explain',fingerprint))this.save('explain',fingerprint,q,this.sharedValue(q)!);}return {shared,personal};});}
}
