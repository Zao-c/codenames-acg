import crypto from 'node:crypto';
import { BOARD_MODE_CONFIG, animeWorkKey, draftQuota, type AnimeWork, type Card, type NextPlan, type PlanAction, type Room, type Team } from '@acg-codenames/shared';

const other = (team: Team): Team => team === 'red' ? 'blue' : 'red';
export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function candidatesFor(pool: AnimeWork[], history: Record<string, number> = {}, random = Math.random): AnimeWork[] {
  const unique = new Map<string, AnimeWork>();
  // Shuffle first: no popularity weighting; stable age sort only affects historic reuse.
  for (const work of shuffled(pool, random)) if (!unique.has(work.seriesId)) unique.set(work.seriesId, work);
  return [...unique.values()].sort((a, b) => (history[a.seriesId] ?? -1) - (history[b.seriesId] ?? -1)).slice(0, 180);
}
export function makePlan(room: Room, time: number): NextPlan {
  return {
    id: crypto.randomUUID(), matchId: crypto.randomUUID(), version: 1, variant: 'classic',
    settings: { ...room.settings, variant: 'classic', boardMode: room.settings.boardMode === '6x6' ? '5x5' : room.settings.boardMode },
    wordPack: room.wordPack, pool: [], poolName: '全部动画', candidates: [], startingTeam: Math.random() < .5 ? 'red' : 'blue',
    stage: 'planning', captains: Object.fromEntries(room.players.filter(p => p.role === 'spymaster' && p.team).map(p => [p.team!, p.id])),
    bookmarks: {}, ready: { red: false, blue: false }, done: { red: false, blue: false }, claims: {}, protection: {}, exposedPlayerIds: [], activityAt: time,
  };
}
export function validatePlanRoster(room: Room, plan: NextPlan): void {
  if (room.players.length < 4) throw new Error('至少需要 4 名正式玩家');
  for (const team of ['red', 'blue'] as const) {
    if (room.players.filter(p => p.team === team).length < 2) throw new Error('每队至少需要 2 名玩家');
    if (!room.players.some(p => p.id === plan.captains[team] && p.team === team)) throw new Error('请为两队指定同队正式玩家作为队长');
  }
}
export function sealDraft(plan: NextPlan, history: Record<string, number> = {}, random = Math.random): void {
  if (plan.stage !== 'draft') return;
  const size = BOARD_MODE_CONFIG[plan.settings.boardMode].size;
  const candidates = new Map(plan.candidates.map(w => [w.id, w]));
  const cards: Card[] = [];
  const used = new Set<string>();
  const add = (work: AnimeWork, role: Card['role']) => {
    if (used.has(work.seriesId)) throw new Error('作品系列重复，无法封存');
    used.add(work.seriesId);
    cards.push({ id: crypto.randomUUID(), wordId: animeWorkKey(work), word: work.title, anime: work, role, revealed: false });
  };
  for (const [id, claim] of Object.entries(plan.claims)) {
    const work = candidates.get(Number(id));
    if (!work) throw new Error('作品不在候选快照中');
    add(work, claim.team);
  }
  const free = shuffled(plan.candidates.filter(w => !used.has(w.seriesId)), random).sort((a,b) => (history[a.seriesId] ?? -1) - (history[b.seriesId] ?? -1));
  const fill = (role: Card['role'], target: number) => {
    while (cards.filter(c => c.role === role).length < target) {
      const work = free.shift();
      if (!work) throw new Error('当前题库的不同系列不足，无法补齐');
      add(work, role);
    }
  };
  for (const team of ['red', 'blue'] as const) fill(team, draftQuota(size, plan.startingTeam, team).total);
  fill('neutral', size === 36 ? 10 : 7); fill('assassin', 1);
  if (cards.length !== size) throw new Error('组牌数量不合法');
  plan.sealedBoard = shuffled(cards, random);
  plan.stage = 'sealed';
}
// Called only on a cloned room under the GameService room lock. Failure commits nothing.
export function editDraft(plan: NextPlan, team: Team, action: PlanAction, time: number): void {
  if (plan.stage !== 'draft' || !plan.endsAt || time >= plan.endsAt) throw new Error('正式组牌已结束');
  const late = plan.endsAt - time <= 20_000;
  const id = action.workId;
  const work = plan.candidates.find(w => w.id === id);
  const claim = id === undefined ? undefined : plan.claims[id];
  const quota = draftQuota(BOARD_MODE_CONFIG[plan.settings.boardMode].size, plan.startingTeam, team);
  if (action.kind === 'done') { plan.done[team] = true; return; }
  if (!work || id === undefined) throw new Error('作品不在当前候选池');
  if (action.kind === 'release') {
    if (claim?.team !== team || claim.kind !== 'manual') throw new Error('只能撤回己方普通手选牌');
    delete plan.claims[id];
  } else if (action.kind === 'take') {
    if (claim?.team === team) throw new Error('已归属己方');
    if (claim?.kind === 'interference') throw new Error('不能抢夺干扰牌');
    if (claim && (late || time < claim.protectedUntil)) throw new Error(late ? '最后 20 秒不能抢夺' : '作品处于 10 秒保护期');
    const count = Object.values(plan.claims).filter(c => c.team === team && c.kind === 'manual').length;
    if (action.replaceId !== undefined) {
      const old = plan.claims[action.replaceId];
      if (old?.team !== team || old.kind !== 'manual' || action.replaceId === id) throw new Error('替换目标必须是己方普通手选牌');
    } else if (count >= quota.manual) throw new Error('手选已满，请指定一张己方牌进行原子替换');
    const key = `${team}:${id}`;
    // A voluntary release and reselect retains the original protection deadline.
    if (claim || plan.protection[key] === undefined) plan.protection[key] = time + 10_000;
    if (action.replaceId !== undefined) delete plan.claims[action.replaceId];
    plan.claims[id] = { team, kind: 'manual', protectedUntil: plan.protection[key] };
  } else if (action.kind === 'interfere') {
    if (late) throw new Error('最后 20 秒不能更改干扰牌');
    if (claim) throw new Error('干扰牌必须来自空闲池');
    for (const [key, existing] of Object.entries(plan.claims)) if (existing.kind === 'interference' && existing.from === team) delete plan.claims[Number(key)];
    plan.claims[id] = { team: other(team), from: team, kind: 'interference', protectedUntil: 0 };
  } else throw new Error('无效组牌操作');
  plan.done = { red: false, blue: false };
}
