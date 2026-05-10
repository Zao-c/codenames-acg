import type { BoardMode, RoomSettings } from "./types.js";

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS_TO_START = 4;
export const ROOM_ID_LENGTH = 6;
export const MIN_CLUE_COUNT = 1;
export const MAX_CLUE_COUNT = 9;
export const MAX_NICKNAME_LENGTH = 12;
export const MAX_USERNAME_LENGTH = 24;
export const MAX_WORD_PACK_NAME_LENGTH = 32;
export const MIN_CUSTOM_WORD_PACK_ENTRIES = 25;
export const ROOM_TTL_SECONDS = 60 * 60 * 6;
export const ROOM_TTL_LOBBY_IDLE_SECONDS = 60 * 10;
export const ROOM_TTL_FINISHED_SECONDS = 60 * 30;
export const ROOM_TTL_EMPTY_SECONDS = 60 * 2;
export const PLAYER_RECONNECT_TTL_SECONDS = 60 * 60 * 12;
export const MAX_CHAT_MESSAGES = 80;
export const MAX_CHAT_LENGTH = 120;
export const MAX_AVATAR_DATA_URL_LENGTH = 220_000;

export const BOARD_MODE_CONFIG = {
  "5x5": { columns: 5, size: 25, starter: 9, follower: 8, neutral: 7, assassin: 1 },
  "7x7": { columns: 7, size: 49, starter: 17, follower: 16, neutral: 15, assassin: 1 },
  "9x9": { columns: 9, size: 81, starter: 28, follower: 27, neutral: 25, assassin: 1 }
} satisfies Record<BoardMode, { columns: number; size: number; starter: number; follower: number; neutral: number; assassin: number }>;

export const DEFAULT_WORD_PACK_ID = "acg-core-zh";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  ruleSet: "classic",
  boardMode: "5x5",
  wordPackId: DEFAULT_WORD_PACK_ID,
  scoringMode: "team"
};

export const TEAM_LABELS = {
  red: "红队",
  blue: "蓝队"
} as const;

export const PLAYER_ROLE_LABELS = {
  spymaster: "队长",
  operative: "队员"
} as const;
