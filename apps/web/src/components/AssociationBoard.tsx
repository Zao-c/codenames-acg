import { useState } from 'react';
import type { AssociationGraph, GraphOperation, PublicCard, PublicRoomState } from '@acg-codenames/shared';
import { getSocket } from '../lib/socket';
import { useGame } from '../context/GameContext';
import { Dialog } from './UI';
import '../analysis.css';

const freshId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2, '0')).join('');
const empty: AssociationGraph = { revision: 0, nodes: [], edges: [] };

export function GraphPicture({ graph, cards }: { graph: AssociationGraph; cards: PublicCard[] }) {
  const label = (id: string) => { const node = graph.nodes.find(n => n.id === id); return node?.cardId ? cards.find(c => c.id === node.cardId)?.word ?? '作品' : node?.text ?? ''; };
  return <div className="association-picture">
    {graph.nodes.length ? <svg viewBox="0 0 720 420" role="img" aria-label="手工关联图">
      {graph.edges.map(edge => { const a = graph.nodes.find(n => n.id === edge.from), b = graph.nodes.find(n => n.id === edge.to); if (!a || !b) return null;
        return <g key={edge.id}><line x1={70 + a.x * 580} y1={30 + a.y * 360} x2={70 + b.x * 580} y2={30 + b.y * 360}/><text x={70 + (a.x + b.x) * 290} y={24 + (a.y + b.y) * 180}>{edge.text.slice(0, 18)}</text></g>;
      })}
      {graph.nodes.map(node => <g key={node.id} transform={`translate(${70 + node.x * 580},${30 + node.y * 360})`}><title>{label(node.id)} {node.text}</title><rect x="-66" y="-21" width="132" height="42" rx="6"/><text y="5">{label(node.id).slice(0, 11)}</text></g>)}
    </svg> : <p className="hint-text">还没有关联。选取作品，或添加一条自己的想法。</p>}
  </div>;
}

function GraphEditor({ graph, cards, editable, send }: { graph: AssociationGraph; cards: PublicCard[]; editable: boolean; send: (operation: GraphOperation) => void }) {
  const [cardId, setCardId] = useState('');
  const [note, setNote] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [edgeText, setEdgeText] = useState('');
  const names = (id: string) => { const n = graph.nodes.find(n => n.id === id); return cards.find(c => c.id === n?.cardId)?.word ?? n?.text ?? ''; };
  return <>
    <GraphPicture graph={graph} cards={cards}/>
    {editable && <div className="association-controls">
      <form onSubmit={e => { e.preventDefault(); send({ kind: 'node', node: { id: freshId(), ...(cardId ? { cardId } : {}), text: note, x: (graph.nodes.length % 4) / 3, y: (Math.floor(graph.nodes.length / 4) % 4) / 3 } }); setNote(''); }}>
        <label>作品或便签<select value={cardId} onChange={e => setCardId(e.target.value)}><option value="">文字便签</option>{cards.filter(c => !graph.nodes.some(n => n.cardId === c.id)).map(c => <option key={c.id} value={c.id}>{c.word}</option>)}</select></label>
        <label>想法<input maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="写下你的联想"/></label>
        <button disabled={!cardId && !note.trim()}>添加节点</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); send({ kind: 'edge', edge: { id: freshId(), from, to, text: edgeText } }); setEdgeText(''); }}>
        <label>起点<select value={from} onChange={e => setFrom(e.target.value)}><option value="">选择节点</option>{graph.nodes.map(n => <option key={n.id} value={n.id}>{names(n.id)}</option>)}</select></label>
        <label>终点<select value={to} onChange={e => setTo(e.target.value)}><option value="">选择节点</option>{graph.nodes.map(n => <option key={n.id} value={n.id}>{names(n.id)}</option>)}</select></label>
        <label>关系<input maxLength={200} value={edgeText} onChange={e => setEdgeText(e.target.value)} placeholder="例如：共同主题"/></label><button disabled={!from || !to || from === to}>建立关联</button>
      </form>
    </div>}
    <div className="association-list">{graph.nodes.map(n => <details key={n.id}><summary>{names(n.id)}</summary><p>{n.text}</p>{editable && <>
      <label>水平位置<input type="range" min="0" max="1" step="0.05" defaultValue={n.x} onPointerUp={e => send({ kind: 'node', node: { ...n, x: Number(e.currentTarget.value) } })} onKeyUp={e => { if (e.key.startsWith('Arrow')) send({ kind: 'node', node: { ...n, x: Number(e.currentTarget.value) } }); }}/></label>
      <label>垂直位置<input type="range" min="0" max="1" step="0.05" defaultValue={n.y} onPointerUp={e => send({ kind: 'node', node: { ...n, y: Number(e.currentTarget.value) } })} onKeyUp={e => { if (e.key.startsWith('Arrow')) send({ kind: 'node', node: { ...n, y: Number(e.currentTarget.value) } }); }}/></label>
      <form onSubmit={e => { e.preventDefault(); const value = new FormData(e.currentTarget).get('text'); send({ kind: 'node', node: { ...n, text: String(value ?? '') } }); }}><label>编辑想法<input name="text" defaultValue={n.text} maxLength={200}/></label><button>保存文字</button></form>
      <button onClick={() => send({ kind: 'remove-node', id: n.id })}>移除节点</button></>}
    </details>)}{graph.edges.map(e => <div key={e.id}>{names(e.from)} → {names(e.to)}：{e.text}{editable && <button onClick={() => send({ kind: 'remove-edge', id: e.id })}>移除关联</button>}</div>)}</div>
  </>;
}

export function AssociationBoard({ room }: { room: PublicRoomState }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<'team' | 'intent'>('team');
  const [scopeMode, setScopeMode] = useState<'match' | 'clue'>('match');
  const { error } = useGame();
  const view = room.analysis;
  if (!view || !(view.canReadTeamGraph || view.canEditIntent || view.myIntents)) return null;
  const actualTarget = view.canReadTeamGraph ? target : 'intent';
  const scope = scopeMode === 'clue' ? room.clue?.id : 'match';
  const intent = scope ? view.myIntents?.[scope] : undefined;
  const graph = (actualTarget === 'team' ? scope && view.teamGraphs?.[scope] : intent?.graph) || empty;
  const editable = !!scope && (actualTarget === 'team' ? view.canEditTeamGraph : view.canEditIntent);
  const send = (operation: GraphOperation) => {
    if (!editable || !scope) return;
    getSocket().emit('analysis_action', { roomId: room.id, matchId: view.matchId, requestId: freshId(), target: actualTarget, scope, expectedRevision: graph.revision, operation });
  };
  return <><button onClick={() => setOpen(true)}>关联板与思路</button>{open && <Dialog title="关联板与思路" close={() => setOpen(false)} wide>
    <div className="anime-toolbar">{view.canReadTeamGraph && <button aria-pressed={actualTarget === 'team'} onClick={() => setTarget('team')}>团队关联板</button>}{(view.canEditIntent || view.myIntents) && <button aria-pressed={actualTarget === 'intent'} onClick={() => setTarget('intent')}>我的意图图</button>}
      <label>范围<select value={scopeMode} onChange={e => setScopeMode(e.target.value as 'match' | 'clue')}><option value="match">整局</option><option value="clue" disabled={!room.clue?.id}>当前线索</option></select></label>
    </div>
    <p className="hint-text">{actualTarget === 'team' ? '仅队内可见；队员手工协作，队长只读。' : '仅你可见。锁定后保留当时计划，继续编辑不会改写已锁定副本。'} 正常完赛后向本局参赛成员开放复盘。</p>
    {error && <p role="alert">{error}</p>}
    <GraphEditor key={`${view.matchId}:${actualTarget}:${scope}`} graph={graph} cards={room.board} editable={editable} send={send}/>
    {actualTarget === 'intent' && <><button disabled={!editable} onClick={() => send({ kind: 'lock' })}>锁定当前计划</button>{intent?.locked && <details><summary>已锁定计划 · {new Date(intent.locked.lockedAt).toLocaleTimeString()}</summary><GraphPicture graph={intent.locked.graph} cards={room.board}/></details>}</>}
  </Dialog>}</>;
}
