import type { UserStats } from './types.js';

export interface TitleDefinition {
  id: string;
  title: string;
  description: string;
  unlock: (stats: UserStats) => boolean;
}

const winRate = (stats: UserStats) => stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0;

/** Order matters: earlier entries are preferred when several titles are unlocked. */
export const TITLES: TitleDefinition[] = [
  { id: 'veteran', title: '百战勇士', description: '累计参与 20 场对局', unlock: stats => stats.gamesPlayed >= 20 },
  { id: 'steady', title: '稳健队长', description: '胜率 ≥ 70% 且至少 5 场', unlock: stats => stats.gamesPlayed >= 5 && winRate(stats) >= 0.7 },
  { id: 'host', title: '主场之王', description: '累计主持 5 间房间', unlock: stats => stats.roomsHosted >= 5 },
  { id: 'regular', title: '结社常客', description: '累计参与 10 场对局', unlock: stats => stats.gamesPlayed >= 10 },
  { id: 'hunter', title: '胜场猎手', description: '累计获胜 3 场', unlock: stats => stats.wins >= 3 },
  { id: 'rising', title: '初露锋芒', description: '完成第 1 场对局', unlock: stats => stats.gamesPlayed >= 1 },
  { id: 'newcomer', title: '新人社员', description: '加入词牌结社', unlock: () => true },
];

export function unlockedTitles(stats: UserStats | null | undefined): TitleDefinition[] {
  if (!stats) return [TITLES[TITLES.length - 1]];
  return TITLES.filter(entry => entry.unlock(stats));
}

export function defaultTitle(stats: UserStats | null | undefined): string {
  return unlockedTitles(stats)[0]?.title ?? '新人社员';
}

export function isTitleUnlocked(stats: UserStats | null | undefined, title: string): boolean {
  return unlockedTitles(stats).some(entry => entry.title === title);
}
