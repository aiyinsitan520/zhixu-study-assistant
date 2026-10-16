import {readFileSync,existsSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {Store,id,now} from '../server/store.ts';
import {questionInput} from '../shared/schema.ts';
const root=process.env.STUDY_DATA_DIR||'E:/AAA数据库/知序服务器/data';
mkdirSync(root,{recursive:true});
// Preserve the recovered local database if this is the first deployment.
if(!existsSync(join(root,'study.sqlite'))&&existsSync('.local/data/study.sqlite')){
  const {DatabaseSync}=await import('node:sqlite');const old=new DatabaseSync('.local/data/study.sqlite');
  old.exec('PRAGMA wal_checkpoint(TRUNCATE)');old.close();copyFileSync('.local/data/study.sqlite',join(root,'study.sqlite'));
  // Existing blobs are copied individually; originals stay untouched.
  const {readdirSync}=await import('node:fs');mkdirSync(join(root,'attachments'),{recursive:true});
  for(const name of readdirSync('.local/data/attachments'))copyFileSync(join('.local/data/attachments',name),join(root,'attachments',name));
}
const store=new Store(root);
const manifest=JSON.parse(readFileSync('E:/AAA数据库/知序服务器/题目资料/导入清单.json','utf8'));
const summary=[];
for(const item of manifest){
  if(store.all<any>('documents').some(d=>d.name===item.name)){console.log('Already imported:',item.name);continue;}
  const folder={id:id(),name:item.name,parentId:null,deleted:false};
  const attach=(path:string,mime='image/jpeg')=>store.attach(readFileSync(path),basename(path),mime,true);
  const original=item.original?attach(item.original,'application/pdf'):undefined;
  const pages=item.pages.map((p:any)=>({...p,imageId:attach(p.path).id}));
  const add=(title:string,stem:string,sources:any[],materialKind:'page'|'question'='question',answer='')=>store.put('questions',{
    ...questionInput.parse({title,stem,sources,folderId:folder.id,materialKind,answer,answerOrigin:answer?'原文':'无',answerConfirmed:false}),
    id:id(),createdAt:now(),updatedAt:now(),deleted:false,wrong:false,mastered:false,
  });
  store.transaction(()=>{
    store.put('folders',folder);
    store.put('documents',{id:id(),name:item.name,folderId:folder.id,...(original?{attachmentId:original.id}:{}),pages:pages.map(({imageId,label,kind}:any)=>({imageId,label,kind}))});
    for(const [i,p] of pages.entries())if(p.kind==='exercise'&&item.original)add(`${item.name.startsWith('微积分')?'作业':'精选练习'} · 第 ${i+1} 页`,'请根据下方原页完成练习。可在作答区填写题号与解答，或上传手写作答照片。此练习项保留整页题目，尚未逐小题拆分。',[{attachmentId:original.id,name:item.name,page:i+1,imageId:p.imageId}],'page');
    for(const q of item.questions){const crop=attach(q.path);add(`求导 · 第 ${q.number} 题`,'求解下方原题，写出完整推导过程。',[{attachmentId:pages[q.page-1].imageId,name:item.name,page:q.page,imageId:crop.id}]);}
    if(item.name==='求极限100题'){
      const basics=[
        [String.raw`\lim_{x\to0}\frac{e^{2x}-e^{-2x}}{\sin3x}`,String.raw`\frac43`],
        [String.raw`\lim_{x\to0}\left(1+\sin\frac x2\right)^{1/x}`,String.raw`\sqrt e`],
        [String.raw`\lim_{x\to0}\frac{e^x-\sin x-1}{\sqrt{1-x^2}-1}`,'-1'],
        [String.raw`\lim_{x\to3}\left(\frac{x}{x-3}-\frac9{x^2-3x}\right)`,'2'],
        [String.raw`\lim_{x\to+\infty}x\left(\arctan x-\frac\pi2\right)`,'-1'],
        [String.raw`\lim_{x\to+\infty}(\sqrt{x^2+2}-x)`,'0'],
        [String.raw`\lim_{x\to0}\frac{e^{\tan x}-e^x}{x^3}`,String.raw`\frac13`],
      ];
      basics.forEach(([formula,answer],i)=>{
        const q=add(`求极限 · 第 ${i+1} 题`,`计算极限：\n\n$$${formula}$$\n\n写出所用方法与推导过程。`,[], 'question',`$${answer}$`);
        store.put('questions',{...q,explanation:'原文解答见本资料「阅读原文」中的原图 13。题干已人工转录，参考结论保留来源标记。'});
      });
    }
  });
  summary.push({name:item.name,pages:pages.length,questions:store.all<any>('questions').filter(q=>q.folderId===folder.id&&q.materialKind==='question').length,exercisePages:store.all<any>('questions').filter(q=>q.folderId===folder.id&&q.materialKind==='page').length});
}
writeFileSync(join(root,'首轮题库清单.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));store.close();
