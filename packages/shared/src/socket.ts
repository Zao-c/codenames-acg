import type {
  AchievementUnlockPayload,
  AdjustRevealScorePayload,
  BuzzInPayload,
  CancelQueueJoinPayload,
  ChatReaction,
  ClientSession,
  CreateRevealPuzzlePayload,
  CreateRevealGuessRoomPayload,
  CreateRoomPayload,
  DanmakuMessage,
  DebugFillRoomPayload,
  DisbandRoomPayload,
  EndRevealGamePayload,
  EndTurnPayload,
  ErrorMessagePayload,
  GuessCardPayload,
  JoinRoomPayload,
  JoinSpectatorPayload,
  JudgeRevealAnswerPayload,
  LeaveRoomPayload,
  NextRevealPuzzlePayload,
  OpenBuzzingPayload,
  ParticipantType,
  PublicRoomState,
  RandomizeTeamsPayload,
  QueueForNextRoundPayload,
  ReconnectRoomPayload,
  ResetRevealPlayerGuessPayload,
  ResumeRevealTimerPayload,
  ReturnToLobbyPayload,
  RestartGamePayload,
  RevealAnswerUpdateBroadcast,
  RevealBuzzingOpenBroadcast,
  RevealCellAnimatedBroadcast,
  RevealCellPayload,
  RevealGameEndedBroadcast,
  RevealHintBroadcast,
  RevealScoreUpdateBroadcast,
  RoomSummary,
  RoundHighlight,
  SendChatMessagePayload,
  SendReactionPayload,
  SendRevealHintPayload,
  SetRolePayload,
  SetTeamPayload,
  SkipRevealPuzzlePayload,
  StartGamePayload,
  StartRevealGamePayload,
  SubmitCluePayload,
  SubmitRevealAnswerPayload,
  SyncRoomStatePayload,
  TransferHostPayload,
  UpdateRoomSettingsPayload,
  WaivePriorityGuessPayload,
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
  create_reveal_guess_room: (payload: CreateRevealGuessRoomPayload) => void;
  reveal_guess_add_puzzle: (payload: CreateRevealPuzzlePayload) => void;
  reveal_guess_start: (payload: StartRevealGamePayload) => void;
  end_reveal_game: (payload: EndRevealGamePayload) => void;
  reveal_guess_reveal_cell: (payload: RevealCellPayload) => void;
  waive_priority_guess: (payload: WaivePriorityGuessPayload) => void;
  reveal_guess_submit_answer: (payload: SubmitRevealAnswerPayload) => void;
  reveal_guess_open_buzz: (payload: OpenBuzzingPayload) => void;
  reveal_guess_close_buzz: (payload: { roomId: string }) => void;
  reveal_guess_buzz_in: (payload: BuzzInPayload) => void;
  reveal_guess_judge_answer: (payload: JudgeRevealAnswerPayload) => void;
  reset_reveal_player_guess: (payload: ResetRevealPlayerGuessPayload) => void;
  reveal_guess_show_hint: (payload: SendRevealHintPayload) => void;
  reveal_guess_skip_puzzle: (payload: SkipRevealPuzzlePayload) => void;
  reveal_guess_next_puzzle: (payload: NextRevealPuzzlePayload) => void;
  reveal_guess_adjust_score: (payload: AdjustRevealScorePayload) => void;
  reveal_guess_transfer_judge: (payload: { roomId: string; newJudgeId: string }) => void;
  reveal_guess_return_to_setup: (payload: { roomId: string }) => void;
  reveal_guess_open_free_reveal: (payload: { roomId: string }) => void;
  resume_reveal_timer: (payload: ResumeRevealTimerPayload) => void;
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
  danmaku_message: (payload: DanmakuMessage) => void;
  reaction_effect: (payload: ReactionEffectPayload) => void;
  round_highlight: (payload: RoundHighlight) => void;
  achievement_unlock: (payload: AchievementUnlockPayload) => void;
  reveal_hint: (payload: RevealHintBroadcast) => void;
  reveal_answer_update: (payload: RevealAnswerUpdateBroadcast) => void;
  reveal_score_update: (payload: RevealScoreUpdateBroadcast) => void;
  reveal_cell_animated: (payload: RevealCellAnimatedBroadcast) => void;
  reveal_buzzing_open: (payload: RevealBuzzingOpenBroadcast) => void;
  reveal_game_ended: (payload: RevealGameEndedBroadcast) => void;
}
