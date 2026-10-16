import {useEffect,useRef,useState} from 'react';
import {BookOpen,Check,ChevronRight,Layers3,Sparkles,Square} from 'lucide-react';
import type {Question,QuestionInput} from '../shared/schema';
import {inferKnowledge,knowledgeChapters,knowledgeSources,knowledgeTopics,topicName} from '../shared/knowledge';
import {api} from './lib';
import {Button} from './ui';
import './knowledge.css';

export function KnowledgeTags({question}:{question:QuestionInput}){
 const points=question.knowledgeSource==='auto'||!question.knowledgeSource?inferKnowledge(question):question.knowledgePoints||[];
 return <span className="knowledge-tags">{points.length?points.slice(0,3).map(id=><span className="tag knowledge-tag" key={id}>{topicName(id)}</span>):<span className="knowledge-pending">待分类</span>}{points.length>3&&<small>+{points.length-3}</small>}</span>;
}
export function KnowledgeEditor({value,onChange}:{value:QuestionInput;onChange:(v:QuestionInput)=>void}){
 const source=value.knowledgeSource||'auto',points=source==='auto'?inferKnowledge(value):value.knowledgePoints||[];
 return <div className="field"><span>知识点分类</span><small>一道题可关联多个知识点（最多12个）。手动调整后，自动分类不会覆盖你的选择。</small><div className="knowledge-editor"><label className="checkbox"><input type="checkbox" checked={source==='auto'} onChange={e=>onChange({...value,knowledgeSource:e.target.checked?'auto':'manual',knowledgePoints:points})}/>根据题干自动分类</label><KnowledgeTags question={value}/><details><summary>手动选择知识点{source==='AI'?' · 当前为 AI 分类':''}</summary><div className="knowledge-editor-groups">{knowledgeChapters.map(c=><fieldset key={c.id}><legend>{c.name}</legend>{c.topics.map(t=><label className="checkbox" key={t.id}><input type="checkbox" checked={points.includes(t.id)} disabled={!points.includes(t.id)&&points.length>=12} onChange={e=>onChange({...value,knowledgeSource:'manual',knowledgePoints:e.target.checked?[...points,t.id]:points.filter(id=>id!==t.id)})}/>{t.name}</label>)}</fieldset>)}</div></details></div></div>;
}
export function KnowledgeFilters({chapter,point,onChapter,onPoint}:{chapter:string;point:string;onChapter:(v:string)=>void;onPoint:(v:string)=>void}){
 return <><select aria-label="筛选知识章节" value={chapter} onChange={e=>{onChapter(e.target.value);onPoint('');}}><option value="">全部知识章节</option>{knowledgeChapters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="筛选知识点" value={point} onChange={e=>{onPoint(e.target.value);if(e.target.value==='pending')onChapter('');}}><option value="">全部知识点</option><option value="pending">待分类</option>{knowledgeTopics.filter(t=>!chapter||t.chapterId===chapter).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></>;
}
export function KnowledgeBoard({questions,admin,onSelect,onRefresh,notify}:{questions:Question[];admin:boolean;onSelect:(chapter:string,point:string)=>void;onRefresh:()=>Promise<void>;notify:(v:string)=>void}){
 const active=questions.filter(q=>!q.deleted&&q.materialKind!=='page');
 const pending=active.filter(q=>!(q.knowledgePoints||[]).length);
 const eligible=pending.filter(q=>q.knowledgeSource!=='manual');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const cancelled=useRef(false);
 useEffect(()=>()=>{cancelled.current=true;},[]);
 const classify=async()=>{
  setBusy(true);setError('');cancelled.current=false;let done=0,total=0;
  try{for(let i=0;i<eligible.length;i+=20){if(cancelled.current)break;setStatus(`正在补充分组 ${i+1}–${Math.min(i+20,eligible.length)} / ${eligible.length}`);const result=await api<{classified:number}>('/knowledge/classify','POST',{ids:eligible.slice(i,i+20).map(q=>q.id)});done+=Math.min(20,eligible.length-i);total+=result.classified;await onRefresh();}setStatus(`已处理 ${done} 道，新增分类 ${total} 道。${cancelled.current?'已停止后续批次。':'无法确定的题目仍保留为待分类。'}`);notify(`已为 ${total} 道题补充知识点`);}catch(e){setError((e as Error).message);setStatus(`已处理 ${done} 道，已保存的分类会保留，可重试剩余题目。`);}finally{setBusy(false);}
 };
 return <><div className="page-heading"><div><span className="eyebrow">CONNECT THE DOTS</span><h1>按知识点，找到下一步</h1><p>从章节到具体方法，把散落的题目串成知识网络。</p></div><Layers3 className="page-illustration" size={42}/></div>
  <section className="panel knowledge-overview"><div><span className="eyebrow">高等数学 · 知识地图</span><h2>{active.length-pending.length}<small> / {active.length} 道题已分类</small></h2><p>导入与录题后自动识别；一道题可出现在多个知识点中。整页资料请先拆题。</p></div><div className="knowledge-overview-actions"><Button variant="outline" onClick={()=>onSelect('','pending')}>待分类 {pending.length}<ChevronRight size={15}/></Button>{admin&&(busy?<Button variant="outline" onClick={()=>{cancelled.current=true;setStatus('当前批次完成后停止…');}}><Square size={13}/>停止后续批次</Button>:<Button disabled={!eligible.length} onClick={()=>void classify()}><Sparkles size={15}/>AI 补充待分类</Button>)}</div></section>
  {admin&&<p className="knowledge-help">AI 补充使用站点已配置的解析模型，按每批最多20题处理并保存，会产生模型调用费用；手动选择的知识点会保留。</p>}
  {status&&<p className="notice" role="status">{busy&&<Sparkles size={14}/>} {status}</p>}{error&&<p className="notice error" role="alert">{error}</p>}
  <div className="knowledge-chapters">{knowledgeChapters.map((c,index)=>{const count=active.filter(q=>q.knowledgePoints?.some(id=>c.topics.some(t=>t.id===id))).length;return <section className="panel knowledge-chapter" key={c.id}><button className="knowledge-chapter-head" onClick={()=>onSelect(c.id,'')}><span className="knowledge-number">{String(index+1).padStart(2,'0')}</span><div><h2>{c.name}</h2><small>{count} 道题 · {c.topics.length} 个知识点</small></div><ChevronRight size={17}/></button><div className="knowledge-topic-list">{c.topics.map(t=>{const n=active.filter(q=>q.knowledgePoints?.includes(t.id)).length;return <button key={t.id} onClick={()=>onSelect(c.id,t.id)}><span>{t.name}</span><small>{n}</small></button>;})}</div></section>;})}</div>
  <details className="panel knowledge-references"><summary><BookOpen size={15}/>分类参考与说明</summary><p>以同济《高等数学》第八版上下册的12章为主线，结合习题集常见解题主题整理应用内标签。自动分类是学习辅助，管理员可在编辑题目中修订；无法判断时保留待分类。</p>{knowledgeSources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p><Check size={13}/>资料文件夹与知识点标签独立，原资料和作答记录均保留。</p></details>
 </>;
}
