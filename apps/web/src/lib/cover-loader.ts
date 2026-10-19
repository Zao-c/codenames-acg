// One backup request per tab leaves HTTP/1.1 connections available for game actions.
let active=false;
const queue:(()=>void)[]=[];
export async function probeCover(source:string,signal:AbortSignal):Promise<void>{
  await new Promise<void>((resolve,reject)=>{
    const aborted=()=>{const index=queue.indexOf(start);if(index>=0)queue.splice(index,1);reject(new DOMException('Aborted','AbortError'));};
    const start=()=>{signal.removeEventListener('abort',aborted);active=true;resolve();};
    if(signal.aborted){aborted();return;}
    if(active){queue.push(start);signal.addEventListener('abort',aborted,{once:true});}else start();
  });
  try{
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    await new Promise<void>((resolve,reject)=>{
      const image=new Image();image.referrerPolicy='no-referrer';
      const stop=(error?:Error)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);image.onload=null;image.onerror=null;if(error){image.src='';reject(error);}else resolve();};
      const abort=()=>stop(new DOMException('Aborted','AbortError'));
      const timer=setTimeout(()=>stop(new Error('Cover timeout')),15_000);
      signal.addEventListener('abort',abort,{once:true});
      image.onload=()=>image.naturalWidth>0?stop():stop(new Error('Invalid image'));
      image.onerror=()=>stop(new Error('Cover unavailable'));image.src=source;
    });
  }finally{active=false;queue.shift()?.();}
}
