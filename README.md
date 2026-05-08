# ACG Codenames Online

Monorepo for a lightweight online Codenames-style party game with an ACG word pack.

## Apps

- `apps/web`: React + Vite client
- `apps/server`: Express + Socket.IO realtime server
- `packages/shared`: shared types, constants, and word pack handling

## Development

1. Install dependencies with `npm install`.
2. Start the server with `npm run dev:server`.
3. Start the web client with `npm run dev:web`.

The server uses Redis when `REDIS_URL` is available and falls back to in-memory room storage for local development.

## Verification

### Logic verification

Run the socket E2E suite:

```bash
npm run test:e2e
```

This covers the core room and match flow:

- create room
- reconnect
- invalid start rejection
- four-player start
- clue submission
- guessing
- end turn

For a full local verification sweep:

```bash
npm run verify
```

This runs:

- typecheck
- server E2E
- production build

### Browser smoke

Run the browser smoke check while local dev servers are already running:

```bash
npm run test:browser
```

Current smoke coverage:

- landing page boots
- nickname input and room entry controls render
- create room
- solo debug fill
- start match
- board renders with the expected `5x5` default card count
- homepage/lobby affordance probe report is written for future flows

Artifacts are written to `artifacts/browser-smoke/`:

- screenshots
- `smoke-report.json`

The report is intentionally lightweight. It records whether the current UI exposes entry points for:

- homepage room directory / active rooms list
- profile or login entry
- spectate / observer entry
- join-next-round style wording

This lets docs and playtest support keep pace even before the underlying feature set is fully implemented.

## Solo testing

If you are alone and cannot invite friends yet, use one of these two approaches.

### Option A: built-in solo debug mode

When running locally on `localhost`, the host can use a debug-only shortcut in the lobby:

1. Open `http://localhost:5173`
2. Create a room
3. Click the debug fill button
4. Click the start button

In this mode, the host can:

- see the full board
- submit clues for the current team
- guess cards for the current team
- end the current turn alone

This is the fastest way to verify a full round by yourself.

### Option B: simulate four real players

Open the same room in four isolated browser contexts so local storage does not collide:

1. Chrome normal window
2. Chrome incognito
3. Edge or Firefox normal window
4. Edge or Firefox private window

Then:

1. Open `http://localhost:5173`
2. Create a room in one window
3. Copy the room link into the other three windows
4. Use four different nicknames
5. Assign teams as `2 red + 2 blue`
6. Set one spymaster per team
7. Start the match

If you need LAN access from another device on the same network, use:

```bash
npm run dev:web:host
```

## Rich candidate pack review

The game runtime still consumes lightweight playable packs only:

- `name`
- `entries: string[]`

If your source data is a richer candidate JSON with fields like `display`, `aliases`, `type`, `franchise`, `difficulty`, `spoilerRisk`, and `reason`, import it through the homepage personal-pack area instead of using it directly in-room.

Current flow:

1. Log in with a named account.
2. Open `我的题库`.
3. Upload either:
   - a legacy playable pack (`string[]` or `{ name, entries: string[] }`)
   - a rich candidate pack (`packName`, `summary`, `recommendedBoardModes`, `entries[]`, `rejectedExamples[]`)
4. If the file is a candidate pack, it opens in the review surface instead of being saved directly.
5. Filter entries by search / type / franchise / spoiler level.
6. Approve or reject entries in bulk or one by one.
7. Export the approved subset into a playable personal pack.

Important behavior:

- candidate packs stay in frontend review state for now
- only exported playable packs are persisted to the named user account
- room-level pack upload still expects a lightweight playable pack
- if you upload a rich candidate JSON inside a room, the UI will tell you to review/export it on the homepage first

## Browser playtest checklist

Use this checklist for browser-level QA after the server and web client are already running. The target is not only logical correctness, but player-visible clarity: homepage entry, room setup, turn ownership, board readability, reconnect behavior, and debug-mode isolation.

### Key states to capture

Capture one screenshot for each state below. If a bug appears, keep the screenshot and record the browser, room code, role, and last visible room event.

1. `Homepage / landing`
   - Nickname input is visible
   - Create and join controls are visible
   - Expected: a new player can understand how to get into a room immediately
2. `Lobby / empty room`
   - One host only
   - Room code visible
   - Teams not fully assigned
   - Expected: the page clearly shows the room is still preparing and why the game cannot start
3. `Lobby / solo debug ready`
   - Host on `localhost`
   - Debug fill control visible
   - Expected: debug controls are clearly local-only and visually separate from normal multiplayer guidance
4. `Lobby / ready to start`
   - Four players present or host has filled test seats
   - One spymaster per team
   - Expected: start is available and the room no longer shows missing-player or missing-spymaster guidance
5. `Playing / current spymaster turn`
   - Match started
   - Current team spymaster view
   - Expected: clue input is visible, current team is obvious, and the center board remains readable
6. `Playing / current operative turn`
   - Clue already submitted
   - Current team operative view
   - Expected: playable unrevealed cards are obvious, non-action players understand why they cannot act, and hidden identities are not leaked
7. `Finished / result state`
   - Match ended by final correct card or assassin
   - Expected: winner banner, result text, and rematch affordance are shown outside the normal action area

### Fixed playtest flows

Run these flows in order. Stop only when observed behavior differs from the expected outcome.

#### Flow 1: normal four-player room

1. Open four isolated browser contexts.
2. Host creates a room.
3. Other three players join from the invite link.
4. Assign `2 red + 2 blue`.
5. Set exactly one spymaster per team.
6. Start the match.
7. Current spymaster submits a clue.
8. Current operative guesses one card.
9. End the turn.

Expected outcome:

- room enters `playing`
- current team and clue are visible
- only the allowed player can submit a clue or guess
- after `end turn`, the active team switches cleanly

#### Flow 2: invalid start rejection

1. Create a room with one or two players only.
2. Try to start immediately.

Expected outcome:

- start is blocked
- the UI explains what is missing: player count, team setup, or spymaster setup

#### Flow 3: solo debug round

1. Open `http://localhost:5173` on the host machine.
2. Create a room.
3. Click the debug fill button.
4. Click the start button.
5. Submit a clue as the host.
6. Guess cards as the host.
7. End the turn as the host.
8. Continue until the match ends.

Expected outcome:

- one person can complete a full round locally
- debug controls do not require extra browser windows
- board roles are visible only because this is local debug mode

#### Flow 4: refresh and reconnect

1. Join a room and keep it open until the room reaches `lobby` or `playing`.
2. Refresh the page.

Expected outcome:

- the player returns to the same room automatically
- nickname and seat are preserved
- the room state matches the other clients

#### Flow 5: post-game leave and recreate

1. Finish a match.
2. Leave the room.
3. Create a new room from the landing page.

Expected outcome:

- old room state does not leak into the new room
- invite link and room code update correctly
- previous result UI is gone

### Forward-looking homepage and account flows

These flows matter for the next feature wave. Keep them in the checklist even if the current smoke report says the entry points are not present yet.

#### Flow 6: homepage active room list

Expected homepage affordances:

- a visible list of in-progress rooms
- clear room status, mode, and player count
- separate actions for create, join by code, and browse active rooms

Validation focus:

- active rooms do not look clickable if they are not actually joinable
- spectator and join-next-round affordances are visually distinct

#### Flow 7: spectate and join-next-round

Expected behavior:

- a user can spectate a room already in progress
- a user who wants to play instead of spectate is queued for the next round
- the UI tells the queued player they are waiting for the current round to finish

Validation focus:

- spectator state is obvious
- hidden card identities are not leaked beyond intended permissions
- rematch transition moves queued players into the lobby cleanly

#### Flow 8: login and personal settings

Expected homepage affordances:

- username-based sign-in entry
- personal settings entry
- editable profile surface for user ID, avatar, and personal word packs

Validation focus:

- returning with the same username restores the expected local identity
- avatar and profile changes do not break room presence
- local profile state and room session state stay in sync after refresh

## Bug report template

When you hit a bug, record it with this minimum template:

```md
State: homepage | lobby | playing | finished
Flow: 1-8
Role: host | spymaster | operative | spectator | queued player | debug host
Browser: Chrome / Edge / Firefox / mobile
Steps:
1.
2.
3.

Observed:

Expected:

Evidence:
- screenshot path
- room code
- last visible event text
```

## High-value things to watch for

- `Board obstruction`: side panels or banners should not dominate the center board area.
- `Turn clarity`: a player should immediately know whether they can act and why.
- `Identity leakage`: non-spymaster views must never expose hidden card roles.
- `Reconnect drift`: after refresh, the restored seat and role must match the server state.
- `Debug isolation`: solo debug affordances should feel like local test tools, not normal production actions.
- `Homepage honesty`: do not show directory, profile, or spectate controls as actionable before the flow actually exists.
