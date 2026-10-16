import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Megaphone,PencilLine,Pin,Plus,RotateCcw,Send,SquarePen} from 'lucide-react';
import type {Announcement} from '../shared/schema';
import {api,formatDate} from './lib';
import {Button,Empty,Field,MathText,Modal} from './ui';
import './announcements.css';

const welcomeKey=(userId:string)=>'zhixu-notices-'+userId;
export function resetAnnouncementWelcome(userId:string){try{sessionStorage.removeItem(welcomeKey(userId));}catch{}}
export function useAnnouncements(userId:string){
 const [items,setItems]=useState<Announcement[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[welcome,setWelcome]=useState(false);
 const checked=useRef(false),signature=useRef('');
 const refresh=useCallback(async()=>{
  try{
   const values=await api<Announcement[]>('/announcements');setItems(values);setError('');
   const active=values.filter(a=>a.published);signature.current=active.map(a=>a.id+':'+a.updatedAt).join('|');
   if(!checked.current){checked.current=true;let seen='';try{seen=sessionStorage.getItem(welcomeKey(userId))||'';}catch{}if(active.length&&seen!==signature.current)setWelcome(true);}
  }catch(e){setError((e as Error).message);throw e;}finally{setLoading(false);}
 },[userId]);
 useEffect(()=>{void refresh().catch(()=>{});const timer=setInterval(()=>void refresh().catch(()=>{}),60000);return()=>clearInterval(timer);},[refresh]);
 const dismiss=()=>{try{sessionStorage.setItem(welcomeKey(userId),signature.current);}catch{}setWelcome(false);};
 return {items,error,loading,welcome,refresh,dismiss};
}
type Notices=ReturnType<typeof useAnnouncements>;
function Metadata({item}:{item:Announcement}){return <div className="announcement-meta"><span>{item.authorName}</span><span>·</span><time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time>{item.updatedAt!==item.createdAt&&<span>已更新</span>}</div>;}
function Badges({item}:{item:Announcement}){return <div className="row">{item.pinned&&<span className="tag green"><Pin size={11}/>置顶</span>}{!item.published&&<span className="tag">已撤下</span>}</div>;}

export function AnnouncementWelcome({notices,onOpen}:{notices:Notices;onOpen:()=>void}){
 const active=notices.items.filter(a=>a.published);
 return <Modal open={notices.welcome&&active.length>0} onClose={notices.dismiss} title="学习前，看看最新告示" description="来自管理员的学习安排与站点消息。" wide>
  <div className="announcement-welcome-list">{active.map(a=><article key={a.id} className="announcement-welcome-item"><Badges item={a}/><h3>{a.title}</h3><Metadata item={a}/><MathText text={a.content}/></article>)}</div>
  <div className="modal-foot"><Button variant="outline" onClick={()=>{notices.dismiss();onOpen();}}>查看告示板<ArrowRight size={15}/></Button><Button onClick={notices.dismiss}><Check size={15}/>知道了，开始学习</Button></div>
 </Modal>;
}

export function AnnouncementPreview({notices,admin,onOpen}:{notices:Notices;admin:boolean;onOpen:()=>void}){
 const active=notices.items.filter(a=>a.published);
 if(notices.loading)return null;
 return <section className="panel announcement-preview" aria-label="最新告示"><div className="announcement-preview-head"><div className="row"><span className="announcement-symbol"><Megaphone size={18}/></span><div><h2>告示板</h2><p>学习安排与站点消息，都在这里。</p></div></div><Button variant="ghost" size="sm" onClick={onOpen}>{admin?'查看与管理':'查看全部'}<ArrowRight size={14}/></Button></div>
  {notices.error?<div className="notice error">暂时无法加载告示：{notices.error}<Button size="sm" variant="ghost" onClick={()=>void notices.refresh().catch(()=>{})}>重试</Button></div>:active.length?<div className="announcement-preview-rows">{active.slice(0,2).map(a=><button key={a.id} onClick={onOpen} className="announcement-preview-row"><span className="row">{a.pinned&&<Pin size={13}/>}<strong>{a.title}</strong></span><time dateTime={a.publishedAt}>{formatDate(a.publishedAt)}</time><ArrowRight size={14}/></button>)}</div>:<p className="announcement-empty-note">暂时没有新告示。{admin?'发布一条，让同学们及时了解学习安排。':'有新的学习安排时，会在这里告诉你。'}</p>}
 </section>;
}

export function AnnouncementBoard({notices,admin,notify}:{notices:Notices;admin:boolean;notify:(s:string)=>void}){
 const [editor,setEditor]=useState<{id?:string;title:string;content:string;pinned:boolean}|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const run=async(key:string,fn:()=>Promise<void>)=>{setBusy(key);setError('');try{await fn();await notices.refresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}};
 const update=(a:Announcement,value:object,message:string)=>run(a.id,async()=>{await api('/announcements/'+a.id,'PATCH',value);notify(message);});
 return <><div className="page-heading"><div><span className="eyebrow">A NOTE FOR YOUR LEARNING JOURNEY</span><h1>告示板</h1><p>{admin?'发布学习安排，让每位同学都能及时看到。':'看看最近的学习安排与站点消息。'}</p></div>{admin&&<Button onClick={()=>{setError('');setEditor({title:'',content:'',pinned:false});}}><Plus size={16}/>发布告示</Button>}</div>
  <div className="announcement-board-intro"><Megaphone size={19}/><p>登录后会提示当前告示，也可以随时从侧栏回来查看。{admin&&'撤下后仅管理员可见，可再次发布。'}</p></div>
  {(error||notices.error)&&!editor&&<div className="notice error" role="alert">{error||notices.error}<Button variant="ghost" size="sm" onClick={()=>void notices.refresh().catch(()=>{})}>重新加载</Button></div>}
  {notices.loading?<p className="subtle" role="status">正在加载告示…</p>:!notices.items.length?<div className="panel"><Empty icon={Megaphone} title="还没有告示" description={admin?'写下第一条学习安排，发布后同学登录时就能看到。':'有新消息时，管理员会在这里发布。'}/></div>:<div className="announcement-list">{notices.items.map(a=><article key={a.id} className={'panel announcement-card '+(!a.published?'announcement-withdrawn':'')}>
   <div className="row spread"><Badges item={a}/><span className="announcement-kind">学习空间 · 告示</span></div><h2>{a.title}</h2><Metadata item={a}/><div className="announcement-body"><MathText text={a.content}/></div>
   {admin&&<div className="announcement-actions"><Button variant="ghost" size="sm" disabled={!!busy} onClick={()=>{setError('');setEditor({id:a.id,title:a.title,content:a.content,pinned:a.pinned});}}><PencilLine size={14}/>编辑</Button><Button variant="ghost" size="sm" disabled={!!busy} busy={busy===a.id} onClick={()=>void update(a,{pinned:!a.pinned},a.pinned?'已取消置顶':'已置顶')}><Pin size={14}/>{a.pinned?'取消置顶':'置顶'}</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={()=>void update(a,{published:!a.published},a.published?'告示已撤下':'告示已重新发布')}>{a.published?<SquarePen size={14}/>:<RotateCcw size={14}/>} {a.published?'撤下告示':'重新发布'}</Button></div>}
  </article>)}</div>}
  <Modal open={!!editor} onClose={()=>{if(!busy)setEditor(null);}} title={editor?.id?'编辑告示':'发布新告示'} description="发布后所有已登录用户可见，并会在登录时提示。" wide>{editor&&<form onSubmit={e=>{e.preventDefault();const value=editor;void run('save',async()=>{await api('/announcements'+(value.id?'/'+value.id:''),value.id?'PATCH':'POST',{title:value.title,content:value.content,pinned:value.pinned});setEditor(null);notify(value.id?'告示已更新':'告示已发布');});}}>
   <Field label="告示标题"><input autoFocus required maxLength={100} value={editor.title} onChange={e=>setEditor({...editor,title:e.target.value})} placeholder="例如：本周练习安排" disabled={!!busy}/></Field><Field label="告示正文" hint="可换行，支持 Markdown 和数学公式。"><textarea required maxLength={20000} rows={9} value={editor.content} onChange={e=>setEditor({...editor,content:e.target.value})} placeholder="把要告诉同学们的消息写在这里…" disabled={!!busy}/></Field><label className="checkbox"><input type="checkbox" checked={editor.pinned} onChange={e=>setEditor({...editor,pinned:e.target.checked})} disabled={!!busy}/>置顶，让这条告示排在最前面</label>
   {editor.content.trim()&&<details className="announcement-edit-preview"><summary>预览正文</summary><MathText text={editor.content}/></details>}{error&&<div className="notice error" role="alert">{error}</div>}<div className="modal-foot"><Button type="button" variant="outline" disabled={!!busy} onClick={()=>setEditor(null)}>取消</Button><Button busy={busy==='save'} disabled={!!busy||!editor.title.trim()||!editor.content.trim()}><Send size={15}/>{editor.id?'保存修改':'发布告示'}</Button></div>
  </form>}</Modal>
 </>;
}
