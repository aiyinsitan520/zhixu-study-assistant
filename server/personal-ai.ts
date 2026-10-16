import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import type {Store} from './store.ts';
import type {FastifyInstance} from 'fastify';
export const personalProviders=[
 {baseUrl:'https://api.openai.com/v1',name:'OpenAI'},
 {baseUrl:'https://api.deepseek.com/v1',name:'DeepSeek'},
 {baseUrl:'https://open.bigmodel.cn/api/paas/v4',name:'智谱 GLM'},
 {baseUrl:'https://api.moonshot.cn/v1',name:'Moonshot KIMI'},
 {baseUrl:'https://api.moonshot.ai/v1',name:'Moonshot 国际'},
];
type PersonalAI={provider:'beta'|'own';baseUrl:string;model:string;visionModel:string;key:string};
export function readPersonalAI(store:Store,userId:string):PersonalAI{const p=join(store.root,'user-ai-keys.json'),all=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{};return {provider:'beta',baseUrl:personalProviders[0].baseUrl,model:'',visionModel:'',key:'',...all[userId]};}
export function personalAISettings(app:FastifyInstance,store:Store){
 const user=(req:any)=>{if(!req.user||req.user.guest)throw Object.assign(new Error('请先注册或登录'),{statusCode:403});return req.user;};
 app.get('/api/ai/personal',req=>{const c=readPersonalAI(store,user(req).id);return {...c,key:undefined,hasKey:!!c.key,providers:personalProviders};});
 app.put('/api/ai/personal',req=>{const u=user(req),v=z.object({provider:z.enum(['beta','own']),baseUrl:z.string().refine(v=>personalProviders.some(p=>p.baseUrl===v)),model:z.string().max(200),visionModel:z.string().max(200).default(''),key:z.string().max(2000).optional(),clearKey:z.boolean().optional()}).parse(req.body),old=readPersonalAI(store,u.id),key=v.clearKey?'':v.key||old.key;if(v.provider==='own'&&(!key||!v.model))throw new Error('使用自己的 API 需要填写 Key 和文字模型');const file=join(store.root,'user-ai-keys.json'),all=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};all[u.id]={provider:v.provider,baseUrl:v.baseUrl,model:v.model,visionModel:v.visionModel,key};writeFileSync(file+'.tmp',JSON.stringify(all),{mode:0o600});renameSync(file+'.tmp',file);return {ok:true};});
}
