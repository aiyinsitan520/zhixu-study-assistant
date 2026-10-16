import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {announcementInput,type Announcement} from '../shared/schema.ts';
import {Store,id,now} from './store.ts';

const fail=(message:string,statusCode:number)=>Object.assign(new Error(message),{statusCode});
function admin(req:FastifyRequest){if(req.user?.role!=='admin')throw fail('只有管理员可以发布和管理告示',403);}
const changes=z.object({title:announcementInput.shape.title.optional(),content:announcementInput.shape.content.optional(),pinned:z.boolean().optional(),published:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>0,'请选择要修改的内容');

export function announcementRoutes(app:FastifyInstance,store:Store){
 app.get('/api/announcements',req=>store.all<Announcement>('announcements')
  .filter(a=>req.user?.role==='admin'||a.published)
  .sort((a,b)=>Number(b.published)-Number(a.published)||Number(b.pinned)-Number(a.pinned)||b.publishedAt.localeCompare(a.publishedAt)||b.id.localeCompare(a.id)));
 app.post('/api/announcements',async req=>{
  admin(req);const input=announcementInput.parse(req.body),date=now();
  return store.put('announcements',{...input,id:id(),published:true,authorName:req.user!.name,createdAt:date,updatedAt:date,publishedAt:date});
 });
 app.patch('/api/announcements/:id',async req=>{
  admin(req);const key=z.object({id:z.string().uuid()}).parse(req.params).id;
  const old=store.get<Announcement>('announcements',key);if(!old)throw fail('告示不存在',404);
  const parsed=changes.parse(req.body);
  const input=Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.hasOwn(req.body as object,key)));
  const date=now();return store.put('announcements',{...old,...input,updatedAt:date,...(input.published===true&&!old.published?{publishedAt:date}:{})});
 });
}
