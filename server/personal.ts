import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {Store,PERSONAL_KINDS,id,now} from './store.ts';
import {schemas} from './backup.ts';
import {chat,parseAI,effectiveAIConfig} from './ai.ts';
import {gradingOutput} from '../shared/schema.ts';
import type {Question,Attachment} from '../shared/schema.ts';
export function personalRoutes(app:FastifyInstance,store:Store){
 app.get('/api/storage',()=>store.usage());
 app.get('/api/personal',()=>Object.fromEntries(PERSONAL_KINDS.map(k=>[k,store.all(k)])));
 app.post('/api/personal/sync',async(req)=>{
  const input=z.object({records:z.record(z.string(),z.array(z.any())).refine(v=>Object.keys(v).every(k=>PERSONAL_KINDS.includes(k)))}).parse(req.body);
  const records=Object.entries(input.records).flatMap(([kind,items])=>items.map(item=>({kind,value:schemas[kind].parse(item) as any})));
  // wallet/profile are account-level records and reference no question.
  const accountLevel=['wallet','profile'];
  for(const {kind,value:v} of records){if(!accountLevel.includes(kind)&&!store.get<Question>('questions',v.questionId||v.id))throw new Error('记录引用的题目不存在，请先确认题库来源');for(const img of v.images||[]){const a=store.get<Attachment>('attachments',img);if(!a||a.ownerId!==req.user?.id)throw new Error('记录包含无权访问的作答附件');}if(kind==='rewards'&&!records.some(r=>r.kind==='attempts'&&r.value.questionId===v.id&&r.value.correct===true)&&!store.all<any>('attempts').some(a=>a.questionId===v.id&&a.correct===true))throw new Error('奖励缺少已确认正确的作答');}
  // Merge by stable record IDs; never erase records already saved on another device.
  store.transaction(()=>{for(const {kind,value:v} of records){const old=store.get<any>(kind,v.id);if(old&&(old.updatedAt||old.createdAt||'')>(v.updatedAt||v.createdAt||''))continue;store.put(kind,v,true);}});
  return {ok:true,...store.usage()};
 });
 app.post('/api/personal/ai',{bodyLimit:35*1024*1024},async(req)=>{
  const v=z.object({questionId:z.string(),mode:z.enum(['grade','explain']),answer:z.string().max(100000).default(''),images:z.array(z.string().max(3*1024*1024).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)).max(10).default([])}).parse(req.body);
  const q=store.get<Question>('questions',v.questionId);if(!q)throw new Error('题目不存在');
  const imgs=q.sources.flatMap(s=>s.imageId?[s.imageId]:[]),c=effectiveAIConfig(store),model=imgs.length||v.images.length?c.visionModel:c.model;
  const text=JSON.stringify({题干:q.stem,小题:q.subquestions,选项:q.options,参考答案:q.answer,作答:v.answer,图片顺序:`前${imgs.length}张为原题，其余为作答`});
  if(v.mode==='grade'){const result=parseAI(await chat(store,'逐步检查学生数学作答，参考答案也可能有误。不清楚返回correct=null。输出JSON {"correct":true或false或null,"feedback":"中文Markdown评语与依据"}。由用户最终确认。',text,imgs,undefined,false,v.images),gradingOutput);return {id:id(),suggestedCorrect:result.correct,feedback:result.feedback,createdAt:now(),model,decision:'pending'};}
  const content=await chat(store,'用中文Markdown给出知识点、解题步骤、结论、易错点，公式用$或$$；信息不全不要猜测。',text,imgs,undefined,false,v.images);return {id:id(),questionId:q.id,content,createdAt:now(),model};
 });
}
