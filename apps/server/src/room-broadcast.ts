/** Batch committed room mutations into one fresh, privacy-filtered projection.
 * Callers resolve after the pass covering their request, never after an
 * unbounded stream becomes quiet. No room contents are retained here. */
export class RoomBroadcastQueue {
  private jobs=new Map<string,{running:boolean;waiters:Array<{resolve:()=>void;reject:(error:unknown)=>void}>}>();
  constructor(private publish:(roomId:string)=>Promise<void>,private delayMs=16){}
  send(roomId:string):Promise<void>{
    let job=this.jobs.get(roomId);
    if(!job){job={running:false,waiters:[]};this.jobs.set(roomId,job);}
    const current=job;
    const result=new Promise<void>((resolve,reject)=>current.waiters.push({resolve,reject}));
    if(!current.running){current.running=true;setTimeout(()=>void this.flush(roomId,current),this.delayMs);}
    return result;
  }
  private async flush(roomId:string,job:{running:boolean;waiters:Array<{resolve:()=>void;reject:(error:unknown)=>void}>}){
    const batch=job.waiters.splice(0);
    try{await this.publish(roomId);for(const waiter of batch)waiter.resolve();}
    catch(error){for(const waiter of batch)waiter.reject(error);}
    if(job.waiters.length)setTimeout(()=>void this.flush(roomId,job),this.delayMs);
    else{job.running=false;this.jobs.delete(roomId);}
  }
}
