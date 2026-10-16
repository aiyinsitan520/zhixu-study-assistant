import { clsx,type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {personalRoute,storageUser,storageMode,mirrorDraft,recoverDraft} from './personal-storage';
export const cn=(...v:ClassValue[])=>twMerge(clsx(v));
export async function api<T=any>(url:string,method='GET',data?:unknown):Promise<T>{
  const local=await personalRoute(url,method,data,serverApi);if(local)return local.value;
  const draft=url.match(/^\/questions\/([^/]+)\/draft$/);if(draft&&['PUT','POST'].includes(method))await mirrorDraft(draft[1],data);
  const result=await serverApi<T>(url,method,data),detail=url.match(/^\/questions\/([^/]+)$/);if(detail&&method==='GET'&&storageMode()==='server'&&(result as any).draft)(result as any).draft=await recoverDraft(detail[1],(result as any).draft);return result;
}
export async function serverApi<T=any>(url:string,method='GET',data?:unknown):Promise<T>{
  const form=data instanceof FormData;
  const r=await fetch('/api'+url,{method,headers:!form&&data!==undefined?{'Content-Type':'application/json'}:undefined,body:data===undefined?undefined:form?data:JSON.stringify(data)});
  let result:any;try{result=await r.json();}catch{throw new Error('服务响应异常，请确认本地服务仍在运行');}
  if(r.status===401&&!url.startsWith('/auth/')){location.reload();throw new Error('登录已过期');}if(!r.ok)throw new Error(result.error||'操作失败');if(url.startsWith('/auth/')&&result.user)storageUser(result.user.id);return result;
}
export const formatDate=(v:string)=>new Date(v).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
