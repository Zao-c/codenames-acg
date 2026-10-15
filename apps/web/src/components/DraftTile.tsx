import { useEffect, useRef } from 'react';
import { TEAM_LABELS, type AnimeWork } from '@acg-codenames/shared';
import { Cover } from './AnimeBoard';
export function DraftTile({ work, claim, time, bookmark, canEdit, onTap, onLong, onPreview, onBookmark }: { work: AnimeWork; claim?: import('@acg-codenames/shared').DraftClaim; time:number; bookmark?:boolean; canEdit:boolean; onTap:()=>void; onLong:()=>void; onPreview:()=>void; onBookmark?:()=>void }) {
  const press = useRef<{ timer:number; x:number; y:number; fired:boolean } | undefined>(undefined);
  const suppress = useRef(false);
  const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = undefined; };
  useEffect(() => cancel,[]);
  return <article className={`draft-tile role-${claim?.team ?? 'hidden'}`}>
    <button draggable={canEdit} onDragStart={e => { cancel(); suppress.current = true; e.dataTransfer.setData('text/plain',String(work.id)); }} onContextMenu={e => e.preventDefault()}
      onPointerDown={e => { suppress.current = false; if (!canEdit) return; press.current = {x:e.clientX,y:e.clientY,fired:false,timer:window.setTimeout(() => { suppress.current=true; onLong(); },550)}; }}
      onPointerMove={e => { if (press.current && Math.hypot(e.clientX-press.current.x,e.clientY-press.current.y)>10) { suppress.current=true; cancel(); } }} onPointerCancel={() => { suppress.current=true; cancel(); }} onPointerUp={cancel}
      onClick={() => { if (!suppress.current) onTap(); suppress.current=false; }} aria-label={work.title}>
      <Cover work={work}/><span>{work.title}</span>
      {claim && <small>{TEAM_LABELS[claim.team]}{claim.kind === 'interference' ? ' · 干扰' : ''}{claim.protectedUntil > time ? ` · 保护 ${Math.ceil((claim.protectedUntil-time)/1000)}s` : ''}</small>}
    </button><div><button onClick={onPreview}>详情</button>{onBookmark && <button aria-label={`${bookmark ? '取消':'添加'}书签 ${work.title}`} onClick={onBookmark}>{bookmark ? '★':'☆'}</button>}</div>
  </article>;
}
