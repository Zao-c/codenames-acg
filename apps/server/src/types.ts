import type {
  NamedUserAccount,
  NamedUserLoginResponse,
  ParticipantType,
  PublicWordPack,
  Room,
  UpdateNamedUserPayload,
  UserProfile
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
  update(username: string, payload: UpdateNamedUserPayload): Promise<NamedUserAccount>;
  verifySession(username: string, sessionToken: string): Promise<boolean>;
  listPublicWordPacks(): Promise<PublicWordPack[]>;
  resolveProfile(profile?: Partial<UserProfile>): Promise<UserProfile>;
  noteRoomHosted(username: string | null | undefined): Promise<void>;
  recordRoundResult(players: Room["players"], winner: "red" | "blue"): Promise<void>;
}
