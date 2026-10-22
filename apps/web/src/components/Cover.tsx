import {memo,useEffect,useRef,useState} from 'react';
import type {AnimeWork} from '@acg-codenames/shared';
import {forgetCover,loadCover,loadedCoverSource} from '../lib/cover-loader';

type Work=Pick<AnimeWork,'id'|'title'|'cover'>;
function CoverImage({work}:{work:Work}){
 const [source,setSource]=useState(()=>loadedCoverSource(work)),[near,setNear]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const image=useRef<HTMLImageElement>(null),priority=useRef(0);
 useEffect(()=>{
  const element=image.current?.parentElement;if(!element)return;
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){priority.current=entry.boundingClientRect.top<innerHeight&&entry.boundingClientRect.bottom>0?0:1;setNear(entry.isIntersecting);}},{rootMargin:'80px'});
  observer.observe(element);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!near||!work.cover||source)return;
  let live=true;const controller=new AbortController();setFailed(false);
  void loadCover(work,controller.signal,priority.current).then(value=>{if(live){setSource(value);setFailed(false);}}).catch(()=>{if(live&&!controller.signal.aborted)setFailed(true);});
  return()=>{live=false;controller.abort();};
 },[near,work.id,work.cover,retry,source]);
 useEffect(()=>{
  if(!failed||!near)return;
  const timer=setTimeout(()=>{forgetCover(work);setRetry(n=>n+1);},10000);
  return()=>clearTimeout(timer);
 },[failed,near,work.id,work.cover,retry]);
 if(!work.cover)return <span className="anime-cover-fallback">{work.title}</span>;
 return <>
  <img ref={image} src={source} alt="" draggable={false} loading={near?'eager':'lazy'} decoding="async" className="cover-image" data-cover-state={source?'ready':failed?'failed':'loading'} style={!source?{opacity:0}:undefined} onError={()=>{forgetCover(work);setSource(undefined);setFailed(true);}}/>
  {!source&&<span className="anime-cover-fallback cover-load-status" onClick={()=>{forgetCover(work);setFailed(false);setRetry(n=>n+1);}}>{work.title}<small>{failed?'封面暂不可用 · 重试':'封面加载中…'}</small></span>}
 </>;
}
export const Cover=memo(function Cover({work}:{work:Work}){return <CoverImage key={`${work.id}:${work.cover}`} work={work}/>;},(a,b)=>a.work.id===b.work.id&&a.work.cover===b.work.cover&&a.work.title===b.work.title);
