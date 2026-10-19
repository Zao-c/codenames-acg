const abortError=()=>new DOMException('Aborted','AbortError');
const isBgm=(source:string)=>/^https:\/\/lain\.(bgm|bangumi)\.tv\//.test(source);
type Lane='bgm'|'remote'|'local';
type Task={source:string;lane:Lane;priority:number;start:()=>void;cancel:()=>void};
/** Keeps image traffic bounded and leaves same-origin HTTP connections for actions. */
export class ImageRequestQueue {
 private active:Record<Lane,number>={bgm:0,remote:0,local:0};private queue:Task[]=[];
 readonly metrics={started:0,cancelled:0,maxLocal:0,maxRemote:0};
 constructor(private image:()=>HTMLImageElement=()=>new Image(),private limits={bgm:3,remote:3,local:1}){}
 private lane(source:string):Lane{try{const url=new URL(source,typeof location==='undefined'?'http://localhost/':location.href);return url.pathname.startsWith('/api/')||typeof location!=='undefined'&&url.origin===location.origin?'local':isBgm(source)?'bgm':'remote';}catch{return 'remote';}}
 load(source:string,signal:AbortSignal,priority:number,timeoutMs:number):Promise<string>{
  return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(abortError());return;}
   const lane=this.lane(source);let active=false,settled=false,image:HTMLImageElement|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   const stop=(error?:Error)=>{
    if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
    const index=this.queue.indexOf(task);if(index>=0)this.queue.splice(index,1);
    if(image){image.onload=null;image.onerror=null;image.src='';}
    if(active){this.active[lane]--;active=false;}
    error?reject(error):resolve(source);this.pump();
   };
   const abort=()=>{this.metrics.cancelled++;stop(abortError());};
   const task:Task={source,lane,priority,cancel:abort,start:()=>{
    active=true;this.active[lane]++;this.metrics.started++;this.metrics.maxLocal=Math.max(this.metrics.maxLocal,this.active.local);this.metrics.maxRemote=Math.max(this.metrics.maxRemote,this.active.bgm+this.active.remote);
    image=this.image();image.referrerPolicy='no-referrer';image.decoding='async';image.fetchPriority=priority===0?'auto':'low';
    image.onload=()=>image!.naturalWidth>0?stop():stop(new Error('Invalid cover'));image.onerror=()=>stop(new Error('Cover unavailable'));
    timer=setTimeout(()=>stop(new Error('Cover timeout')),timeoutMs);image.src=source;
   }};
   if(this.queue.length>=96){reject(new Error('Image queue full'));return;}
   signal.addEventListener('abort',abort,{once:true});this.queue.push(task);this.pump();
  });
 }
 private pump(){for(;;){this.queue.sort((a,b)=>a.priority-b.priority);const index=this.queue.findIndex(task=>this.active[task.lane]<this.limits[task.lane]);if(index<0)return;this.queue.splice(index,1)[0].start();}}
 stats(){return {...this.metrics,active:{...this.active},queued:this.queue.length};}
}
