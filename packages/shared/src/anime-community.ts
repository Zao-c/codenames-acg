export interface CommunityPoolSummary {
  id: string;
  revision: number;
  name: string;
  description: string;
  author: string;
  workCount: number;
  previewWorkIds: number[];
  seriesCount: number;
  isPublic: boolean;
  hidden: boolean;
  canEdit: boolean;
  favorited: boolean;
  updatedAt: number;
}
export interface CommunityPool extends CommunityPoolSummary { workIds: number[] }
export interface CommunityPoolInput {
  name: string; description: string; author: string; workIds: number[]; isPublic: boolean;
  expectedRevision?: number;
}
export interface CommunityPoolPage {
  enabled: boolean; page: number; total: number; items: CommunityPoolSummary[];
}
export interface PoolModerationItem {
  pool: CommunityPool;
  reports: Array<{ reason: string; createdAt: number }>;
  history: Array<{ hidden: boolean; reason: string; at: number }>;
}
