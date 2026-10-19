import {useEffect,useState} from 'react';
import {BookOpen,CheckCircle2,LoaderCircle} from 'lucide-react';
import {serverApi} from './lib';
export function ImportSolutionProgress({jobId}:{jobId:string}){
 const [data,setData]=useState<{total:number;ready:number;paused:boolean;items:{id:string;title:string;ready:boolean;status:string}[]}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;const load=()=>void serverApi('/imports/'+jobId+'/solutions').then(d=>{if(live){setData(d);setError('');}}).catch(e=>{if(live)setError(e.message);});load();const timer=setInterval(()=>{if(!document.hidden)load();},5000);return()=>{live=false;clearInterval(timer);};},[jobId]);
 return <section className="panel solution-admin"><div className="section-label"><BookOpen size={18}/>整份资料 · 答案与详细解析</div>{data?<><div className="solution-progress"><strong>{data.ready}<small> / {data.total} 道已存入数据库</small></strong><span>{data.ready===data.total?'全部完成，所有同学可直接查看':data.paused?'管理员已暂停':'正在上传后的自动解析流程中'}</span></div><progress max={data.total||1} value={data.ready}/><p className="subtle">离开页面也会继续。完成后查看不再调用 AI；遇到额度不足等待次日，失败任务在 API 管理中重试。</p><div className="import-solution-items">{data.items.map(q=><div key={q.id}><span>{q.title}</span><small>{q.ready?<><CheckCircle2 size={14}/>已入库</>:q.status==='running'?<><LoaderCircle size={14} className="spin"/>生成中</>:q.status==='waiting'?'等待管理员额度':q.status==='error'?'需要重试':'排队中'}</small></div>)}</div></>:<p className="subtle">读取整份资料的解析进度…</p>}{error&&<p role="alert" className="notice error">{error}</p>}</section>;
}
