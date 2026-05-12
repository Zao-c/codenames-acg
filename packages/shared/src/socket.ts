import type {
  CancelQueueJoinPayload,
  ChatReaction,
  ClientSession,
  CreateRoomPayload,
  DebugFillRoomPayload,
  DisbandRoomPayload,
  EndTurnPayload,
  ErrorMessagePayload,
  GuessCardPayload,
  JoinRoomPayload,
  JoinSpectatorPayload,
  LeaveRoomPayload,
  ParticipantType,
  PublicRoomState,
  RandomizeTeamsPayload,
  QueueForNextRoundPayload,
  ReconnectRoomPayload,
  ReturnToLobbyPayload,
  RestartGamePayload,
  RoomSummary,
  SendChatMessagePayload,
  SendReactionPayload,
  SetRolePayload,
  SetTeamPayload,
  StartGamePayload,
  SubmitCluePayload,
  SyncRoomStatePayload,
  TransferHostPayload,
  UpdateRoomSettingsPayload,
} from "./types.js";

export interface ClientToServerEvents {
  create_room: (payload: CreateRoomPayload) => void;
  join_room: (payload: JoinRoomPayload) => void;
  join_spectator: (payload: JoinSpectatorPayload) => void;
  reconnect_room: (payload: ReconnectRoomPayload) => void;
  set_team: (payload: SetTeamPayload) => void;
  set_role: (payload: SetRolePayload) => void;
  randomize_teams: (payload: RandomizeTeamsPayload) => void;
  update_room_settings: (payload: UpdateRoomSettingsPayload) => void;
  start_game: (payload: StartGamePayload) => void;
  restart_game: (payload: RestartGamePayload) => void;
  return_to_lobby: (payload: ReturnToLobbyPayload) => void;
  transfer_host: (payload: TransferHostPayload) => void;
  disband_room: (payload: DisbandRoomPayload) => void;
  force_end_game: (payload: { roomId: string }) => void;
  submit_clue: (payload: SubmitCluePayload) => void;
  guess_card: (payload: GuessCardPayload) => void;
  end_turn: (payload: EndTurnPayload) => void;
  resume_timer: (payload: { roomId: string }) => void;
  leave_room: (payload: LeaveRoomPayload) => void;
  sync_room_state: (payload: SyncRoomStatePayload) => void;
  debug_fill_room: (payload: DebugFillRoomPayload) => void;
  send_chat_message: (payload: SendChatMessagePayload) => void;
  send_reaction: (payload: SendReactionPayload) => void;
  queue_for_next_round: (payload: QueueForNextRoundPayload) => void;
  cancel_queue_join: (payload: CancelQueueJoinPayload) => void;
}

export interface ReactionEffectPayload {
  id: string;
  roomId: string;
  reaction: ChatReaction;
  senderNickname: string;
  targetNickname: string;
  targetParticipantId: string;
  targetParticipantType: ParticipantType;
  createdAt: number;
}

export interface ServerToClientEvents {
  room_state: (payload: PublicRoomState) => void;
  session: (payload: ClientSession) => void;
  room_summaries: (payload: RoomSummary[]) => void;
  error_message: (payload: ErrorMessagePayload) => void;
  room_closed: (payload: { roomId: string; reason: string }) => void;
  reaction_effect: (payload: ReactionEffectPayload) => void;
}
