import type { Card, RoomSettings, Team, WordPack } from './types.js';

export interface AnimeWork {
  id: number;
  title: string;
  fullTitle: string;
  aliases: string[];
  cover: string;
  type: 'TV' | 'OVA' | 'ONA' | '电影';
  seriesId: string;
  airDate: string;
}
export interface AnimePool { id: string; name: string; workIds: number[] }
export interface DraftClaim { team: Team; kind: 'manual' | 'interference'; protectedUntil: number; from?: Team }
export interface NextPlan {
  id: string;
  version: number;
  matchId: string;
  variant: 'classic' | 'anime';
  settings: RoomSettings;
  wordPack: WordPack;
  pool: AnimeWork[];
  poolName: string;
  sourcePool?: { id: string; revision: number };
  candidates: AnimeWork[];
  startingTeam: Team;
  stage: 'planning' | 'guide' | 'draft' | 'sealed';
  captains: Partial<Record<Team, string>>;
  bookmarks: Record<string, number[]>;
  ready: Record<Team, boolean>;
  done: Record<Team, boolean>;
  claims: Record<number, DraftClaim>;
  protection: Record<string, number>;
  lockedPlayerIds?: string[];
  exposedPlayerIds: string[];
  endsAt?: number;
  sealedBoard?: Card[];
  activityAt: number;
}
export interface PublicNextPlan {
  id: string;
  version: number;
  variant: NextPlan['variant'];
  settings: RoomSettings;
  poolName: string;
  sourcePool?: { id: string; revision: number };
  poolIds: number[];
  candidates: AnimeWork[];
  startingTeam: Team;
  stage: NextPlan['stage'];
  captains: Partial<Record<Team, string>>;
  endsAt?: number;
  myTeam?: Team;
  myBookmarks?: number[];
  captainView?: { claims: Record<number, DraftClaim>; ready: Record<Team, boolean>; done: Record<Team, boolean> };
}
export interface PlanAction {
  roomId: string;
  kind: 'configure' | 'nominate' | 'bookmark' | 'prepare' | 'ready' | 'take' | 'release' | 'interfere' | 'done' | 'transfer' | 'cancel';
  version?: number;
  variant?: 'classic' | 'anime';
  boardMode?: RoomSettings['boardMode'];
  scoringMode?: RoomSettings['scoringMode'];
  poolIds?: number[];
  poolName?: string;
  communityPoolId?: string;
  communityPoolRevision?: number;
  builtinWordPackId?: string;
  customWordPack?: { name: string; entries: string[] };
  team?: Team;
  targetId?: string;
  workId?: number;
  replaceId?: number;
}
export function draftQuota(size: number, startingTeam: Team, team: Team): { total: number; manual: number } {
  const starter = team === startingTeam;
  return size === 36 ? { total: starter ? 13 : 12, manual: starter ? 10 : 9 } : { total: starter ? 9 : 8, manual: starter ? 7 : 6 };
}
