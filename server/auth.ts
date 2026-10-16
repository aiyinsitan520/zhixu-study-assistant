import { DatabaseSync } from 'node:sqlite';
import { randomBytes,randomUUID,scrypt,timingSafeEqual,createHash,createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';

export type User={id:string;username:string;name:string;role:'admin'|'student';guest?:boolean};
declare module 'fastify' { interface FastifyRequest { user?:User } }
const derive=promisify(scrypt),digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const fail=(s:string,code=400)=>Object.assign(new Error(s),{statusCode:code});
const credentials=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9_-]{3,32}$/),password:z.string().min(10).max(128)});
async function hash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(password,salt,64) as Buffer).toString('hex');}
async function verify(password:string,encoded:string){const [salt,key]=encoded.split(':');const actual=await derive(password,salt,64) as Buffer;return timingSafeEqual(actual,Buffer.from(key,'hex'));}
export class Auth {
  db:DatabaseSync;
  failures=new Map<string,{count:number;until:number}>();
  constructor(root:string){
    this.db=new DatabaseSync(join(root,'accounts.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,expires INTEGER NOT NULL,remaining INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  }
  get initialized(){return !!this.db.prepare('SELECT id FROM users LIMIT 1').get();}
  public(row:any):User{return {id:row.id,username:row.username,name:row.name,role:row.role};}
  token(req:FastifyRequest){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('zhixu_session='))?.slice(14)||'';}
  guestKey(){let row=this.db.prepare("SELECT value FROM auth_meta WHERE key='guest-key'").get() as any;if(!row){this.db.prepare("INSERT INTO auth_meta VALUES('guest-key',?)").run(randomBytes(32).toString('hex'));row=this.db.prepare("SELECT value FROM auth_meta WHERE key='guest-key'").get();}return row.value as string;}
  user(req:FastifyRequest){const raw=this.token(req);if(raw.startsWith('g.')){const parts=raw.split('.'),body=parts.slice(0,3).join('.'),signature=createHmac('sha256',this.guestKey()).update(body).digest('hex');if(parts.length===4&&/^[a-f0-9-]{36}$/.test(parts[1])&&Number(parts[2])>Date.now()&&/^[a-f0-9]{64}$/.test(parts[3])&&timingSafeEqual(Buffer.from(parts[3]),Buffer.from(signature)))return {id:parts[1],username:'guest',name:'游客同学',role:'student' as const,guest:true};return;}const row=this.db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.userId WHERE token=? AND expires>? AND disabled=0').get(digest(this.token(req)),Date.now());return row?this.public(row):undefined;}
  cookie(req:FastifyRequest,reply:FastifyReply,token:string,age=604800){const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');reply.header('Set-Cookie',`zhixu_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local?'':'; Secure'}`);}
  session(req:FastifyRequest,reply:FastifyReply,user:User){const token=randomBytes(32).toString('hex');this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+604800000);this.cookie(req,reply,token);return {user};}
  limit(key:string,max=12){const now=Date.now();for(const [k,v] of this.failures)if(v.until<now)this.failures.delete(k);const entry=this.failures.get(key)||{count:0,until:now+900000};if(entry.count>=max)throw fail('尝试过于频繁，请 15 分钟后重试',429);entry.count++;this.failures.set(key,entry);}
  async add(username:string,password:string,name:string,role:'admin'|'student'){
    const encoded=await hash(password),user={id:randomUUID(),username:username.toLowerCase(),name,role};
    try{this.db.prepare('INSERT INTO users(id,username,name,role,password) VALUES(?,?,?,?,?)').run(user.id,user.username,user.name,user.role,encoded);}catch{throw fail('这个账号名已被使用');}return user;
  }
  register(app:FastifyInstance){
    app.get('/api/auth/status',async req=>({initialized:this.initialized,user:this.user(req)||null,setupAllowed:/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')}));
    app.post('/api/auth/setup',async(req,reply)=>{
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))throw fail('请在服务器电脑打开本机地址创建管理员',403);
      if(this.initialized)throw fail('管理员已经创建',409);
      const v=credentials.extend({name:z.string().trim().min(1).max(30)}).parse(req.body);
      const encoded=await hash(v.password);
      // Recheck after asynchronous password hashing; only one first admin can win.
      if(this.initialized)throw fail('管理员已经创建',409);
      const user:User={id:randomUUID(),username:v.username.toLowerCase(),name:v.name,role:'admin'};
      this.db.prepare('INSERT INTO users(id,username,name,role,password) VALUES(?,?,?,?,?)').run(user.id,user.username,user.name,user.role,encoded);
      return this.session(req,reply,user);
    });
    app.post('/api/auth/login',async(req,reply)=>{
      const v=credentials.parse(req.body);this.limit('account:'+v.username.toLowerCase());this.limit('ip:'+req.ip,120);
      const row=this.db.prepare('SELECT * FROM users WHERE username=? AND disabled=0').get(v.username.toLowerCase()) as any;
      const dummy='00000000000000000000000000000000:'+ '0'.repeat(128);
      if(!await verify(v.password,row?.password||dummy)||!row)throw fail('账号或密码不正确',401);
      this.failures.delete('account:'+v.username.toLowerCase());return this.session(req,reply,this.public(row));
    });
    app.post('/api/auth/register',async(req,reply)=>{
      this.limit('register:'+req.ip,120);
      if(!this.initialized)throw fail('请等待管理员完成初始化',403);
      const v=credentials.extend({name:z.string().trim().min(1).max(30)}).parse(req.body);
      return this.session(req,reply,await this.add(v.username,v.password,v.name,'student'));
    });
    app.post('/api/auth/guest',async(req,reply)=>{if(!this.initialized)throw fail('请等待管理员完成初始化',403);this.limit('guest:'+req.ip,120);const existing=this.user(req);if(existing)return {user:existing};const user:User={id:randomUUID(),username:'guest',name:'游客同学',role:'student',guest:true},body='g.'+user.id+'.'+(Date.now()+86400000);this.cookie(req,reply,body+'.'+createHmac('sha256',this.guestKey()).update(body).digest('hex'),86400);return {user};});
    app.post('/api/auth/logout',async(req,reply)=>{this.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(this.token(req)));this.cookie(req,reply,'',0);return {ok:true};});
    app.post('/api/auth/password',async req=>{
      if(!req.user)throw fail('请先登录',401);const v=z.object({current:z.string().max(128),password:z.string().min(10).max(128)}).parse(req.body);
      this.limit('password:'+req.user.id);const row=this.db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id) as any;if(!await verify(v.current,row.password))throw fail('当前密码不正确');
      this.db.prepare('UPDATE users SET password=? WHERE id=?').run(await hash(v.password),req.user.id);this.db.prepare('DELETE FROM sessions WHERE userId=?').run(req.user.id);return {ok:true};
    });
    app.get('/api/auth/users',async req=>{if(req.user?.role!=='admin')throw fail('仅管理员可管理账号',403);return this.db.prepare('SELECT id,username,name,role,disabled FROM users ORDER BY rowid').all();});
    app.patch('/api/auth/users/:id',async(req:any)=>{if(req.user?.role!=='admin')throw fail('仅管理员可管理账号',403);if(req.params.id===req.user.id)throw fail('不能停用自己');const v=z.object({disabled:z.boolean()}).parse(req.body);this.db.prepare("UPDATE users SET disabled=? WHERE id=? AND role='student'").run(v.disabled?1:0,req.params.id);this.db.prepare('DELETE FROM sessions WHERE userId=?').run(req.params.id);return {ok:true};});
  }
  close(){this.db.close();}
}
