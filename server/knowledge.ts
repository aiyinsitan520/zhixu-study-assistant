import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {questionInput,type Question} from '../shared/schema.ts';
import {knowledgeChapters,withKnowledge} from '../shared/knowledge.ts';
import {Store,now} from './store.ts';
import {chat,parseAI} from './ai.ts';

const request=z.object({ids:z.array(z.string().min(1).max(150)).min(1).max(20)}).strict();
const result=z.object({questions:z.array(z.object({id:z.string(),knowledgePoints:questionInput.shape.knowledgePoints.unwrap()})).max(20)});
export function knowledgeRoutes(app:FastifyInstance,store:Store){
 app.post('/api/knowledge/classify',async req=>{
  if(req.user?.role!=='admin')throw Object.assign(new Error('只有管理员可以修改共享题目的知识点'),{statusCode:403});
  const ids=[...new Set(request.parse(req.body).ids)];
  const candidates=ids.map(id=>store.get<Question>('questions',id));
  if(candidates.some(q=>!q))throw Object.assign(new Error('部分题目不存在，请刷新后重试'),{statusCode:404});
  const eligible=candidates.filter((q):q is Question=>!!q&&!q.deleted&&q.materialKind!=='page'&&q.knowledgeSource!=='manual'&&!(q.knowledgePoints||[]).length);
  if(!eligible.length)return {classified:0,skipped:ids.length,unclassified:0};
  const taxonomy=knowledgeChapters.map(c=>({chapter:c.name,topics:c.topics.map(t=>({id:t.id,name:t.name}))}));
  const images:string[]=[];
  const inputs=eligible.map(q=>{const image=q.sources.find(s=>s.imageId)?.imageId;if(image)images.push(image);return {id:q.id,title:q.title,subject:q.subject,stem:q.stem.slice(0,14000),subquestions:q.subquestions,imageNumber:image?images.length:null};});
  const raw=await chat(store,'你是高等数学题库分类助手。只根据题干和原题图片判断实际考查的知识点，不解题。imageNumber为随后图片从1开始的编号，必须对应到该题id，不能把一题的知识点套到另一题。将题目映射到给定目录中的最相关知识点id，一题最多4个。不得编造id。非高等数学、信息不足或无法可靠确定时返回空数组。每个输入id恰好返回一次。只输出JSON：{"questions":[{"id":"输入id","knowledgePoints":["目录中的id"]}]}。',JSON.stringify({目录:taxonomy,题目:inputs}),images);
  const output=parseAI(raw,result).questions;
  const expected=new Set(eligible.map(q=>q.id));
  if(output.length!==expected.size||new Set(output.map(q=>q.id)).size!==expected.size||output.some(q=>!expected.has(q.id)))throw new Error('AI返回的题目标识不完整，尚未保存，请重试');
  return store.context.exit(()=>store.transaction(()=>{
   let classified=0,skipped=ids.length-eligible.length,unclassified=0;
   for(const item of output){
    const snapshot=eligible.find(q=>q.id===item.id)!,current=store.get<Question>('questions',item.id);
    // A concurrent manual edit, delete, restore, or other classification always wins.
    if(!current||current.deleted||current.knowledgeSource==='manual'||current.updatedAt!==snapshot.updatedAt||JSON.stringify(current.knowledgePoints)!==JSON.stringify(snapshot.knowledgePoints)){skipped++;continue;}
    if(!item.knowledgePoints.length){unclassified++;continue;}
    store.put('questions',withKnowledge({...current,knowledgeSource:'AI',knowledgePoints:item.knowledgePoints,updatedAt:now()}));classified++;
   }
   return {classified,skipped,unclassified};
  }));
 });
}
