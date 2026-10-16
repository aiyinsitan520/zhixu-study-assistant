import { zipSync,unzipSync,strToU8,strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Store,decodeRecord } from './store.ts';
import { questionInput,sourceSchema,aiReviewSchema,announcementSchema } from '../shared/schema.ts';
import { BACKUP_CONTENT_LIMIT,BACKUP_UPLOAD_LIMIT } from '../shared/limits.ts';
import type { Attachment } from '../shared/schema.ts';

const identifier=z.string().regex(/^[a-zA-Z0-9-]+$/);
const ref=identifier.nullable();
export const schemas:Record<string,z.ZodType>={
  announcements:announcementSchema,
  folders:z.object({id:identifier,name:z.string(),parentId:ref,deleted:z.boolean(),deletedBatch:z.string().optional()}),
  questions:questionInput.extend({id:identifier,createdAt:z.string(),updatedAt:z.string(),deleted:z.boolean(),wrong:z.boolean(),mastered:z.boolean(),deletedBatch:z.string().optional()}),
  attachments:z.object({id:identifier,name:z.string(),mime:z.enum(['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),hash:z.string(),size:z.number().int().nonnegative(),ownerId:identifier.optional()}),
  progress:z.object({id:identifier,wrong:z.boolean(),mastered:z.boolean(),updatedAt:z.string().optional()}),
  documents:z.object({id:identifier,name:z.string(),folderId:identifier,attachmentId:identifier.optional(),pages:z.array(z.object({imageId:identifier,label:z.string(),kind:z.enum(['exercise','reference','front'])}))}),
  attempts:z.object({id:identifier,questionId:identifier,answer:z.string(),images:z.array(identifier),correct:z.boolean().nullable(),judgement:z.enum(['自动','人工','AI']),feedback:z.string(),createdAt:z.string(),aiReview:aiReviewSchema.optional(),updatedAt:z.string().optional()}),
  drafts:z.object({id:identifier,answer:z.string(),images:z.array(identifier),updatedAt:z.string(),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()}),
  explanations:z.object({id:identifier,questionId:identifier,content:z.string(),createdAt:z.string(),model:z.string(),updatedAt:z.string().optional()}),
  rewards:z.object({id:identifier,points:z.literal(10),createdAt:z.string(),updatedAt:z.string().optional()}),
  wallet:z.object({id:identifier,coins:z.number().int().nonnegative().max(1e9),earned:z.number().int().nonnegative().max(1e9),owned:z.array(z.string().max(40)).max(100),activeSkin:z.string().max(40),credited:z.array(identifier).max(100000).optional(),createdAt:z.string(),updatedAt:z.string().optional()}),
  profile:z.object({id:identifier,anonymous:z.boolean(),updatedAt:z.string().optional()}),
  jobs:z.object({id:identifier,name:z.string(),folderId:ref,attachmentIds:z.array(identifier),status:z.enum(['preparing','running','review','error','cancelled','committed']),tasks:z.array(z.object({id:identifier,source:sourceSchema,text:z.string().optional(),imageId:identifier.optional(),status:z.enum(['pending','done','error']),error:z.string().optional()})),drafts:z.array(questionInput.extend({id:identifier})),errors:z.array(z.string()),duplicates:z.array(z.string()),createdAt:z.string(),committedIds:z.array(identifier).optional()}),
};
for(const kind of ['attempts','drafts','rewards','explanations','progress','wallet','profile'])schemas[kind]=(schemas[kind] as z.ZodObject<any>).extend({updatedAt:z.string().optional()});
export function makeBackup(store:Store){
  return store.context.exit(()=>makeBackupUnscoped(store));
}
function makeBackupUnscoped(store:Store){
  const records=store.db.prepare('SELECT kind,id,data FROM records').all().map(r=>({kind:r.kind,id:r.id,value:decodeRecord(r.data as string)}));
  const files:Record<string,Uint8Array>={'manifest.json':strToU8(JSON.stringify({version:1,createdAt:new Date().toISOString(),records}))};
  let size=files['manifest.json'].length;
  if(size>BACKUP_CONTENT_LIMIT)throw new Error('备份超过 200 MB');
  for(const a of store.all<Attachment>('attachments')){const b=store.bytes(a.id);size+=b.length;if(size>BACKUP_CONTENT_LIMIT)throw new Error('备份超过 200 MB，请关闭应用后手动复制整个数据目录');files['attachments/'+a.id]=b;}
  const archive=zipSync(files,{level:1});
  if(archive.length>BACKUP_UPLOAD_LIMIT)throw new Error('备份压缩包超过 210 MB');
  return archive;
}
export function restoreBackup(store:Store,buffer:Uint8Array){
  return store.context.exit(()=>restoreBackupUnscoped(store,buffer));
}
function baseKind(kind:string){return /^user-[a-zA-Z0-9-]+:(attempts|drafts|rewards|explanations|progress|wallet|profile)$/.test(kind)?kind.split(':')[1]:kind;}
function restoreBackupUnscoped(store:Store,buffer:Uint8Array){
  if(buffer.length>BACKUP_UPLOAD_LIMIT)throw new Error('备份压缩包超过 210 MB');
  let total=0;
  const files=unzipSync(buffer,{filter:f=>{total+=f.originalSize;if(total>BACKUP_CONTENT_LIMIT)throw new Error('备份解压后超过 200 MB');if(f.name!=='manifest.json'&&!/^attachments\/[a-zA-Z0-9-]+$/.test(f.name))throw new Error('备份包含无效文件路径');return true;}});
  if(!files['manifest.json'])throw new Error('缺少备份清单');
  const manifest=z.object({version:z.literal(1),records:z.array(z.object({kind:z.string(),id:identifier,value:z.any()}))}).parse(JSON.parse(strFromU8(files['manifest.json'])));
  const seen=new Set<string>();
  for(const r of manifest.records){const schema=schemas[baseKind(r.kind)];if(!schema)throw new Error('不支持的备份记录');r.value=schema.parse(r.value);if(r.value.id!==r.id||seen.has(r.kind+':'+r.id))throw new Error('备份有重复或不匹配的记录');seen.add(r.kind+':'+r.id);}
  const has=(k:string,v:string)=>{if(!seen.has(k+':'+v))throw new Error('备份存在丢失的关联记录');};
  const checkSource=(s:any)=>{has('attachments',s.attachmentId);if(s.imageId)has('attachments',s.imageId);};
  for(const {kind:storedKind,value:v} of manifest.records){const kind=baseKind(storedKind);
    if(kind==='attachments'){const b=files['attachments/'+v.id];if(!b||b.length!==v.size||createHash('sha256').update(b).digest('hex')!==v.hash)throw new Error('备份附件丢失或校验失败');}
    if(kind==='folders'&&v.parentId)has('folders',v.parentId);
    if(kind==='questions'){if(v.folderId)has('folders',v.folderId);v.sources.forEach(checkSource);}
    if(['attempts','explanations'].includes(kind))has('questions',v.questionId);
    if(['drafts','rewards','progress'].includes(kind))has('questions',v.id);
    if(kind==='documents'){has('folders',v.folderId);if(v.attachmentId)has('attachments',v.attachmentId);v.pages.forEach((p:any)=>has('attachments',p.imageId));}
    if(v.images)v.images.forEach((x:string)=>has('attachments',x));
    if(kind==='jobs'){if(v.folderId)has('folders',v.folderId);v.attachmentIds.forEach((x:string)=>has('attachments',x));v.tasks.forEach((t:any)=>{checkSource(t.source);if(t.imageId)has('attachments',t.imageId);});v.drafts.forEach((d:any)=>{if(d.folderId)has('folders',d.folderId);d.sources.forEach(checkSource);});if(['running','preparing'].includes(v.status))v.status='cancelled';}
  }
  const folders=new Map(manifest.records.filter(x=>x.kind==='folders').map(x=>[x.id,x.value]));
  for(const f of folders.values()){const visited=new Set<string>();let cur=f;while(cur){if(visited.has(cur.id))throw new Error('备份文件夹存在循环');visited.add(cur.id);cur=folders.get(cur.parentId);}}
  // Save a complete rollback archive before replacing any data. Never export secrets.
  const safety=join(store.root,'backups');mkdirSync(safety,{recursive:true});
  writeFileSync(join(safety,`before-restore-${Date.now()}.zip`),makeBackup(store));
  // Remap attachment ids to avoid overwriting old blobs before the DB transaction commits.
  const replacements=new Map<string,string>();
  const {randomUUID}=requireUUID;
  for(const r of manifest.records.filter(x=>x.kind==='attachments'))replacements.set(r.id,randomUUID());
  const mapSource=(s:any)=>({...s,attachmentId:replacements.get(s.attachmentId),...(s.imageId?{imageId:replacements.get(s.imageId)}:{})});
  for(const r of manifest.records){const v=r.value;
    if(r.kind==='attachments'){const old=r.id;r.id=v.id=replacements.get(old)!;writeFileSync(store.file(v.id),files['attachments/'+old],{mode:0o600});}
    if(v.images)v.images=v.images.map((x:string)=>replacements.get(x));
    if(v.sources)v.sources=v.sources.map(mapSource);
    if(r.kind==='documents'){if(v.attachmentId)v.attachmentId=replacements.get(v.attachmentId);v.pages=v.pages.map((p:any)=>({...p,imageId:replacements.get(p.imageId)}));}
    if(r.kind==='jobs'){v.attachmentIds=v.attachmentIds.map((x:string)=>replacements.get(x));v.tasks=v.tasks.map((t:any)=>({...t,source:mapSource(t.source),...(t.imageId?{imageId:replacements.get(t.imageId)}:{})}));v.drafts=v.drafts.map((d:any)=>({...d,sources:d.sources.map(mapSource)}));}
  }
  store.transaction(()=>{store.db.exec('DELETE FROM records');for(const r of manifest.records)store.put(r.kind,r.value,true);});
  return {ok:true,records:manifest.records.length};
}
import * as requireUUID from 'node:crypto';
