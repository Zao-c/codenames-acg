import { memo, useEffect, useRef, useState } from 'react';
import type { AnimeWork } from '@acg-codenames/shared';
import { resolveAnimeAssetUrl } from '../lib/api';
import { probeCover } from '../lib/cover-loader';

type Work = Pick<AnimeWork, 'id'|'title'|'cover'>;
function cachedSource(work: Work) {
  if (!/^https:\/\/lain\.(bgm|bangumi)\.tv\//.test(work.cover)) return null;
  let hash = 2166136261;
  for (const c of work.cover) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return resolveAnimeAssetUrl(`/api/anime/cover/${work.id}?v=${hash >>> 0}`);
}
function CoverImage({ work }: { work: Work }) {
  const direct = resolveAnimeAssetUrl(work.cover), backup = cachedSource(work);
  const [replacement, setReplacement] = useState<string>(), [failed, setFailed] = useState(false), [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [waiting,setWaiting]=useState(false);
  const image = useRef<HTMLImageElement>(null), loaded = useRef(false);
  useEffect(() => {
    const element=image.current?.parentElement??image.current;if(!element)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'120px'});
    observer.observe(element);return()=>observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !work.cover) return;
    let live=true;const controller=new AbortController();
    // Keep the original request alive; switch only to an already loaded backup.
    const timer=window.setTimeout(async()=>{
      if(live&&!loaded.current)setWaiting(true);
      for(const candidate of backup?[backup,direct]:[direct]){
        if(!live||loaded.current)return;
        try{await probeCover(candidate,controller.signal);if(live&&!loaded.current){loaded.current=true;setReplacement(candidate);setFailed(false);setWaiting(false);}return;}
        catch{/* A failed backup must never cancel the original image. */}
      }
    },failed?500:3000);
    return()=>{live=false;clearTimeout(timer);controller.abort();};
  },[visible,direct,backup,failed,retry]);
  if(!work.cover)return <span className="anime-cover-fallback">{work.title}</span>;
  return <>
    <img ref={image} src={replacement??direct} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={failed||waiting?{display:'none'}:undefined} onLoad={()=>{loaded.current=true;setFailed(false);setWaiting(false);}} onError={()=>{if(!loaded.current)setFailed(true);}}/>
    {(failed||waiting)&&<span className="anime-cover-fallback" title={failed?'封面暂不可用，点击重试':'封面加载较慢，原图仍在加载，可点击重试'} onClick={()=>{loaded.current=false;setRetry(n=>n+1);}}>{work.title}<small>{failed?'封面暂不可用 · 点此重试':'封面加载中…'}</small></span>}
  </>;
}
export const Cover = memo(function Cover({work}:{work:Work}){return <CoverImage key={`${work.id}:${work.cover}`} work={work}/>;},(a,b)=>a.work.id===b.work.id&&a.work.cover===b.work.cover&&a.work.title===b.work.title);
