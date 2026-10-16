import { buildApp } from './app.ts';
import { fileURLToPath } from 'node:url';
import { join,dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const {app}=buildApp();
const dev=process.argv.includes('--dev');
if(dev){
  const {createServer}=await import('vite');const vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});
  app.addHook('onRequest',(req,reply,done)=>{if(req.url.startsWith('/api/'))return done();vite.middlewares(req.raw,reply.raw,done);});
  app.addHook('onClose',async()=>{await vite.close();});
}else{
  if(!existsSync(join(root,'dist','index.html'))){console.error('请先运行 pnpm build');process.exit(1);}
  await app.register((await import('@fastify/static')).default,{root:join(root,'dist')});
  app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'接口不存在'}):reply.sendFile('index.html'));
}
const port=Number(process.env.PORT||4317);
await app.listen({host:'127.0.0.1',port});
console.log(`知序 · AI 刷题助手：http://127.0.0.1:${port}`);
if(process.env.STUDY_OPEN_BROWSER==='1'){
  const url=`http://127.0.0.1:${port}`;
  if(process.platform==='darwin')execFile('open',[url]);
  else if(process.platform==='win32')execFile('rundll32',['url.dll,FileProtocolHandler',url]);
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
