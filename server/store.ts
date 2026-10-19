import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from './auth.ts';
import type { Attachment, Settings } from '../shared/schema.ts';
import {withKnowledge} from '../shared/knowledge.ts';
import type {AIResults} from './ai-results.ts';
import type {AIAccess} from './ai-access.ts';

export const now=()=>new Date().toISOString();
export const id=()=>randomUUID();
export const PERSONAL_KINDS=['attempts','drafts','rewards','explanations','progress','wallet','profile'];
export const PRIVATE_KINDS=[...PERSONAL_KINDS,'aiResults'];
export const USER_QUOTA=1024*1024*1024;
export function decodeRecord(data:string){const value=JSON.parse(data);return value?.__gzip===1?JSON.parse(gunzipSync(Buffer.from(value.body,'base64'),{maxOutputLength:10*1024*1024}).toString('utf8')):value;}
function encodeRecord(kind:string,value:unknown){const plain=JSON.stringify(value);if(!PERSONAL_KINDS.includes(kind.split(':').at(-1)!))return plain;const packed=JSON.stringify({__gzip:1,body:gzipSync(plain,{level:6}).toString('base64')});return packed.length<plain.length?packed:plain;}
export class Store {
  aiAccess?:AIAccess;
  aiResults?:AIResults;
  changeSeq=0;
  onChange?:()=>void;
  db:DatabaseSync;
  root:string;
  quotaLimit=USER_QUOTA;
  context=new AsyncLocalStorage<User>();
  asUser<T>(user:User|undefined,fn:()=>T):T{return user?this.context.run(user,fn):fn();}
  private kind(kind:string){const user=this.context.getStore();return user&&PRIVATE_KINDS.includes(kind)?`user-${user.id}:${kind}`:kind;}
  private visible(kind:string,value:any){if(kind==='questions')value=withKnowledge(value);const user=this.context.getStore();if(!user)return value;if(kind==='jobs'&&user.role==='student'&&!value.ownerId)return undefined;if(['attachments','questions','folders','jobs'].includes(kind)&&value.ownerId&&value.ownerId!==user.id)return undefined;if(kind==='questions'){const progress=this.get<any>('progress',value.id);return {...value,wrong:progress?.wrong??false,mastered:progress?.mastered??false};}return value;}
  constructor(root=process.env.STUDY_DATA_DIR || join(homedir(),'StudyAssistantData')) {
    this.root=root;
    mkdirSync(join(root,'attachments'),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(join(root,'study.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;');
  }
  all<T>(kind:string):T[]{return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(this.kind(kind)).map(r=>this.visible(kind,decodeRecord(r.data as string))).filter(v=>v!==undefined);}
  get<T>(kind:string,key:string):T|undefined { const r=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(this.kind(kind),key); return r?this.visible(kind,decodeRecord(r.data as string)):undefined; }
  usage(userId=this.context.getStore()?.id){if(!userId)return {used:0,limit:this.quotaLimit};const rows=this.db.prepare("SELECT kind,data FROM records WHERE kind LIKE ? OR kind IN ('attachments','questions','folders','jobs','feedback','feedbackAwards')").all(`user-${userId}:%`);let used=0;for(const r of rows){if(['questions','folders','jobs','feedback','feedbackAwards'].includes(String(r.kind))){const value=decodeRecord(r.data as string);if(value.ownerId===userId)used+=Buffer.byteLength(r.data as string);}else if(r.kind==='attachments'){const a=decodeRecord(r.data as string);if(a.ownerId===userId)used+=a.size+Buffer.byteLength(r.data as string);}else used+=Buffer.byteLength(r.data as string);}return {used,limit:this.quotaLimit};}
  checkQuota(delta:number){if(this.context.getStore()&&this.usage().used+delta>this.quotaLimit)throw Object.assign(new Error('服务器空间已达 1 GB 上限，请导出备份、清理记录或改为保存到当前设备。当前内容尚未上传。'),{statusCode:413});}
  put<T extends {id:string}>(kind:string,value:T,preserveTimestamp=false){let stored:any=value;if(PERSONAL_KINDS.includes(kind.split(':').at(-1)!)&&!preserveTimestamp)stored={...stored,updatedAt:now()};if(kind==='questions'&&this.context.getStore()){
    const q=value as any;this.put('progress',{id:q.id,wrong:q.wrong,mastered:q.mastered});stored={...q,wrong:false,mastered:false};
  }const k=this.kind(kind),data=encodeRecord(k,stored);if(PRIVATE_KINDS.includes(kind)||(['questions','folders','jobs','feedback','feedbackAwards'].includes(kind)&&(stored as any).ownerId)){const old=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(k,value.id);this.checkQuota(Buffer.byteLength(data)-(old?Buffer.byteLength(old.data as string):0));}this.db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(k,value.id,data);this.changeSeq++;this.onChange?.();return value;}
  remove(kind:string,key:string){this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(this.kind(kind),key);this.changeSeq++;this.onChange?.();}
  transaction<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  attach(buffer:Uint8Array,name:string,mime:string,shared=false):Attachment {
    const user=this.context.getStore();
    const item={id:id(),name,mime,size:buffer.length,hash:createHash('sha256').update(buffer).digest('hex'),...(!shared&&user?{ownerId:user.id}:{})};
    if(item.ownerId)this.checkQuota(buffer.length+Buffer.byteLength(JSON.stringify(item)));
    writeFileSync(this.file(item.id),buffer,{mode:0o600});return this.put('attachments',item);
  }
  file(key:string){if(!/^[a-zA-Z0-9-]+$/.test(key))throw new Error('无效附件标识');return join(this.root,'attachments',key);}
  bytes(key:string){if(!this.get('attachments',key))throw new Error('附件不存在');return readFileSync(this.file(key));}
  privateConfig():Settings & {key:string;visionKey:string} {
    const file=join(this.root,'secrets.json');
    const data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
    return {baseUrl:'https://api.openai.com/v1',visionBaseUrl:'',model:'global:deepseek-v4.1-flash',visionModel:'global:deepseek-v4.1-flash',key:'',visionKey:'',...data,hasKey:!!data.key,hasVisionKey:!!data.visionKey};
  }
  publicConfig():Settings {const {key,visionKey,...rest}=this.privateConfig();return rest;}
  saveConfig(values:Partial<ReturnType<Store['privateConfig']>>) {const v={...this.privateConfig(),...values};const p=join(this.root,'secrets.json');writeFileSync(p+'.tmp',JSON.stringify(v),{mode:0o600});renameSync(p+'.tmp',p);return this.publicConfig();}
  close(){this.db.close();}
}
