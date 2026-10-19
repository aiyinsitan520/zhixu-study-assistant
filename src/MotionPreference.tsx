import {useState} from 'react';
import {Waves} from 'lucide-react';
export function applyMotion(){document.documentElement.dataset.motion=localStorage.getItem('study-motion')==='off'?'off':'on';}
document.addEventListener('keydown',()=>{document.documentElement.dataset.input='keyboard';},{capture:true});
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.input='pointer';},{capture:true});
export function MotionPreference(){const [enabled,setEnabled]=useState(()=>localStorage.getItem('study-motion')!=='off');return <button className="motion-preference" aria-label="界面动态效果" aria-pressed={enabled} title="系统开启减少动态效果时，会自动使用静态显示" onClick={()=>{const next=!enabled;localStorage.setItem('study-motion',next?'on':'off');applyMotion();setEnabled(next);}}><Waves size={15}/><span>动效{enabled?'开':'关'}</span></button>;}
