import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {Store,id,now} from './store.ts';
import {skins,skinById,skinIds,defaultSkin} from '../shared/skins.ts';
import type {FeedbackAward} from '../shared/feedback.ts';

const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const WALLET_ID='wallet',PROFILE_ID='profile';
export type Wallet={id:string;coins:number;earned:number;owned:string[];activeSkin:string;credited:string[];createdAt:string;updatedAt?:string};
export type Profile={id:string;anonymous:boolean;updatedAt?:string};
export const COINS_PER_REWARD=10;
const emptyWallet=():Wallet=>({id:WALLET_ID,coins:0,earned:0,owned:[defaultSkin],activeSkin:defaultSkin,credited:[],createdAt:now()});
export const readWallet=(store:Store):Wallet=>{
  const raw=store.get<Wallet>('wallet',WALLET_ID);
  const base=raw||emptyWallet(),owner=store.context.getStore()?.id||'local';
  const ledger=store.db.prepare('SELECT skinId,createdAt FROM skin_grants WHERE userId=?').all(owner);
  for(const grant of ledger)store.context.exit(()=>{const id=`gift-${owner}-${grant.skinId}`;if(!store.get('skinGrants',id))store.put('skinGrants',{id,ownerId:owner,skinId:String(grant.skinId),createdAt:String(grant.createdAt)});});
  const grants=store.context.exit(()=>store.all<{id:string;ownerId:string;skinId:string}>('skinGrants').filter(g=>g.ownerId===owner&&skinIds.has(g.skinId)).map(g=>g.skinId));
  const owned=[...new Set([defaultSkin,...(base.owned||[]).filter(s=>skinIds.has(s)),...grants])];
  return {...base,owned,credited:base.credited||[],activeSkin:owned.includes(base.activeSkin)?base.activeSkin:defaultSkin,coins:Math.max(0,Math.floor(base.coins||0)),earned:Math.max(0,Math.floor(base.earned||0))};
};
export const readProfile=(store:Store):Profile=>store.get<Profile>('profile',PROFILE_ID)||{id:PROFILE_ID,anonymous:false};
export function reconcileFeedbackRewards(store:Store){
 const uid=store.context.getStore()?.id;let w=readWallet(store);if(!uid)return w;const count=w.credited.length;
 for(const award of store.all<FeedbackAward>('feedbackAwards').filter(a=>a.ownerId===uid))if(!w.credited.includes(award.id))w={...w,coins:w.coins+award.coins,earned:w.earned+award.coins,credited:[...w.credited,award.id]};
 return w.credited.length===count?w:store.put('wallet',w);
}
/** Credits coins once per question, so re-claiming a reward can never mint coins twice. */
export function creditReward(store:Store,questionId:string){
  const w=readWallet(store);
  if(w.credited.includes(questionId))return w;
  return store.put('wallet',{...w,coins:w.coins+COINS_PER_REWARD,earned:w.earned+COINS_PER_REWARD,credited:[...w.credited,questionId]});
}
export function shopRoutes(app:FastifyInstance,store:Store){
 store.db.exec('CREATE TABLE IF NOT EXISTS skin_grants(userId TEXT NOT NULL,skinId TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(userId,skinId));');
 app.get('/api/shop',()=>({skins,wallet:reconcileFeedbackRewards(store)}));
 app.post('/api/shop/skins/:id',async(req:any)=>{
  const skin=skinById(z.object({id:z.string().max(40)}).parse(req.params).id);
  if(!skin)throw fail('皮肤不存在',404);
  return store.transaction(()=>{
   const w=readWallet(store);
   if(skin.promotion==='beta'&&skin.cost===0){const owner=store.context.getStore()?.id||'local';store.db.prepare('INSERT OR IGNORE INTO skin_grants VALUES(?,?,?)').run(owner,skin.id,now());store.context.exit(()=>{const id=`gift-${owner}-${skin.id}`;if(!store.get('skinGrants',id))store.put('skinGrants',{id,ownerId:owner,skinId:skin.id,createdAt:now()});});}
   if(w.owned.includes(skin.id))return {wallet:store.put('wallet',{...w,activeSkin:skin.id}),purchased:false};
   if(w.coins<skin.cost)throw fail(`还需要 ${skin.cost-w.coins} 金币才能解锁「${skin.name}」`);
   return {wallet:store.put('wallet',{...w,coins:w.coins-skin.cost,owned:[...w.owned,skin.id],activeSkin:skin.id}),purchased:true};
  });
 });
 app.post('/api/shop/active',async req=>{
  const skin=skinById(z.object({id:z.string().max(40)}).parse(req.body).id);
  if(!skin)throw fail('皮肤不存在',404);
  const w=readWallet(store);
  if(!w.owned.includes(skin.id))throw fail('请先在商店解锁这套皮肤');
  return {wallet:store.put('wallet',{...w,activeSkin:skin.id})};
 });
 app.get('/api/profile',()=>readProfile(store));
 app.put('/api/profile',async req=>{
  const v=z.object({anonymous:z.boolean()}).parse(req.body);
  return store.put('profile',{...readProfile(store),anonymous:v.anonymous});
 });
}
