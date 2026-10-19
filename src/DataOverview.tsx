import {useEffect,useState} from 'react';
import {Database,ShieldCheck} from 'lucide-react';
import {api,formatDate} from './lib';
import {Button} from './ui';
export function DataOverview(){
 const [data,setData]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=()=>api('/data-overview').then(setData).catch(e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 return <section className="panel settings-panel"><div className="section-label"><Database size={18}/>数据库与自动备份</div>{error&&<p className="notice error">{error}</p>}{data&&<><div className="check-row"><span>共享 / 个人题目</span><span>{data.questions.shared} / {data.questions.personal}</span></div><div className="check-row"><span>已有共享解析</span><span>{data.questions.withSharedExplanation}</span></div><div className="check-row"><span>AI 结果归档</span><span>{data.aiResults}</span></div><div className="check-row"><span>原始资料与作答附件</span><span>{data.attachments.count} 份 · {(data.attachments.bytes/1024/1024).toFixed(1)} MB</span></div><p className="subtle"><ShieldCheck size={14}/> 新资料和 AI 结果自动落库，重复查看不调用 AI。私人资料按账号隔离；自动快照保留最近 7 份，不含 API Key。</p><div className="check-row"><span>最近自动快照</span><span>{data.backup.lastBackup?formatDate(data.backup.lastBackup):'准备首次备份'}</span></div><code className="path-display">{data.backup.directory}</code>{data.backup.error&&<p className="notice error">备份待重试：{data.backup.error}</p>}<Button variant="outline" busy={busy} disabled={busy||data.backup.running} onClick={async()=>{setBusy(true);setError('');try{await api('/data-snapshot','POST');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>立即保存快照</Button></>}</section>;
}
