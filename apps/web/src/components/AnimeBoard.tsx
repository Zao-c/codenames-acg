import { useRef, useState } from 'react';
import { BOARD_MODE_CONFIG, type AnimeWork, type PublicCard, type PublicRoomState } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { Dialog } from './UI';
export function Cover({ work }: { work: AnimeWork }) {
  const [failed, setFailed] = useState(false);
  return !failed && work.cover ? <img src={work.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="anime-cover-fallback">{work.title}</span>;
}
export function Preview({ work, close, children }: { work: AnimeWork; close: () => void; children?: React.ReactNode }) {
  return <Dialog title={work.fullTitle} close={close}><section className="anime-modal">
    <Cover work={work}/><h2>{work.fullTitle}</h2><p>{work.type} · {work.airDate}</p><p>{work.aliases.join(' / ')}</p>
    <a className="anime-bgm-link" href={`https://bgm.tv/subject/${work.id}`} target="_blank" rel="noopener noreferrer">在 Bangumi 查看</a>{children}
  </section></Dialog>;
}

export function AnimeBoard({ room }: { room: PublicRoomState }) {
  const { guessCard } = useGame();
  const [text, setText] = useState(() => localStorage.getItem('anime-text-view') === '1');
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<PublicCard | null>(null);
  const [confirm, setConfirm] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = room.board.find(card => card.id === preview?.id);
  const cols = BOARD_MODE_CONFIG[room.settings.boardMode].columns;
  return <section className="panel anime-board-panel">
    <div className="anime-toolbar"><strong>封面棋盘 · {room.settings.boardMode}</strong>
      <button onClick={() => { setText(!text); localStorage.setItem('anime-text-view', text ? '0':'1'); }}>{text ? '封面显示' : '纯文字显示'}</button>
      <button aria-label="缩小棋盘" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1,z-.25))}>−</button>
      <button aria-label="放大棋盘" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2,z+.25))}>＋</button>
      <button onClick={() => { setZoom(1); scroll.current?.scrollTo(0,0); }}>重置视图</button>
    </div><p className="hint-text">点卡片查看作品；猜牌需要再次确认。放大后可滑动浏览。</p>
    <div className="anime-board-scroll" ref={scroll}><div className={`anime-board ${text ? "anime-board-text" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, width: `${zoom*100}%` }}>
      {room.board.map(card => <button key={card.id} className={`anime-board-card role-${card.role ?? 'hidden'} ${card.revealed ? 'is-revealed':''}`} aria-label={`${card.word}${card.revealed ? ' 已翻开':''}`} onClick={() => { setPreview(card); setConfirm(false); }}>
        {!text && card.anime && <Cover work={card.anime} />}<span>{card.word}</span>{card.role && <b>{card.role === 'red' ? '红' : card.role === 'blue' ? '蓝' : card.role === 'neutral' ? '中立' : '刺客'}</b>}
      </button>)}
    </div></div>
    {preview?.anime && <Preview work={preview.anime} close={() => setPreview(null)}>
      {room.viewer?.canGuess && selected && !selected.revealed && <div className="anime-confirm">
        {confirm ? <><p>确认猜「{preview.word}」？</p><button className="primary-button" onClick={() => { guessCard(preview.id); setPreview(null); }}>确认猜牌</button><button onClick={() => setConfirm(false)}>再想一下</button></> : <button className="primary-button" onClick={() => setConfirm(true)}>猜牌</button>}
      </div>}
    </Preview>}
  </section>;
}

