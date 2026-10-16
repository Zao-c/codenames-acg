import type { Team, PublicCard } from './types.js';

export interface AnalysisMember {
  principalId: string;
  team: Team;
  nickname: string;
}

/** Internal state: never spread into public room or replay DTOs. */
export interface MatchPrivateState {
  schemaVersion: 1;
  matchId: string;
  members: Record<string, AnalysisMember>;
  exposedPrincipals: string[];
  teamGraphs: Record<Team, Record<string, AssociationGraph>>;
  intents: Record<string, Record<string, CaptainIntent>>;
  requests: Record<string, string[]>;
  rates: Record<string, { at: number; count: number }>;
  predictionsEnabled: boolean;
  predictions: Record<string, Record<string, PrivatePrediction>>;
  predictionShares: Record<string, boolean>;
  snapshots: PreRevealSnapshot[];
}

export interface PrivatePrediction { cardId: string; choice?: Team; revision: number; updatedAt: number; frozenAt?: number }
export interface PredictionAction { roomId: string; matchId: string; requestId: string; kind: 'set' | 'clear' | 'share'; cardId?: string; choice?: Team; expectedRevision?: number; shared?: boolean }
export interface PredictionResult { total: number; correct: number }
export interface IntentReview { nickname: string; team: Team; scopes: Record<string, CaptainIntent> }
export interface PrivateReplayView {
  matchId: string; replayId: string; expiresAt: number; board: PublicCard[];
  teamGraphs?: Record<Team, Record<string, AssociationGraph>>;
  intents?: IntentReview[];
  snapshots?: Array<{ sequence: number; cardId: string; clueId: string; serverAt: number; teamGraphs: Record<Team, Record<string, AssociationGraph>>; intents: IntentReview[] }>;
  interference?: Array<{ workId: number; from: Team; team: Team }>;
  myPredictions?: Record<string, PrivatePrediction>; predictionResult?: PredictionResult; predictionShared?: boolean;
  sharedPredictions?: Array<{ nickname: string; predictions: Record<string, PrivatePrediction>; result: PredictionResult }>;
}
export interface PreRevealSnapshot {
  id: string; matchId: string; clueId: string; cardId: string; sequence: number; serverAt: number;
  teamGraphs: Record<Team, Record<string, AssociationGraph>>;
  intents: Record<string, Record<string, CaptainIntent>>;
  predictions: Record<string, PrivatePrediction>;
}

export interface GraphNode { id: string; cardId?: string; clueId?: string; text: string; x: number; y: number }
export interface GraphEdge { id: string; from: string; to: string; text: string }
export interface AssociationGraph { revision: number; nodes: GraphNode[]; edges: GraphEdge[] }
export interface CaptainIntent { graph: AssociationGraph; locked?: { graph: AssociationGraph; lockedAt: number } }
export type GraphOperation =
  | { kind: 'node'; node: GraphNode }
  | { kind: 'remove-node'; id: string }
  | { kind: 'edge'; edge: GraphEdge }
  | { kind: 'remove-edge'; id: string }
  | { kind: 'lock' };
export interface AnalysisAction {
  roomId: string; matchId: string; requestId: string; scope: string;
  target: 'team' | 'intent'; expectedRevision: number; operation: GraphOperation;
}

export interface AnalysisPermissions {
  matchId: string;
  canReadTeamGraph: boolean;
  canEditTeamGraph: boolean;
  canEditIntent: boolean;
  canPredict: boolean;
  canReview: boolean;
  teamGraphs?: Record<string, AssociationGraph>;
  myIntents?: Record<string, CaptainIntent>;
  myPredictions?: Record<string, PrivatePrediction>;
  predictionResult?: PredictionResult;
  predictionShared?: boolean;
}
