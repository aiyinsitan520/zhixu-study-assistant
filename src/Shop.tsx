import {useEffect,useState} from 'react';
import {Check,Coins,Gift,Lock,Palette,ShieldCheck,Sparkles,Trophy} from 'lucide-react';
import type {Skin} from '../shared/skins';
import type {Leaderboard as LeaderboardData} from '../shared/community';
import {api} from './lib';
import {Button,Empty} from './ui';
import {useUser} from './Auth';

export type Wallet={id:string;coins:number;earned:number;owned:string[];activeSkin:string;credited:string[];createdAt:string};
type ShopData={skins:Skin[];wallet:Wallet};

/** Applies the palette before React paints, so a reload never flashes the default skin. */
export function applySkin(id:string){document.documentElement.dataset.skin=id;localStorage.setItem('study-skin',id);}
export function storedSkin(){return localStorage.getItem('study-skin')||'forest';}

export function Shop({notify}:{notify:(s:string)=>void}){
  const [data,setData]=useState<ShopData|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const load=async()=>{try{setData(await api<ShopData>('/shop'));}catch(e){setError((e as Error).message);}};
  useEffect(()=>{void load();},[]);
  const act=async(key:string,fn:()=>Promise<{wallet:Wallet;purchased?:boolean}>,ok:(r:{purchased?:boolean})=>string)=>{setBusy(key);setError('');try{const r=await fn();setData(d=>d?{...d,wallet:r.wallet}:d);applySkin(r.wallet.activeSkin);notify(ok(r));}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  if(!data)return <div className="panel"><Empty icon={Palette} title="正在打开商店…" description={error||'读取你的金币与已解锁皮肤。'}/></div>;
  const {wallet}=data;
  return <>
    <div className="page-heading"><div><span className="eyebrow">EARN, THEN MAKE IT YOURS</span><h1>用每一道题，换来自己的颜色</h1><p>答对一道题并领取奖励可获得 10 金币，金币累积后可解锁皮肤。</p></div><Palette className="page-illustration" size={42}/></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    <section className="panel wallet-panel"><div className="wallet-balance"><div className="wallet-coin"><Coins size={24}/></div><div><span className="eyebrow">我的金币</span><strong>{wallet.coins}</strong><p className="subtle">累计获得 {wallet.earned} 金币 · 已解锁 {wallet.owned.length} / {data.skins.length} 套皮肤</p></div></div><div className="row"><span className="tag green"><ShieldCheck size={13}/>每道题只发放一次</span></div></section>
    <h3 className="section-title">皮肤商店</h3>
    <div className="shop-grid">{data.skins.map(skin=>{const owned=wallet.owned.includes(skin.id),active=wallet.activeSkin===skin.id,short=wallet.coins<skin.cost;return <article className="panel skin-card" key={skin.id}>
      <div className="skin-preview" style={{background:skin.swatch[2]}}><div className="skin-preview-bar" style={{background:skin.swatch[0]}}/><div className="skin-preview-row"><span className="skin-preview-dot" style={{background:skin.swatch[1]}}/><span className="skin-preview-line" style={{background:skin.swatch[0]}}/></div><div className="skin-preview-row"><span className="skin-preview-dot" style={{background:skin.swatch[0]}}/><span className="skin-preview-line" style={{background:skin.swatch[1]}}/></div><div className="skin-preview-row"><span className="skin-preview-line" style={{background:skin.swatch[1]}}/></div></div>
      <div className="row spread"><h3>{skin.name}</h3><span className="skin-swatch">{skin.swatch.map(c=><i key={c} style={{background:c}}/>)}</span></div>
      <p>{skin.tagline}</p>
      <div className="skin-card-foot">{active?<span className="skin-active"><Check size={14}/> 使用中</span>:skin.cost===0?<span className="skin-price free">默认皮肤</span>:<span className="skin-price">{owned?<><Check size={13}/> 已解锁</>:<><Coins size={13}/> {skin.cost} 金币</>}</span>}
        {active?null:owned?<Button size="sm" variant="outline" busy={busy===skin.id} disabled={!!busy} onClick={()=>act(skin.id,()=>api(`/shop/active`,'POST',{id:skin.id}),()=>`已切换到「${skin.name}」`)}>使用这套皮肤</Button>:<Button size="sm" busy={busy===skin.id} disabled={!!busy||short} onClick={()=>act(skin.id,()=>api(`/shop/skins/${skin.id}`,'POST'),r=>r.purchased?`已解锁「${skin.name}」，并已切换`:`已切换到「${skin.name}」`)}>{short?<><Lock size={14}/> 还差 {skin.cost-wallet.coins}</>:<><Gift size={14}/> 解锁</>}</Button>}</div>
    </article>;})}</div>
    <p className="knowledge-help">皮肤只改变界面的配色，不会影响题目、作答记录和已获得的积分。金币与皮肤保存在你自己的账号里，切换设备后仍然有效。</p>
  </>;
}

export function Leaderboard(){
  const user=useUser();
  const [data,setData]=useState<LeaderboardData|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=async()=>{try{setData(await api<LeaderboardData>('/leaderboard'));}catch(e){setError((e as Error).message);}};
  useEffect(()=>{void load();},[]);
  const toggle=async()=>{if(!data)return;setBusy(true);setError('');try{await api('/profile','PUT',{anonymous:!data.anonymous});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  if(!data)return <div className="panel"><Empty icon={Trophy} title="正在统计排行榜…" description={error||'汇总大家的练习人数与正确率。'}/></div>;
  const medal=(i:number)=>i===0?'🥇':i===1?'🥈':i===2?'🥉':String(i+1);
  return <>
    <div className="page-heading"><div><span className="eyebrow">LEARN TOGETHER</span><h1>一起刷题的同学们</h1><p>只统计已提交的作答记录；正确率按全部提交计算，含待判分。</p></div><Trophy className="page-illustration" size={42}/></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    <section className="panel wallet-panel"><div className="wallet-balance"><div className="wallet-coin"><Sparkles size={22}/></div><div><span className="eyebrow">参与统计</span><strong>{data.participants}</strong><p className="subtle">位同学已经提交过作答{data.me?` · 你已提交 ${data.me.attempts} 次，正确率 ${data.me.accuracy}%`:' · 你还没有提交记录'}</p></div></div>
      <label className="leaderboard-anon"><input type="checkbox" checked={data.anonymous} disabled={busy} onChange={()=>void toggle()}/>匿名参与排行榜<small>开启后其他同学只会看到「匿名同学」</small></label></section>
    {!data.entries.length?<div className="panel"><Empty icon={Trophy} title="还没有人上榜" description="提交一次解答后，你就会出现在这里。"/></div>:<section className="panel leaderboard-list">
      <div className="leaderboard-head"><span>名次</span><span>同学</span><span>答对题数</span><span>正确率</span><span>练习次数</span></div>
      {data.entries.map((e,i)=><div className={'leaderboard-row '+(e.me?'me':'')} key={e.userId}><span className={'leaderboard-rank '+(i<3?'top':'')}>{medal(i)}</span><span className="leaderboard-who"><strong>{e.name}{e.me?' （你）':''}</strong><small>{e.role==='admin'?'管理员':'学习成员'}{e.anonymous?' · 已匿名':''} · 活跃 {e.activeDays} 天</small></span><span className="leaderboard-metric">{e.correct}<small>道题</small></span><span className="leaderboard-metric">{e.accuracy}<small>%</small></span><span className="leaderboard-metric">{e.attempts}<small>次</small></span></div>)}
    </section>}
    <p className="knowledge-help">排行榜展示同学之间的练习情况，用于互相鼓励。你的作答内容、错题和草稿始终只有自己可见，其他同学只能看到这里的统计数字。</p>
  </>;
}
