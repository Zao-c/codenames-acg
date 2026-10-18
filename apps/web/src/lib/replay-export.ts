import type { GameReplay } from '@acg-codenames/shared';
import { resolveAnimeAssetUrl } from './api';
import { roleLabel } from './replay-board';

export interface ReplayExportOptions { aspect: '4:3'|'16:9'; theme:'light'|'dark'; nicknames:boolean }
const colors:Record<string,string>={red:'#b83844',blue:'#286ba7',neutral:'#827967',assassin:'#292736'};
async function coverImage(replay:GameReplay, card:GameReplay['finalBoard'][number]):Promise<HTMLImageElement|null>{
  if(!card.anime?.cover)return null;
  const load=(src:string):Promise<HTMLImageElement|null>=>new Promise(resolve=>{
    const img=new Image();img.crossOrigin='anonymous';
    const timer=setTimeout(()=>{img.src='';resolve(null);},5000);
    img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);resolve(null);};
    img.src=resolveAnimeAssetUrl(src);
  });
  // Bangumi CDN supports anonymous CORS. Prefer the same client network that
  // displays the cover, then use the bounded server-held URL fallback.
  const direct=await load(card.anime.cover);
  if(direct||!/^https?:/.test(card.anime.cover))return direct;
  return load(`/api/replays/${encodeURIComponent(replay.id)}/covers/${encodeURIComponent(card.id)}`);
}
export async function exportReplayPng(replay:GameReplay, options:ReplayExportOptions):Promise<{blob:Blob;missing:number}>{
  await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,1500))]);
  const images=await Promise.all(replay.finalBoard.map(c=>coverImage(replay,c)));
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=options.aspect==='4:3'?1200:900;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前浏览器不支持图片导出');
  const dark=options.theme==='dark',ink=dark?'#f3efe8':'#292b32',paper=dark?'#20232b':'#f6f3ed';
  ctx.fillStyle=paper;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.textBaseline='top';ctx.fillStyle=ink;ctx.font='bold 34px sans-serif';
  ctx.fillText(`词牌结社 · 第 ${replay.roundNumber??'—'} 局 · ${replay.finalBoard.some(c=>c.anime)?'动画组牌':'经典词牌'} ${replay.mode.boardMode} · ${replay.endReason==='aborted'?'本局中止':replay.winner?`${roleLabel(replay.winner)}获胜`:'本局结束'}`,44,26);
  ctx.font='20px sans-serif';ctx.fillText('封面保留 · 已翻标识为实际翻牌；未翻卡的阵营仅为赛后归属',44,78);
  const cols=Math.round(Math.sqrt(replay.finalBoard.length)),gap=10,pad=44,top=124;
  const footer=options.nicknames?100:65,cellW=(1600-pad*2-gap*(cols-1))/cols,cellH=(canvas.height-top-footer-gap*(cols-1))/cols;
  const fit=(text:string,width:number)=>{if(ctx.measureText(text).width<=width)return text;let end=text.length;while(end>0&&ctx.measureText(text.slice(0,end)+'…').width>width)end--;return text.slice(0,end)+'…';};
  replay.finalBoard.forEach((card,i)=>{
    const x=pad+(i%cols)*(cellW+gap),y=top+Math.floor(i/cols)*(cellH+gap),img=images[i],color=colors[card.role];
    ctx.fillStyle=dark?'#3c414c':'#dfdad0';ctx.fillRect(x,y,cellW,cellH);
    if(img){const ratio=Math.max(cellW/img.width,cellH/img.height),w=img.width*ratio,h=img.height*ratio;ctx.save();ctx.beginPath();ctx.rect(x,y,cellW,cellH);ctx.clip();ctx.drawImage(img,x+(cellW-w)/2,y+(cellH-h)/2,w,h);ctx.restore();}
    ctx.fillStyle='rgba(15,18,24,.84)';ctx.fillRect(x,y+cellH-48,cellW,48);ctx.fillStyle='#fff';ctx.font='bold 19px sans-serif';ctx.fillText(fit(card.word,cellW-14),x+7,y+cellH-42);
    ctx.font='14px sans-serif';ctx.fillText(fit(card.revealed?(options.nicknames&&card.guessedByNickname?`翻牌：${card.guessedByNickname}`:'实际已翻'):`赛后归属：${roleLabel(card.role)}`,cellW-14),x+7,y+cellH-19);
    const status=card.revealed?`已翻 · ${roleLabel(card.role)}`:'未翻';ctx.font='bold 17px sans-serif';const badgeW=ctx.measureText(status).width+16;ctx.fillStyle=card.revealed?color:'#404653';ctx.fillRect(x,y,badgeW,27);ctx.fillStyle='#fff';ctx.fillText(status,x+8,y+4);
    ctx.strokeStyle=card.revealed?color:(dark?'#747982':'#a9a59d');ctx.lineWidth=card.revealed?4:1;ctx.strokeRect(x+2,y+2,cellW-4,cellH-4);
  });
  const y=canvas.height-footer+18;ctx.fillStyle=ink;ctx.font='18px sans-serif';ctx.fillText('红队  /  蓝队  /  中立  /  刺客    ·    未翻 ≠ 已翻    ·    公开终局棋盘',44,y);
  if(options.nicknames){ctx.font='17px sans-serif';ctx.fillText(fit('参与者：'+replay.players.map(p=>p.nickname).join('、'),1512),44,y+30);}
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片生成失败，请重试')),'image/png'));
  return {blob,missing:images.filter((img,i)=>!img&&replay.finalBoard[i].anime?.cover).length};
}
