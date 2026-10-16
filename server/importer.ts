import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { Store,id } from './store.ts';
import type { ImportJob, Attachment, JobTask } from '../shared/schema.ts';
import { importOutput } from '../shared/schema.ts';
import { chat,importPrompt,importClassificationPrompt,parseAI } from './ai.ts';
import {withKnowledge} from '../shared/knowledge.ts';

const exec=promisify(execFile);
export function officePath(){const candidates=[process.env.LIBREOFFICE_PATH,'/Applications/LibreOffice.app/Contents/MacOS/soffice','C:\\Program Files\\LibreOffice\\program\\soffice.exe','C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe','/usr/bin/libreoffice'];return candidates.find(p=>p&&existsSync(p));}
export const allowedExtensions=['.pdf','.doc','.docx','.txt','.jpg','.jpeg','.png','.webp'];
export const mimeFor=(name:string)=>({'.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.txt':'text/plain','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[extname(name).toLowerCase()]||'application/octet-stream');

async function pages(store:Store,attachment:Attachment,signal:AbortSignal):Promise<JobTask[]> {
  const ext=extname(attachment.name).toLowerCase();
  const source={attachmentId:attachment.id,name:attachment.name};
  if(ext==='.txt') {
    const b=store.bytes(attachment.id);let text=new TextDecoder('utf-8').decode(b);
    if(text.includes('\uFFFD'))text=new TextDecoder('gb18030').decode(b);
    if(!text.trim())throw new Error('文本文件为空');
    const chunks=text.match(/[\s\S]{1,12000}/g)!;
    return chunks.map((text,i)=>({id:id(),source:{...source,page:i+1},text,status:'pending'}));
  }
  if(['.jpg','.jpeg','.png','.webp'].includes(ext))return [{id:id(),source:{...source,imageId:attachment.id},imageId:attachment.id,status:'pending'}];
  let pdf=store.bytes(attachment.id);let temp:string|undefined;
  try {
    if(ext==='.doc'||ext==='.docx'){
      const office=officePath();if(!office)throw new Error('Word 导入需要 LibreOffice，请在设置页查看安装说明');
      temp=mkdtempSync(join(tmpdir(),'study-word-'));
      const {copyFileSync}=await import('node:fs');const input=join(temp,'source'+ext);copyFileSync(store.file(attachment.id),input);
      await exec(office,[`-env:UserInstallation=${pathToFileURL(join(temp,'profile')).href}`,'--headless','--convert-to','pdf','--outdir',temp,input],{timeout:90000,signal,maxBuffer:1024*1024});
      const result=readdirSync(temp).find(n=>n.endsWith('.pdf'));if(!result)throw new Error('Word 转换失败，请检查文件是否损坏或被加密');
      pdf=readFileSync(join(temp,result));
    }
    Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document=await pdfjs.getDocument({data:new Uint8Array(pdf),useSystemFonts:true,isEvalSupported:false}).promise;
    try {
      if(document.numPages>150)throw new Error('单个文档最多 150 页，请先拆分文件');
      const tasks:JobTask[]=[];
      for(let n=1;n<=document.numPages;n++){
        signal.throwIfAborted();
        const page=await document.getPage(n);const base=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(1.6,2200/Math.max(base.width,base.height))});
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport}).promise;
        const image=store.attach(canvas.toBuffer('image/png'),`${attachment.name} · 第 ${n} 页.png`,'image/png',store.context.getStore()?.role!=='student');
        const tc=await page.getTextContent();const text=tc.items.map(x=>'str' in x?x.str:'').join(' ');
        tasks.push({id:id(),source:{...source,page:n,imageId:image.id},imageId:image.id,text,status:'pending'});page.cleanup();
      }
      return tasks;
    } finally{await document.destroy();}
  } finally{if(temp)rmSync(temp,{recursive:true,force:true});}
}
export class Importer {
  active=new Map<string,AbortController>();
  constructor(private store:Store){for(const j of store.all<ImportJob>('jobs')){if(['running','preparing'].includes(j.status)){j.status='cancelled';j.errors.push('应用曾关闭；可重试未完成部分');store.put('jobs',j);}}}
  cancel(key:string){this.active.get(key)?.abort();const j=this.store.get<ImportJob>('jobs',key);if(j&&!['committed','review'].includes(j.status)){j.status='cancelled';this.store.put('jobs',j);}}
  async run(key:string){
    if(this.active.has(key))return;
    const controller=new AbortController();this.active.set(key,controller);
    let job=this.store.get<ImportJob>('jobs',key)!;
    try {
      job.errors=[];job.status='preparing';this.store.put('jobs',job);
      for(const aid of job.attachmentIds){
        if(job.tasks.some(t=>t.source.attachmentId===aid))continue;
        try{const a=this.store.get<Attachment>('attachments',aid)!;job.tasks.push(...await pages(this.store,a,controller.signal));}
        catch(e){if(controller.signal.aborted)throw e;job.errors.push(`${this.store.get<Attachment>('attachments',aid)?.name}：${e instanceof Error?e.message:'无法读取文件'}`);}
        this.store.put('jobs',job);
      }
      job.status='running';this.store.put('jobs',job);
      for(const task of job.tasks){
        controller.signal.throwIfAborted();if(task.status==='done')continue;
        try {
          const raw=await chat(this.store,importPrompt+'\n'+importClassificationPrompt,`来源 ${task.source.name}，页/分段 ${task.source.page||1}。\n${task.text||'请识别图片中的题目。'}`,task.imageId?[task.imageId]:[],controller.signal,!!task.imageId);
          controller.signal.throwIfAborted();
          const output=parseAI(raw,importOutput);
          job.drafts.push(...output.questions.map(q=>withKnowledge({...q,knowledgeSource:q.knowledgePoints?.length?'AI' as const:'auto' as const,id:id(),folderId:job.folderId,sources:[task.source],answerOrigin:q.answer?'原文' as const:'无' as const,answerConfirmed:false})));
          task.status='done';delete task.error;
        }catch(e){if(controller.signal.aborted)throw e;task.status='error';task.error=e instanceof Error?e.message:'识别失败';}
        this.store.put('jobs',job);
      }
      job.status=job.errors.length||job.tasks.some(t=>t.status==='error')?'error':'review';
    }catch{job.status='cancelled';}
    finally{this.store.put('jobs',job);this.active.delete(key);}
  }
}
