export type Skin={id:string;name:string;tagline:string;cost:number;swatch:[string,string,string]};
export const skins:Skin[]=[
 {id:'forest',name:'森林原野',tagline:'默认配色：墨绿、纸白，和一点安静的光。',cost:0,swatch:['#365d48','#eef1eb','#f7f8f5']},
 {id:'ocean',name:'深海蓝',tagline:'像深夜的图书馆，冷静、专注、不打扰。',cost:120,swatch:['#2f5d78','#e9f0f5','#f6f9fb']},
 {id:'sakura',name:'樱花雾',tagline:'柔和的暖粉，适合慢慢读书的下午。',cost:180,swatch:['#a45a72','#f7ebef','#fdf7f9']},
 {id:'amber',name:'琥珀金',tagline:'温暖的秋色，让笔记有纸张的质感。',cost:240,swatch:['#96672c','#f5ecdd','#fbf7f0']},
 {id:'midnight',name:'午夜墨',tagline:'深靛蓝的冷色，夜里看久了也不刺眼。',cost:320,swatch:['#4a5f9e','#e9ebf4','#f6f7fb']},
 {id:'matrix',name:'矩阵绿',tagline:'终端风格的荧光绿，给刷题一点赛博感。',cost:420,swatch:['#2f7a4f','#e8f1ea','#f4f8f5']},
];
export const skinById=(id:string)=>skins.find(s=>s.id===id);
export const skinIds=new Set(skins.map(s=>s.id));
export const defaultSkin='forest';
