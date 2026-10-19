import type { Card, RoomSettings, Team, WordPack } from './types.js';

export interface AnimeWork {
  id: number;
  title: string;
  fullTitle: string;
  aliases: string[];
  cover: string;
  type: 'TV' | 'OVA' | 'ONA' | '电影' | '未知';
  seriesId: string;
  airDate: string;
  tags?: string[];
  rating?: number | null;
  ratingCount?: number | null;
  popularity?: number | null;
  source?: 'bangumi' | 'legacy' | 'manual';
  /** Stable UUID for manual entries; never a fabricated Bangumi subject id. */
  manualId?: string;
  updatedAt?: number;
  detailFetchedAt?: number;
  seriesSource?: 'manual-override' | 'official-relation' | 'subject-id' | 'legacy' | 'manual';
  seriesLinks?: number[];
}

export interface ManualAnimeInput {
  title: string;
  fullTitle?: string;
  aliases?: string[];
  airDate?: string;
  type?: AnimeWork['type'];
  tags?: string[];
  /** data:image/(jpeg|png|webp);base64,... — validated by the server. */
  coverDataUrl?: string;
  removeCover?: boolean;
  expectedUpdatedAt?: number;
}
export interface ManualAnimePage { items: AnimeWork[]; total: number; page: number; nextOffset: number | null }
export function animeWorkKey(work: Pick<AnimeWork, 'id' | 'source' | 'manualId'>): string {
  return work.source === 'manual' && work.manualId ? `manual:${work.manualId}` : `bgm:${work.id}`;
}
export function animeWorkLink(work: Pick<AnimeWork, 'id' | 'source' | 'manualId'>): string | null {
  return animeWorkKey(work).startsWith('manual:') ? null : `https://bgm.tv/subject/${work.id}`;
}
export interface AnimeDiscoveryQuery {
  q?: string; yearFrom?: number; yearTo?: number; quarter?: number;
  type?: AnimeWork['type']; tags?: string[]; tagMode?: 'all'|'any';
  minRating?: number; minVotes?: number; sort?: 'match'|'score'|'heat'|'recent';
  offset?: number; source?: 'bangumi'|'cache'|'manual';
}
export interface AnimeDiscoveryResult {
  works: AnimeWork[]; nextOffset: number | null; total: number; source: 'bangumi'|'cache'|'manual';
  notice: string; updatedAt: number; missingMetadata: number;
}
export interface AnimePool { id: string; name: string; workIds: number[] }
export interface DraftClaim { team: Team; kind: 'manual' | 'interference'; protectedUntil: number; from?: Team }
export interface AnimeDraftRules { version: 2; selectionSeconds: 180 | 240 | 300; interferenceSeconds: 30 | 60 | null }
export interface InterferencePoolPage { planId:string; stageVersion:number; page:number; total:number; works:AnimeWork[] }
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
  stage: 'planning' | 'guide' | 'draft' | 'interference' | 'sealed';
  stageVersion?: number;
  interferenceClosed?: boolean;
  interferenceWorks?: AnimeWork[];
  requests?: {id:string;actor:string;fingerprint:string}[];
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
  /** Private seal audit. Never included in PublicNextPlan or public replays. */
  randomSwap?: { redCardId: string; blueCardId: string };
  activityAt: number;
}
export interface PublicNextPlan {
  stageVersion?: number;
  interferenceClosed?: boolean;
  randomSwapCompleted?: boolean;
  poolSummary?: { source: number; series: number; excluded: number; available: number; required: number };
  /** Legacy field; current servers fetch the full source snapshot on demand. */
  poolPreview?: AnimeWork[];
  wordPackName?: string;
  id: string;
  version: number;
  variant: NextPlan['variant'];
  settings: RoomSettings;
  poolName: string;
  sourcePool?: { id: string; revision: number };
  poolIds: number[];
  /** Neutral current manual selections; no team, actor, protection or interference data. */
  publicSelectedWorkIds?: number[];
  candidates: AnimeWork[];
  startingTeam: Team;
  stage: NextPlan['stage'];
  captains: Partial<Record<Team, string>>;
  endsAt?: number;
  myTeam?: Team;
  myBookmarks?: number[];
  captainView?: { claims: Record<number, DraftClaim>; ready: Record<Team, boolean>; done: Record<Team, boolean>; interferenceWorks?:AnimeWork[] };
}
export interface PlanAction {
  roomId: string;
  kind: 'configure' | 'nominate' | 'bookmark' | 'prepare' | 'ready' | 'take' | 'release' | 'interfere' | 'done' | 'confirm-interference' | 'unready' | 'transfer' | 'cancel' | 'reset-series-history';
  draftProtocol?: 2;
  planId?:string;
  stageVersion?:number;
  requestId?:string;
  animeDraft?:AnimeDraftRules;
  animeRandomSwap?: boolean;
  animeSeriesRotation?: boolean;
  version?: number;
  variant?: 'classic' | 'anime';
  boardMode?: RoomSettings['boardMode'];
  scoringMode?: RoomSettings['scoringMode'];
  timerMode?: RoomSettings['timerMode'];
  timerClueSeconds?: number;
  timerGuessSeconds?: number;
  flipMode?: RoomSettings['flipMode'];
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
