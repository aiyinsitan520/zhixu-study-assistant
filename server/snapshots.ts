import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,copyFileSync,readdirSync,unlinkSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {Store,decodeRecord} from './store.ts';
import type {Attachment} from '../shared/schema.ts';
import type {Auth} from './auth.ts';
export class Snapshots {
 private timer?:ReturnType<typeof setTimeout>;
 private running?:Promise<any>;
 private last=0;
 private dirty=true;
 private stopped=false;
 private lastFailure=0;
 error='';
 readonly directory:string;
 constructor(private store:Store,private auth?:Auth){this.directory=join(store.root,'backups','automatic');mkdirSync(join(this.directory,'objects'),{recursive:true});mkdirSync(join(this.directory,'snapshots'),{recursive:true});}
 schedule(){this.dirty=true;if(this.timer||this.stopped)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(()=>this.schedule());},Math.max(2000,300000-(Date.now()-this.last),60000-(Date.now()-this.lastFailure)));this.timer.unref();}
 flush(){if(this.running)return this.running;this.running=this.capture().catch(e=>{this.error=(e as Error).message;this.lastFailure=Date.now();throw e;}).finally(()=>{this.running=undefined;});return this.running;}
 private async capture(){const seq=this.store.changeSeq,id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),folder=join(this.directory,'snapshots'),file=join(folder,id+'.study.sqlite');await backup(this.store.db,file);if(this.auth)await backup(this.auth.db,join(folder,id+'.accounts.sqlite'));const snapshot=new DatabaseSync(file,{readOnly:true});let files:Attachment[];try{files=snapshot.prepare("SELECT data FROM records WHERE kind='attachments'").all().map(r=>decodeRecord(String(r.data)));}finally{snapshot.close();}for(const a of files){if(!/^[a-f0-9]{64}$/.test(a.hash))throw new Error('附件摘要无效，未完成自动备份');const target=join(this.directory,'objects',a.hash);if(!existsSync(target)||statSync(target).size!==a.size){const data=readFileSync(this.store.file(a.id));if(createHash('sha256').update(data).digest('hex')!==a.hash)throw new Error('附件校验失败：'+a.id);copyFileSync(this.store.file(a.id),target+'.tmp');renameSync(target+'.tmp',target);}}
  const manifest={version:1,id,createdAt:new Date().toISOString(),database:id+'.study.sqlite',accounts:this.auth?id+'.accounts.sqlite':undefined,files:files.map(a=>({id:a.id,sha256:a.hash,size:a.size})),apiKeysIncluded:false};writeFileSync(join(folder,id+'.json.tmp'),JSON.stringify(manifest));renameSync(join(folder,id+'.json.tmp'),join(folder,id+'.json'));writeFileSync(join(this.directory,'latest.json.tmp'),JSON.stringify(manifest));renameSync(join(this.directory,'latest.json.tmp'),join(this.directory,'latest.json'));this.last=Date.now();this.error='';this.dirty=this.store.changeSeq!==seq;
  const manifests=readdirSync(folder).filter(n=>n.endsWith('.json')).sort().reverse();for(const name of manifests.slice(7)){const old=JSON.parse(readFileSync(join(folder,name),'utf8'));for(const suffix of ['.study.sqlite','.accounts.sqlite','.json']){const target=join(folder,old.id+suffix);if(/^[0-9TZ-]+-[a-f0-9]{8}$/.test(old.id)&&existsSync(target))unlinkSync(target);}}
  if(this.dirty)this.schedule();return {id,files:files.length};
 }
 status(){const latest=join(this.directory,'latest.json');return {directory:this.directory,lastBackup:existsSync(latest)?JSON.parse(readFileSync(latest,'utf8')).createdAt:null,running:!!this.running,error:this.error,retained:7};}
 register(app:FastifyInstance){app.get('/api/data-overview',req=>{if(req.user?.role!=='admin')throw Object.assign(new Error('仅管理员可查看数据库概况'),{statusCode:403});return this.store.context.exit(()=>{const all=this.store.all<any>('questions'),files=this.store.all<Attachment>('attachments');return {questions:{shared:all.filter(q=>!q.ownerId&&!q.deleted).length,personal:all.filter(q=>q.ownerId&&!q.deleted).length,withSharedExplanation:all.filter(q=>!q.ownerId&&!q.deleted&&q.explanation).length},attachments:{count:files.length,bytes:files.reduce((n,a)=>n+a.size,0)},aiResults:this.store.db.prepare("SELECT COUNT(*) n FROM v_ai_result_catalog").get()!.n,backup:this.status()};});});app.post('/api/data-snapshot',async req=>{if(req.user?.role!=='admin')throw Object.assign(new Error('仅管理员可备份数据库'),{statusCode:403});return this.flush();});}
 async close(){this.stopped=true;if(this.timer)clearTimeout(this.timer);await this.running?.catch(()=>{});if(this.dirty)await this.flush().catch(()=>{});}
}
