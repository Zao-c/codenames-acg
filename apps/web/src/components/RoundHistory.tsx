import { TEAM_LABELS, type ClueRoundRecord } from '@acg-codenames/shared';

export function RoundHistory({records}:{records:ClueRoundRecord[]}){
  return <section className="panel round-history"><h2>回合历史 <small>{records.length} 条线索</small></h2>{records.map((c,i)=>{
    const hits=c.guesses.filter(g=>g.isOwnHit).length;
    return <details className={`history-round team-${c.team}`} key={c.clueId}>
      <summary><span className="history-round-number">{String(i+1).padStart(2,'0')}</span><span><strong>{TEAM_LABELS[c.team]} · {c.word} ×{c.count}</strong><small>队长 {c.giverNickname} · 命中 {hits} · 失误 {c.guesses.length-hits}</small></span><span className="history-round-chevron">⌄</span></summary>
      <ol className="history-guesses">{c.guesses.map((g,j)=><li key={`${g.cardId??j}`} className={g.isOwnHit?'hit':'miss'}><span className="history-guess-index">{j+1}</span><span><strong>{g.cardWord}</strong><small>{g.nickname}</small></span><b>{g.isOwnHit?'命中':g.cardRole==='assassin'?'刺客':g.cardRole==='neutral'?'中立':'误开对方牌'}</b></li>)}</ol>
      {!c.guesses.length&&<p className="hint-text">本回合没有猜牌。</p>}
    </details>;
  })}{!records.length&&<p className="hint-text">暂无已提交线索。</p>}</section>;
}
