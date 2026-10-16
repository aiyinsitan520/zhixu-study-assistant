import { createContext,useContext,useEffect,useState } from 'react';
import { ArrowRight,BookOpen,ShieldCheck,LogOut,Users,KeyRound,Copy,Check } from 'lucide-react';
import { api } from './lib';
import {StorageSettings} from './StorageSettings';
import {resetAnnouncementWelcome} from './Announcements';
import { Button,Field } from './ui';
export type User={id:string;username:string;name:string;role:'admin'|'student'};
export const UserContext=createContext<User>({id:'',username:'',name:'同学',role:'student'});
export const useUser=()=>useContext(UserContext);
export function AuthGate({children}:{children:React.ReactNode}){
  const [status,setStatus]=useState<{initialized:boolean;setupAllowed:boolean;user:User|null}|null>(null),[mode,setMode]=useState('login'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[invite,setInvite]=useState('');
  useEffect(()=>{api('/auth/status').then(setStatus).catch(e=>setError(e.message));},[]);
  if(status?.user)return <UserContext.Provider value={status.user}>{children}</UserContext.Provider>;
  const setup=status&&!status.initialized,register=mode==='register';
  return <div className="auth-page"><section className="auth-story"><a className="auth-brand" href="/"><span className="brand-mark">知</span><strong>知序 <small>STUDY SPACE</small></strong></a><div className="auth-story-copy"><span className="eyebrow">A SPACE FOR EVERY SMALL DISCOVERY</span><h1>让每一次思考，<br/>都有迹可循。</h1><p>从一道题，到一个知识点。<br/>和同学一起，把零散的练习整理成自己的进步。</p><div className="math-orbit"><span>∫</span><div><i>f′(x)</i><b>lim</b><em>∞</em></div></div></div><div className="auth-foot"><BookOpen size={16}/>共享题库 · 独立学习记录 · 专注当下</div></section><section className="auth-form-side"><div className="auth-form"><span className="tag green">知序 · 初代版本 0.2</span><h2>{setup?'建立你的学习空间':register?'一起开始学习':'欢迎回来。'}</h2><p className="subtle">{setup?'先创建管理员账号，再邀请同学加入。':register?'使用管理员提供的邀请码创建自己的账号。':'登录后，接着上一次的思路往下走。'}</p>
    {status&&(!setup||status.setupAllowed)?<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const result=await api('/auth/'+(setup?'setup':register?'register':'login'),'POST',{username,password,name,invite});resetAnnouncementWelcome(result.user.id);setStatus({...status,user:result.user});setPassword('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      {(setup||register)&&<Field label="怎么称呼你"><input required autoComplete="nickname" value={name} onChange={e=>setName(e.target.value)} maxLength={30} placeholder="你的名字或昵称"/></Field>}
      <Field label="账号"><input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} pattern={'[A-Za-z0-9_\\-]{3,32}'} placeholder="3–32 位字母、数字、下划线"/></Field>
      <Field label="密码"><input required type="password" minLength={10} maxLength={128} autoComplete={setup||register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 10 个字符"/></Field>
      {!setup&&register&&<Field label="班级邀请码"><input required value={invite} onChange={e=>setInvite(e.target.value.trim())} placeholder="向管理员获取邀请码"/></Field>}
      {error&&<div className="notice error" role="alert">{error}</div>}<Button className="auth-submit" busy={busy}>{setup?'创建管理员':register?'创建账号':'进入学习空间'}<ArrowRight size={16}/></Button>
      {!setup&&<button type="button" className="auth-switch" onClick={()=>{setMode(register?'login':'register');setError('');}}>{register?'已有账号？去登录':'第一次来？用邀请码注册'}</button>}
    </form>:<div className="notice">{error||(!status?'正在连接学习空间…':'管理员尚未完成初始化，请在服务器电脑打开 http://127.0.0.1:4317 创建管理员。')}</div>}
    <div className="auth-security"><ShieldCheck size={15}/>作答、错题和积分仅自己可见</div></div></section></div>;
}
export function Account({notify}:{notify:(s:string)=>void}){
  const user=useUser(),[users,setUsers]=useState<(User&{disabled:number})[]>([]),[invite,setInvite]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[current,setCurrent]=useState(''),[password,setPassword]=useState('');
  const refresh=()=>{if(user.role==='admin')void api('/auth/users').then(setUsers).catch(e=>setError(e.message));};useEffect(refresh,[]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <><div className="page-heading"><div><span className="eyebrow">YOUR SPACE, YOUR PACE</span><h1>账号与同学</h1><p>{user.name} · {user.role==='admin'?'管理员':'学习成员'}</p></div><Button variant="outline" onClick={()=>act(async()=>{await api('/auth/logout','POST');location.reload();})}><LogOut size={16}/>退出登录</Button></div>{error&&<div className="notice error">{error}</div>}
    <StorageSettings/><div className="settings-grid"><section className="panel settings-panel"><div className="section-label"><KeyRound size={18}/>修改密码</div><form onSubmit={e=>{e.preventDefault();void act(async()=>{await api('/auth/password','POST',{current,password});location.reload();});}}><Field label="当前密码"><input type="password" required autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)}/></Field><Field label="新密码"><input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></Field><Button busy={busy}>更新密码并重新登录</Button></form><p className="subtle">更换后会退出这个账号在所有设备上的登录。</p></section>
    {user.role==='admin'&&<section className="panel settings-panel"><div className="section-label"><Users size={18}/>邀请同学</div><p className="subtle">邀请码可使用 20 次，7 天内有效。新成员拥有独立的作答、草稿与错题记录。</p><Button disabled={busy} onClick={()=>act(async()=>{setInvite((await api('/auth/invites','POST',{uses:20})).code);})}>生成邀请码</Button>{invite&&<div className="invite-box"><code>{invite}</code><Button variant="ghost" onClick={()=>act(async()=>{await navigator.clipboard.writeText(invite);notify('邀请码已复制');})}><Copy size={14}/>复制</Button></div>}<div className="member-list">{users.map(u=><div className="row spread" key={u.id}><div><strong>{u.name}</strong><small> @{u.username} · {u.role==='admin'?'管理员':u.disabled?'已停用':'学习成员'}</small></div>{u.role==='student'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>act(async()=>{await api('/auth/users/'+u.id,'PATCH',{disabled:!u.disabled});refresh();})}>{u.disabled?'启用':'停用'}</Button>}</div>)}</div></section>}</div></>;
}
