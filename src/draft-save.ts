import type { Draft } from '../shared/schema';

export type DraftValue={answer:string;images:string[];revision:number};
type State={revision:number;pending?:DraftValue;tail:Promise<void>};

// Shared across Practice mounts so returning to a question waits for its previous save.
export class DraftSaver {
  private states=new Map<string,State>();
  constructor(private send:(id:string,value:DraftValue)=>Promise<Draft>){}
  private state(id:string){let state=this.states.get(id);if(!state){state={revision:0,tail:Promise.resolve()};this.states.set(id,state);}return state;}
  async settle(id:string){await this.state(id).tail.catch(()=>{});}
  open(id:string,remote:Draft):DraftValue{
    const state=this.state(id);state.revision=Math.max(state.revision,remote.revision??0);
    if(state.pending)return state.pending;
    return {answer:remote.answer,images:remote.images,revision:state.revision};
  }
  edit(id:string,value:{answer:string;images:string[]}):DraftValue{
    const state=this.state(id);const next={...value,images:[...value.images],revision:++state.revision};state.pending=next;return next;
  }
  pending(id:string){return this.state(id).pending;}
  save(id:string,value:DraftValue):Promise<void>{
    const state=this.state(id);
    const job=state.tail.catch(()=>{}).then(async()=>{
      const saved=await this.send(id,value);
      state.revision=Math.max(state.revision,saved.revision??0);
      if(saved.answer!==value.answer||JSON.stringify(saved.images)!==JSON.stringify(value.images))throw new Error('草稿已在其他页面更新，请保留当前内容并重新打开题目');
      if(state.pending?.revision===value.revision)state.pending=undefined;
    });
    state.tail=job;return job;
  }
}
