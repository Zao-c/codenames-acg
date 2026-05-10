import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import type {
  BoardMode,
  ClientSession,
  NamedUserLoginResponse,
  NamedUserAccount,
  ParticipantType,
  PublicRoomState,
  PublicWordPack,
  RoomSummary
} from "@acg-codenames/shared";

const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:3001";

type TestSocket = Socket<
  {
    room_state: (payload: PublicRoomState) => void;
    session: (payload: ClientSession) => void;
    room_summaries: (payload: RoomSummary[]) => void;
    error_message: (payload: { message: string }) => void;
    room_closed: (payload: { roomId: string; reason: string }) => void;
  },
  Record<string, never>
>;

function createClient(): TestSocket {
  return io(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false
  });
}

function waitForConnect(socket: TestSocket): Promise<void> {
  return new Promise((resolve) => socket.on("connect", () => resolve()));
}

function onceSession(socket: TestSocket): Promise<ClientSession> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("session timeout")), 5000);
    socket.once("session", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
    socket.once("error_message", (payload) => {
      clearTimeout(timeout);
      reject(new Error(payload.message));
    });
  });
}

function onceRoomState(socket: TestSocket): Promise<PublicRoomState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("room_state timeout")), 5000);
    socket.once("room_state", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
    socket.once("error_message", (payload) => {
      clearTimeout(timeout);
      reject(new Error(payload.message));
    });
  });
}

function waitForRoomState(
  socket: TestSocket,
  predicate: (payload: PublicRoomState) => boolean,
  timeoutMs = 5000
): Promise<PublicRoomState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("room_state", onRoomState);
      socket.off("error_message", onError);
      reject(new Error("room_state predicate timeout"));
    }, timeoutMs);

    function onRoomState(payload: PublicRoomState): void {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timeout);
      socket.off("room_state", onRoomState);
      socket.off("error_message", onError);
      resolve(payload);
    }

    function onError(payload: { message: string }): void {
      clearTimeout(timeout);
      socket.off("room_state", onRoomState);
      socket.off("error_message", onError);
      reject(new Error(payload.message));
    }

    socket.on("room_state", onRoomState);
    socket.on("error_message", onError);
  });
}

function onceError(socket: TestSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("error_message", (payload) => resolve(payload.message));
  });
}

function onceRoomClosed(socket: TestSocket): Promise<{ roomId: string; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("room_closed timeout")), 5000);
    socket.once("room_closed", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
  assert.equal(response.ok, true, `${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

async function fetchRooms(): Promise<RoomSummary[]> {
  return fetchJson<RoomSummary[]>(`${SERVER_URL}/rooms`);
}

async function loginNamedUser(username: string): Promise<NamedUserLoginResponse> {
  return fetchJson<NamedUserLoginResponse>(`${SERVER_URL}/api/users/login`, {
    method: "POST",
    body: JSON.stringify({ username })
  });
}

async function updateNamedUser(username: string, sessionToken: string, patch: object): Promise<NamedUserAccount> {
  return fetchJson<NamedUserAccount>(`${SERVER_URL}/api/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-session-token": sessionToken
    },
    body: JSON.stringify(patch)
  });
}

async function fetchStatus(url: string, init?: RequestInit): Promise<{ status: number; body: { message?: string } }> {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as { message?: string } };
}

async function fetchPublicWordPacks(): Promise<PublicWordPack[]> {
  return fetchJson<PublicWordPack[]>(`${SERVER_URL}/api/public-word-packs`);
}

async function testNamedUserPersistence(): Promise<void> {
  const user = await loginNamedUser("AccountAlpha");
  assert.equal(user.username, "AccountAlpha");
  assert.equal(typeof user.sessionToken, "string");
  const avatarUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s3FoX8AAAAASUVORK5CYII=";
  const unauthorized = await fetchStatus(`${SERVER_URL}/api/users/${encodeURIComponent("AccountAlpha")}`, {
    method: "PUT",
    body: JSON.stringify({ avatarUrl })
  });
  assert.equal(unauthorized.status, 401);
  const updated = await updateNamedUser("AccountAlpha", user.sessionToken, {
    avatarUrl,
    customWordPacks: [
      {
        id: "pack-alpha",
        name: "测试题库",
        entries: Array.from({ length: 25 }, (_, index) => `词条${index + 1}`),
        isPublic: true,
        publishedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  });
  assert.equal(updated.avatarUrl, avatarUrl);
  assert.equal(updated.customWordPacks.length, 1);
  const fetched = await fetchJson<NamedUserAccount>(`${SERVER_URL}/api/users/${encodeURIComponent("AccountAlpha")}`);
  assert.equal(fetched.avatarUrl, avatarUrl);
  assert.equal(fetched.customWordPacks[0]?.name, "测试题库");
  assert.equal(fetched.customWordPacks[0]?.isPublic, true);
  const publicPacks = await fetchPublicWordPacks();
  const publicPack = publicPacks.find((pack) => pack.ownerUsername === "AccountAlpha" && pack.id === "pack-alpha");
  assert.ok(publicPack);
  assert.equal(publicPack.publicId, "AccountAlpha:pack-alpha");
  assert.equal(publicPack.entries.length, 25);
  console.log("ok named_user_persistence");
}

async function testPublicWordPackLifecycle(): Promise<void> {
  await loginNamedUser("AccountBeta");
  const betaUser = await loginNamedUser("AccountBeta");
  await updateNamedUser("AccountBeta", betaUser.sessionToken, {
    customWordPacks: [
      {
        id: "pack-alpha",
        name: "Beta Shared Pack",
        entries: Array.from({ length: 25 }, (_, index) => `BetaWord${index + 1}`),
        isPublic: true,
        publishedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  });

  const published = await fetchPublicWordPacks();
  const alpha = published.find((pack) => pack.publicId === "AccountAlpha:pack-alpha");
  const beta = published.find((pack) => pack.publicId === "AccountBeta:pack-alpha");
  assert.ok(alpha);
  assert.ok(beta);
  assert.notEqual(alpha.publicId, beta.publicId);

  const socket = createClient();
  try {
    await waitForConnect(socket);
    socket.emit("create_room", {
      nickname: "PublicHost",
      profile: { accountType: "named", username: "AccountAlpha" }
    });
    const session = await onceSession(socket);
    await onceRoomState(socket);
    socket.emit("update_room_settings", {
      roomId: session.roomId,
      customWordPack: {
        name: alpha.name,
        entries: alpha.entries
      }
    });
    const room = await waitForRoomState(socket, (payload) => payload.wordPackSummary.name === alpha.name);
    assert.equal(room.wordPackSummary.entryCount, 25);
  } finally {
    socket.disconnect();
  }

  await updateNamedUser("AccountBeta", betaUser.sessionToken, {
    customWordPacks: [
      {
        id: "pack-alpha",
        name: "Beta Shared Pack",
        entries: Array.from({ length: 25 }, (_, index) => `BetaWord${index + 1}`),
        isPublic: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  });
  const unpublished = await fetchPublicWordPacks();
  assert.equal(unpublished.some((pack) => pack.publicId === "AccountBeta:pack-alpha"), false);
  console.log("ok public_word_pack_lifecycle");
}

async function testCreateRoom(): Promise<{ roomId: string; session: ClientSession }> {
  const socket = createClient();
  try {
    await waitForConnect(socket);
    socket.emit("create_room", {
      nickname: "HostAlpha",
      profile: {
        accountType: "named",
        username: "AccountAlpha"
      }
    });
    const session = await onceSession(socket);
    const room = await onceRoomState(socket);
    assert.equal(room.id, session.roomId);
    assert.equal(room.phase, "lobby");
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0]?.profile.username, "AccountAlpha");
    assert.equal(room.players[0]?.profile.accountType, "named");
    assert.equal(session.participantType, "player");
    const rooms = await fetchRooms();
    assert.ok(rooms.some((entry) => entry.id === room.id));
    console.log("ok create_room");
    return { roomId: room.id, session };
  } finally {
    socket.disconnect();
  }
}

async function testReconnect(roomId: string, session: ClientSession): Promise<void> {
  const socket = createClient();
  try {
    await waitForConnect(socket);
    socket.emit("reconnect_room", { roomId, sessionToken: session.sessionToken });
    const nextSession = await onceSession(socket);
    const room = await onceRoomState(socket);
    assert.equal(nextSession.participantId, session.participantId);
    assert.equal(nextSession.participantType, "player");
    assert.equal(room.players[0]?.connected, true);
    console.log("ok reconnect_room");
  } finally {
    socket.disconnect();
  }
}

async function testStartRejectionWithTwoPlayers(): Promise<void> {
  const a = createClient();
  const b = createClient();
  try {
    await Promise.all([waitForConnect(a), waitForConnect(b)]);
    a.emit("create_room", { nickname: "Host2", profile: { accountType: "guest" } });
    const hostSession = await onceSession(a);
    await onceRoomState(a);
    b.emit("join_room", { roomId: hostSession.roomId, nickname: "Guest2", profile: { accountType: "guest" } });
    await onceSession(b);
    await onceRoomState(b);

    const rejection = new Promise<string>((resolve) => {
      a.once("error_message", (payload) => resolve(payload.message));
    });
    a.emit("start_game", { roomId: hostSession.roomId });
    const message = await rejection;
    assert.match(message, /至少需要\s*4\s*名玩家/);
    console.log("ok reject_short_start");
  } finally {
    a.disconnect();
    b.disconnect();
  }
}

async function testInvalidSocketPayload(): Promise<void> {
  const socket = createClient();
  try {
    await waitForConnect(socket);
    socket.emit("create_room", { nickname: "BadPayload", profile: { accountType: "guest" } });
    const session = await onceSession(socket);
    await onceRoomState(socket);
    const error = onceError(socket);
    socket.emit("set_role", { roomId: session.roomId, role: "invalid-role" as never });
    assert.match(await error, /role|参数无效/);
    console.log("ok invalid_socket_payload");
  } finally {
    socket.disconnect();
  }
}

async function testHiddenRolesAndTargetedReaction(): Promise<void> {
  const sockets = {
    redSpy: createClient(),
    redOp: createClient(),
    blueSpy: createClient(),
    blueOp: createClient(),
    spectator: createClient()
  };

  try {
    await Promise.all(Object.values(sockets).map(waitForConnect));

    sockets.redSpy.emit("create_room", { nickname: "RedSpy", profile: { accountType: "guest" } });
    const redSpySession = await onceSession(sockets.redSpy);
    await onceRoomState(sockets.redSpy);

    const joins = [
      { socket: sockets.redOp, nickname: "RedOp" },
      { socket: sockets.blueSpy, nickname: "BlueSpy" },
      { socket: sockets.blueOp, nickname: "BlueOp" }
    ];

    for (const entry of joins) {
      entry.socket.emit("join_room", {
        roomId: redSpySession.roomId,
        nickname: entry.nickname,
        profile: { accountType: "guest" }
      });
      await onceSession(entry.socket);
      await onceRoomState(entry.socket);
    }

    sockets.redSpy.emit("set_team", { roomId: redSpySession.roomId, team: "red" });
    sockets.redOp.emit("set_team", { roomId: redSpySession.roomId, team: "red" });
    sockets.blueSpy.emit("set_team", { roomId: redSpySession.roomId, team: "blue" });
    sockets.blueOp.emit("set_team", { roomId: redSpySession.roomId, team: "blue" });

    sockets.redSpy.emit("set_role", { roomId: redSpySession.roomId, role: "spymaster" });
    sockets.blueSpy.emit("set_role", { roomId: redSpySession.roomId, role: "spymaster" });

    await waitForRoomState(
      sockets.redSpy,
      (room) =>
        room.players.filter((player) => player.team === "red").length === 2 &&
        room.players.filter((player) => player.team === "blue").length === 2 &&
        room.players.filter((player) => player.team === "red" && player.role === "spymaster").length === 1 &&
        room.players.filter((player) => player.team === "blue" && player.role === "spymaster").length === 1
    );

    sockets.redSpy.emit("start_game", { roomId: redSpySession.roomId });

    const spyView = await waitForRoomState(sockets.redSpy, (room) => room.phase === "playing");
    const opView = await waitForRoomState(sockets.redOp, (room) => room.phase === "playing");
    assert.ok(spyView.board.some((card) => card.role));
    assert.ok(opView.board.every((card) => card.revealed || card.role === undefined));

    const currentSpy = spyView.currentTeam === "red" ? sockets.redSpy : sockets.blueSpy;
    currentSpy.emit("submit_clue", { roomId: redSpySession.roomId, word: "first", count: 1 });
    await waitForRoomState(currentSpy, (room) => room.clue?.word === "first");
    const duplicateClueError = onceError(currentSpy);
    currentSpy.emit("submit_clue", { roomId: redSpySession.roomId, word: "second", count: 2 });
    assert.match(await duplicateClueError, /已经有提示/);

    sockets.spectator.emit("join_spectator", {
      roomId: redSpySession.roomId,
      nickname: "Watcher",
      profile: { accountType: "guest" }
    });
    const spectatorSession = await onceSession(sockets.spectator);
    const spectatorView = await waitForRoomState(
      sockets.spectator,
      (room) => room.spectators.some((spectator) => spectator.id === spectatorSession.participantId)
    );
    assert.ok(spectatorView.board.every((card) => card.revealed || card.role === undefined));

    sockets.redSpy.emit("send_reaction", {
      roomId: redSpySession.roomId,
      reaction: "flower",
      targetParticipantId: spectatorSession.participantId,
      targetParticipantType: "spectator" satisfies ParticipantType
    });
    const withReaction = await waitForRoomState(
      sockets.spectator,
      (room) => room.messages.some((message) => message.reaction === "flower")
    );
    const reactionMessage = withReaction.messages.at(-1);
    assert.equal(reactionMessage?.reaction, "flower");
    assert.equal(reactionMessage?.targetParticipantId, spectatorSession.participantId);
    assert.equal(reactionMessage?.targetParticipantType, "spectator");
    console.log("ok hidden_roles_and_targeted_reaction");
  } finally {
    Object.values(sockets).forEach((socket) => socket.disconnect());
  }
}

async function testDebugFillDisabledByDefault(): Promise<void> {
  const socket = createClient();
  try {
    await waitForConnect(socket);
    socket.emit("create_room", { nickname: "SoloHost", profile: { accountType: "guest" } });
    const session = await onceSession(socket);
    await onceRoomState(socket);

    socket.emit("update_room_settings", { roomId: session.roomId, boardMode: "7x7" satisfies BoardMode });
    const lobbySettings = await waitForRoomState(socket, (room) => room.settings.boardMode === "7x7");
    assert.equal(lobbySettings.settings.boardMode, "7x7");
    assert.equal(lobbySettings.viewer?.canEditRoom, true);

    const rejection = onceError(socket);
    socket.emit("debug_fill_room", { roomId: session.roomId });
    assert.match(await rejection, /调试|璋冭瘯/);
    console.log("ok debug_fill_disabled_by_default");
  } finally {
    socket.disconnect();
  }
}

async function testHostControls(): Promise<void> {
  const host = createClient();
  const nextHost = createClient();
  const blueSpy = createClient();
  const blueOp = createClient();

  try {
    await Promise.all([host, nextHost, blueSpy, blueOp].map(waitForConnect));
    host.emit("create_room", { nickname: "ControlHost", profile: { accountType: "guest" } });
    const hostSession = await onceSession(host);
    await onceRoomState(host);

    for (const entry of [
      { socket: nextHost, nickname: "NextHost" },
      { socket: blueSpy, nickname: "BlueSpy2" },
      { socket: blueOp, nickname: "BlueOp2" }
    ]) {
      entry.socket.emit("join_room", {
        roomId: hostSession.roomId,
        nickname: entry.nickname,
        profile: { accountType: "guest" }
      });
      await onceSession(entry.socket);
      await onceRoomState(entry.socket);
    }

    host.emit("set_team", { roomId: hostSession.roomId, team: "red" });
    nextHost.emit("set_team", { roomId: hostSession.roomId, team: "red" });
    blueSpy.emit("set_team", { roomId: hostSession.roomId, team: "blue" });
    blueOp.emit("set_team", { roomId: hostSession.roomId, team: "blue" });
    host.emit("set_role", { roomId: hostSession.roomId, role: "spymaster" });
    blueSpy.emit("set_role", { roomId: hostSession.roomId, role: "spymaster" });

    const ready = await waitForRoomState(
      host,
      (room) =>
        room.players.length === 4 &&
        room.players.filter((player) => player.team === "red").length === 2 &&
        room.players.filter((player) => player.team === "blue").length === 2 &&
        room.players.filter((player) => player.team === "red" && player.role === "spymaster").length === 1 &&
        room.players.filter((player) => player.team === "blue" && player.role === "spymaster").length === 1
    );
    const nextHostPlayer = ready.players.find((player) => player.nickname === "NextHost");
    assert.ok(nextHostPlayer);

    const nonHostError = onceError(nextHost);
    nextHost.emit("transfer_host", { roomId: hostSession.roomId, targetPlayerId: ready.players[0]!.id });
    assert.match(await nonHostError, /房主|鎴夸富/);

    host.emit("transfer_host", { roomId: hostSession.roomId, targetPlayerId: nextHostPlayer.id });
    const oldHostView = await waitForRoomState(host, (room) => room.hostPlayerId === nextHostPlayer.id);
    const newHostView = await waitForRoomState(nextHost, (room) => room.hostPlayerId === nextHostPlayer.id);
    assert.equal(oldHostView.viewer?.canDisbandRoom, false);
    assert.equal(newHostView.viewer?.canDisbandRoom, true);
    assert.equal(newHostView.viewer?.canTransferHost, true);

    nextHost.emit("start_game", { roomId: hostSession.roomId });
    const playing = await waitForRoomState(nextHost, (room) => room.phase === "playing");
    assert.equal(playing.viewer?.canReturnToLobby, true);

    nextHost.emit("return_to_lobby", { roomId: hostSession.roomId });
    const lobby = await waitForRoomState(host, (room) => room.phase === "lobby" && room.board.length === 0);
    assert.equal(lobby.phase, "lobby");
    assert.equal(lobby.hostPlayerId, nextHostPlayer.id);

    const closedEvents = Promise.all([host, nextHost, blueSpy, blueOp].map(onceRoomClosed));
    nextHost.emit("disband_room", { roomId: hostSession.roomId });
    const events = await closedEvents;
    assert.ok(events.every((event) => event.roomId === hostSession.roomId));
    console.log("ok host_controls");
  } finally {
    [host, nextHost, blueSpy, blueOp].forEach((socket) => socket.disconnect());
  }
}

async function main(): Promise<void> {
  await testNamedUserPersistence();
  await testPublicWordPackLifecycle();
  const created = await testCreateRoom();
  await testReconnect(created.roomId, created.session);
  await testStartRejectionWithTwoPlayers();
  await testInvalidSocketPayload();
  await testHiddenRolesAndTargetedReaction();
  await testDebugFillDisabledByDefault();
  await testHostControls();
  console.log("all e2e checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
