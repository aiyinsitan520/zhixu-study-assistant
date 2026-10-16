import type {FastifyInstance} from 'fastify';
import {Store,decodeRecord} from './store.ts';
import {readProfile} from './shop.ts';
import type {Attempt,Reward} from '../shared/schema.ts';
import type {Auth} from './auth.ts';
import type {Leaderboard,LeaderboardEntry} from '../shared/community.ts';

/** Stable pseudonym so an anonymous classmate keeps the same label between visits. */
function alias(userId:string){
  let hash=0;for(const ch of userId)hash=(hash*31+ch.charCodeAt(0))>>>0;
  return `匿名同学 ${String(hash%10000).padStart(4,'0')}`;
}
function rows<T>(store:Store,kind:string){return store.db.prepare('SELECT data FROM records WHERE kind=?').all(kind).map(r=>decodeRecord(r.data as string) as T);}

export function leaderboardRoutes(app:FastifyInstance,store:Store,auth?:Auth){
  app.get('/api/leaderboard',req=>{
    if(!auth)return {participants:0,entries:[],me:null,anonymous:false} satisfies Leaderboard;
    const me=req.user!;
    const users=auth.db.prepare('SELECT id,name,role FROM users WHERE disabled=0 ORDER BY rowid').all() as {id:string;name:string;role:'admin'|'student'}[];
    const entries:LeaderboardEntry[]=[];
    for(const user of users){
      const attempts=rows<Attempt>(store,`user-${user.id}:attempts`);
      if(!attempts.length)continue;
      const correct=attempts.filter(a=>a.correct===true).length;
      const points=rows<Reward>(store,`user-${user.id}:rewards`).reduce((n,r)=>n+r.points,0);
      const days=new Set(attempts.map(a=>new Date(a.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})));
      const profile=store.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(`user-${user.id}:profile`,'profile');
      const anonymous=!!(profile&&(decodeRecord(profile.data as string) as {anonymous?:boolean}).anonymous);
      const mine=user.id===me.id;
      entries.push({userId:user.id,name:anonymous&&!mine?alias(user.id):user.name,role:user.role,anonymous:anonymous&&!mine,attempts:attempts.length,correct,accuracy:Math.round(correct/attempts.length*100),activeDays:days.size,points,me:mine});
    }
    entries.sort((a,b)=>b.correct-a.correct||b.accuracy-a.accuracy||b.attempts-a.attempts||a.userId.localeCompare(b.userId));
    return {participants:entries.length,entries,me:entries.find(e=>e.me)||null,anonymous:readProfile(store).anonymous} satisfies Leaderboard;
  });
}
