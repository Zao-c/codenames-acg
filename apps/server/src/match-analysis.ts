import crypto from 'node:crypto';
import { ensureAnalysisBudget } from './analysis-budget.js';
import { analysisPermissions, type AnalysisAction, type AssociationGraph, type GraphNode, type GraphEdge, type Room, type ParticipantType } from '@acg-codenames/shared';

export function registerPrincipal(room: Room, participantId: string, principalId?: string): void {
  room.participantPrincipals ??= {};
  room.participantPrincipals[participantId] = principalId ?? crypto.randomUUID();
}

/** A legacy display-name login must never recover a credential-bound room identity. */
export function canRestoreNamedParticipant(room: Room, participantId: string, principalId: string | undefined, privateEnabled: boolean): boolean {
  const expected = room.participantPrincipals?.[participantId];
  const credentialBound = !!expected && /^[a-f0-9]{64}$/.test(expected);
  return !(privateEnabled || room.privateMatch || credentialBound) || !!principalId && expected === principalId;
}

export function initializeAnalysis(room: Room, enabled: boolean, draftExposed: string[] = [], debugHost = false, predictionsEnabled = false): void {
  room.privateMatch = undefined;
  if (!enabled || room.settings.variant !== 'anime' || !room.matchId) return;
  for (const p of [...room.players, ...room.spectators]) {
    if (!room.participantPrincipals?.[p.id]) registerPrincipal(room, p.id);
  }
  room.privateMatch = {
    schemaVersion: 1,
    matchId: room.matchId,
    members: Object.fromEntries(room.players.filter(p => p.team && !p.isBot).map(p => [p.id, { principalId: room.participantPrincipals![p.id], team: p.team!, nickname: p.nickname }])),
    exposedPrincipals: [],
    teamGraphs: { red: {}, blue: {} }, intents: {}, requests: {}, rates: {},
    predictionsEnabled, predictions: {}, predictionShares: {}, snapshots: [],
  };
  for (const id of [...draftExposed, ...room.players.filter(p => p.role === 'spymaster').map(p => p.id), ...(debugHost ? [room.hostPlayerId] : [])]) markSecretExposure(room, id);
}

export const emptyGraph = (): AssociationGraph => ({ revision: 0, nodes: [], edges: [] });
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图谱参数无效');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('图谱标识无效');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) throw new Error('每段文字最多 200 字');
  return value.trim();
}
function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('节点位置无效');
  return value;
}

/** Mutates only a cloned Room, under the same lock used by guessing. */
export function editAnalysis(room: Room, participantId: string, participantType: ParticipantType, input: unknown, time: number): void {
  const action = record(input);
  if (JSON.stringify(action).length > 32_768) throw new Error('图谱请求过大');
  const state = room.privateMatch;
  if (!state || action.matchId !== state.matchId || state.matchId !== room.matchId) throw new Error('当前局不支持此操作');
  const principal = room.participantPrincipals?.[participantId];
  const player = room.players.find(p => p.id === participantId);
  const permissions = analysisPermissions(room, { participantId, participantType });
  const target = action.target;
  if (!principal || !player?.team || (target !== 'team' && target !== 'intent') || !(target === 'team' ? permissions?.canEditTeamGraph : permissions?.canEditIntent)) throw new Error('没有图谱编辑权限');
  const requestId = identifier(action.requestId);
  if (state.requests[principal]?.includes(requestId)) return;
  const scope = identifier(action.scope);
  if (scope !== 'match' && scope !== room.clue?.id) throw new Error('只能编辑整局或当前线索');
  const rate = state.rates[principal];
  if (rate && time - rate.at < 1000 && rate.count >= 5) throw new Error('编辑过快，请稍后重试');
  state.rates[principal] = rate && time - rate.at < 1000 ? { ...rate, count: rate.count + 1 } : { at: time, count: 1 };
  const graphs = state.teamGraphs[player.team];
  const intents = target === 'intent' ? (state.intents[principal] ??= {}) : {};
  if (!Object.hasOwn(target === 'team' ? graphs : intents, scope) && Object.keys(target === 'team' ? graphs : intents).length >= 128) throw new Error('本局图谱数量已达上限');
  const graph = target === 'team' ? (graphs[scope] ??= emptyGraph()) : (intents[scope] ??= { graph: emptyGraph() }).graph;
  if (!Number.isSafeInteger(action.expectedRevision) || graph.revision !== action.expectedRevision) throw new Error('图谱已更新，请基于最新内容重试');
  const operation = record(action.operation);
  if (operation.kind === 'node') {
    const node = record(operation.node);
    const parsed: GraphNode = { id: identifier(node.id), text: text(node.text), x: coordinate(node.x), y: coordinate(node.y) };
    const previousNode = graph.nodes.find(n => n.id === parsed.id);
    if (previousNode?.clueId && node.clueId !== previousNode.clueId) throw new Error('已关联的比赛线索来源不可修改');
    if (node.clueId !== undefined) {
      parsed.clueId = identifier(node.clueId);
      if (node.cardId !== undefined || !(room.clueRecords ?? []).some(c => c.clueId === parsed.clueId) && room.clue?.id !== parsed.clueId) throw new Error('只能关联本局已公开的线索');
    }
    if (node.cardId !== undefined) {
      parsed.cardId = identifier(node.cardId);
      if (!room.board.some(c => c.id === parsed.cardId)) throw new Error('作品不在本局棋盘');
      if (graph.nodes.some(n => n.cardId === parsed.cardId && n.id !== parsed.id)) throw new Error('该作品已在图中');
    } else if (!parsed.text) throw new Error('便签文字不能为空');
    graph.nodes = [...graph.nodes.filter(n => n.id !== parsed.id), parsed];
    if (graph.nodes.filter(n => !n.cardId).length > 32 || graph.nodes.length > room.board.length + 32) throw new Error('图谱节点过多');
  } else if (operation.kind === 'edge') {
    const edge = record(operation.edge);
    const parsed: GraphEdge = { id: identifier(edge.id), from: identifier(edge.from), to: identifier(edge.to), text: text(edge.text) };
    if (parsed.from === parsed.to || !graph.nodes.some(n => n.id === parsed.from) || !graph.nodes.some(n => n.id === parsed.to)) throw new Error('请连接两个不同的有效节点');
    graph.edges = [...graph.edges.filter(e => e.id !== parsed.id), parsed];
    if (graph.edges.length > 128) throw new Error('关联线最多 128 条');
  } else if (operation.kind === 'remove-node') {
    const id = identifier(operation.id);
    graph.nodes = graph.nodes.filter(n => n.id !== id);
    graph.edges = graph.edges.filter(e => e.from !== id && e.to !== id);
  } else if (operation.kind === 'remove-edge') {
    const id = identifier(operation.id);
    graph.edges = graph.edges.filter(e => e.id !== id);
  } else if (operation.kind === 'lock' && target === 'intent') {
    intents[scope].locked = { graph: structuredClone(graph), lockedAt: time };
  } else throw new Error('图谱操作无效');
  graph.revision += 1;
  state.requests[principal] = [...(state.requests[principal] ?? []), requestId].slice(-256);
  ensureAnalysisBudget(room);
}

export function markSecretExposure(room: Room, participantId: string): void {
  const principal = room.participantPrincipals?.[participantId];
  if (room.privateMatch && principal && !room.privateMatch.exposedPrincipals.includes(principal)) room.privateMatch.exposedPrincipals.push(principal);
}

/** Exact hook: called after guess validation and before card.revealed changes. */
export function snapshotBeforeReveal(room: Room, cardId: string, time: number): void {
  const state = room.privateMatch;
  if (!state || state.matchId !== room.matchId || !room.clue?.id) return;
  if (state.snapshots.some(s => s.cardId === cardId)) return;
  const scope = room.clue.id;
  const relevant = <T>(graphs: Record<string, T>) => Object.fromEntries(Object.entries(graphs).filter(([key]) => key === 'match' || key === scope));
  const predictions: import('@acg-codenames/shared').PreRevealSnapshot['predictions'] = {};
  for (const [principal, entries] of Object.entries(state.predictions)) {
    const prediction = entries[cardId];
    if (!prediction?.choice || state.exposedPrincipals.includes(principal)) continue;
    prediction.frozenAt = time;
    predictions[principal] = structuredClone(prediction);
  }
  state.snapshots.push({ id: crypto.randomUUID(), matchId: state.matchId, clueId: scope, cardId, sequence: state.snapshots.length + 1, serverAt: time,
    teamGraphs: structuredClone({ red: relevant(state.teamGraphs.red), blue: relevant(state.teamGraphs.blue) }),
    intents: structuredClone(Object.fromEntries(Object.entries(state.intents).map(([id, graphs]) => [id, relevant(graphs)]))), predictions });
}
