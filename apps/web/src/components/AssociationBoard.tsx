import { GraphCanvas } from './GraphCanvas';
import { useState } from 'react';
import type { AssociationGraph, GraphOperation, PublicCard, PublicRoomState } from '@acg-codenames/shared';
import { getSocket } from '../lib/socket';
import { useGame } from '../context/GameContext';
import { Dialog } from './UI';
import '../analysis.css';

const freshId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2, '0')).join('');
const empty: AssociationGraph = { revision: 0, nodes: [], edges: [] };

export function GraphPicture({ graph, cards }: { graph: AssociationGraph; cards: PublicCard[] }) {
  const label = (id: string) => { const node = graph.nodes.find(n => n.id === id); return node?.text || (node?.cardId ? cards.find(c => c.id === node.cardId)?.word ?? '作品' : ''); };
  return <div className="association-picture">
    {graph.nodes.length ? <svg viewBox="0 0 720 420" role="img" aria-label="手工关联图">
      {graph.edges.map(edge => { const a = graph.nodes.find(n => n.id === edge.from), b = graph.nodes.find(n => n.id === edge.to); if (!a || !b) return null;
        return <g key={edge.id}><line x1={70 + a.x * 580} y1={30 + a.y * 360} x2={70 + b.x * 580} y2={30 + b.y * 360}/><text x={70 + (a.x + b.x) * 290} y={24 + (a.y + b.y) * 180}>{edge.text.slice(0, 18)}</text></g>;
      })}
      {graph.nodes.map(node => <g key={node.id} transform={`translate(${70 + node.x * 580},${30 + node.y * 360})`}><title>{label(node.id)} {node.text}</title>{node.cardId?<ellipse rx="62" ry="30"/>:<rect x="-66" y="-24" width="132" height="48" rx="6"/>}<text y="5">{label(node.id).slice(0, 11)}</text></g>)}
    </svg> : <p className="hint-text">还没有关联。选取作品，或添加一条自己的想法。</p>}
  </div>;
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
    <GraphCanvas error={error} key={`${view.matchId}:${actualTarget}:${scope}`} graph={graph} cards={room.board} editable={editable} send={send}/>
    {actualTarget === 'intent' && <><button disabled={!editable} onClick={() => send({ kind: 'lock' })}>锁定当前计划</button>{intent?.locked && <details><summary>已锁定计划 · {new Date(intent.locked.lockedAt).toLocaleTimeString()}</summary><GraphPicture graph={intent.locked.graph} cards={room.board}/></details>}</>}
  </Dialog>}</>;
}
