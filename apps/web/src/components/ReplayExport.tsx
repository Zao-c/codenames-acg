import { useEffect, useRef, useState } from 'react';
import type { GameReplay } from '@acg-codenames/shared';
import { Dialog } from './UI';
import { exportReplayPng, type ReplayExportOptions } from '../lib/replay-export';
export function ReplayExport({replay}:{replay:GameReplay}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[url,setUrl]=useState(''),[missing,setMissing]=useState(0);
  const [options,setOptions]=useState<ReplayExportOptions>({aspect:'4:3',theme:'light',nicknames:false});
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[replay.id]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  const generate=async()=>{const version=++generation.current;setBusy(true);setError('');setUrl('');try{const result=await exportReplayPng(replay,options);if(version!==generation.current)return;setUrl(URL.createObjectURL(result.blob));setMissing(result.missing);}catch(e){if(version===generation.current)setError((e as Error).message);}finally{if(version===generation.current)setBusy(false);}};
  return <><button onClick={()=>setOpen(true)}>导出棋盘 PNG</button>{open&&<Dialog title="导出公开棋盘" close={()=>setOpen(false)} wide><div className="replay-export-options"><label>比例<select disabled={busy} value={options.aspect} onChange={e=>{setOptions(o=>({...o,aspect:e.target.value as ReplayExportOptions['aspect']}));setUrl('');}}><option>4:3</option><option>16:9</option></select></label><label>背景<select disabled={busy} value={options.theme} onChange={e=>{setOptions(o=>({...o,theme:e.target.value as ReplayExportOptions['theme']}));setUrl('');}}><option value="light">浅色</option><option value="dark">深色</option></select></label><label><input type="checkbox" disabled={busy} checked={options.nicknames} onChange={e=>{setOptions(o=>({...o,nicknames:e.target.checked}));setUrl('');}}/>包含昵称（默认关闭）</label><button className="primary-button" disabled={busy} onClick={()=>void generate()}>{busy?'正在生成…':'生成 PNG'}</button></div><p className="hint-text">1600 × {options.aspect==='4:3'?'1200':'900'} · 全部 {replay.finalBoard.length} 张牌 · 包含公开终局信息</p>{error&&<p role="alert">{error}</p>}{url&&<><a href={url} download={`词牌结社-第${replay.roundNumber??'—'}局-${replay.mode.boardMode}.png`}>保存 PNG</a><p className="hint-text">手机也可长按下方图片保存。{missing>0?`${missing} 张封面暂不可用，已保留作品名与翻牌状态。`:''}</p><img className="replay-export-preview" src={url} alt="公开终局棋盘 PNG"/></>}</Dialog>}</>;
}
