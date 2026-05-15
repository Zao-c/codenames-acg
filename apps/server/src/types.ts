import type {
  GameReplay,
  NamedUserAccount,
  NamedUserLoginResponse,
  ParticipantType,
  PublicWordPack,
  PublicWordPackSummary,
  Room,
  SavedWordPack,
  UpdateNamedUserPayload,
  UserProfile,
  UserStats
} from "@acg-codenames/shared";

export interface RoomSession {
  roomId: string;
  participantId: string;
  participantType: ParticipantType;
}

export interface RoomStore {
  getRoom(roomId: string): Promise<Room | null>;
  listRooms(): Promise<Room[]>;
  setRoom(room: Room): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  getPlayerSession(sessionToken: string): Promise<RoomSession | null>;
  setPlayerSession(sessionToken: string, session: RoomSession): Promise<void>;
}

export interface UserStore {
  login(username: string): Promise<NamedUserLoginResponse>;
  get(username: string): Promise<NamedUserAccount | null>;
  getPublicProfile(account: NamedUserAccount): { username: string; avatarUrl: string | null; customWordPacks: Pick<SavedWordPack, "id" | "name" | "description" | "isPublic">[]; stats: UserStats };
  update(username: string, payload: UpdateNamedUserPayload): Promise<NamedUserAccount>;
  verifySession(username: string, sessionToken: string): Promise<boolean>;
  revokeSession(username: string, sessionToken: string): Promise<void>;
  listPublicWordPacks(): Promise<PublicWordPackSummary[]>;
  getPublicWordPackByPublicId(publicId: string): Promise<PublicWordPack | null>;
  resolveProfile(profile?: Partial<UserProfile>, sessionToken?: string): Promise<UserProfile>;
  noteRoomHosted(username: string | null | undefined): Promise<void>;
  recordRoundResult(players: Room["players"], winner: "red" | "blue"): Promise<void>;
}

export interface ReplayStore {
  saveReplay(replay: GameReplay): Promise<void>;
  getReplay(replayId: string): Promise<GameReplay | null>;
}
