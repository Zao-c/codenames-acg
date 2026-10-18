import { useEffect, useRef, type ReactNode } from 'react';

export function Icon({ name, size = 20 }: { name: 'cards'|'home'|'users'|'chat'|'sun'|'moon'|'sound'|'mute'|'settings'|'arrow'|'close'|'book'; size?: number }) {
 const paths: Record<typeof name, ReactNode> = {
  cards: <><rect x="6" y="5" width="13" height="16" rx="2"/><path d="m3 17-1-13 13-2M10 10h5m-5 4h5"/></>,
  home: <><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/></>,
  chat: <path d="M21 4H3v14h4v4l5-4h9ZM7 9h10M7 13h7"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
  moon: <path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>,
  sound: <><path d="m3 9 5 0 5-5v16l-5-5H3ZM17 8a7 7 0 0 1 0 8m3-11a11 11 0 0 1 0 14"/></>,
  mute: <path d="m3 9 5 0 5-5v16l-5-5H3Zm14 1 5 5m0-5-5 5"/>,
  settings: <><path d="M3 6h18M3 12h18M3 18h18"/><path d="M8 3v6m8 0v6m-8 0v6"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  book: <><path d="M12 5Q7 2 2 4v16q5-2 10 1 5-3 10-1V4q-5-2-10 1Zm0 0v16"/></>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Dialog({ title, close, children, wide = false, className='', closeDisabled=false }: { title: string; close: () => void; children: ReactNode; wide?: boolean; className?:string; closeDisabled?:boolean }) {
 const ref=useRef<HTMLDivElement>(null);
 const onClose=useRef(close);onClose.current=close;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  ref.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.stopPropagation();onClose.current();}
   if(e.key==='Tab'){
    const items=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first?.focus();}
   }
  };
  ref.current?.addEventListener('keydown',key);
  const node=ref.current;
  return()=>{node?.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 return <div className="dialog-backdrop" onClick={close}><div className={`dialog-sheet ${wide?'dialog-wide':''} ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e=>e.stopPropagation()}><header className="dialog-heading"><h2>{title}</h2><button disabled={closeDisabled} aria-label={`关闭${title}`} onClick={close}><Icon name="close"/></button></header>{children}</div></div>;
}
