# Clutcher MP — Development TODO

> **Greenfield project:** This is a brand-new multiplayer implementation. Write the server, networking protocol, and client integration **from scratch**. Do not copy or depend on any previous Clutcher multiplayer servers or client scripts.
>
> **First milestone:** Open two test clients, join the same room, and see each other's movement update in real time.

## Phase 0 — Foundation

- [ ] Choose the initial stack (proposed: Node.js + TypeScript + WebSocket).
- [ ] Create the project structure: `server/`, `client/`, `shared/`, `docs/`, `tests/`.
- [ ] Add `package.json`, TypeScript configs, `.gitignore`, `.env.example`, and run scripts.
- [ ] Write a `README.md` with installation, local development, and project goals.
- [ ] Set coding conventions, formatting/linting, and a basic GitHub Actions test job.
- [ ] Define scope of v0.1: connections + rooms + two-player movement only.

## Phase 1 — Design the new protocol

- [ ] Decide server tick rate and network update rate; make both configurable.
- [ ] Define JSON messages for `hello`, `welcome`, `join_room`, `room_state`, `input`, `snapshot`, `player_joined`, `player_left`, `ping`, and `error`.
- [ ] Define message payload types and protocol version in `shared/`.
- [ ] Document the wire protocol and state transitions in `docs/protocol.md`.
- [ ] Decide what the server owns (authoritative player/session/room state) versus client-only rendering.
- [ ] Specify input bounds, message-size limits, rate limits, and disconnect behavior.

## Phase 2 — Build a server from zero

- [ ] Implement a WebSocket listener and clean configuration loading.
- [ ] Add handshake/version validation and unique player/session IDs.
- [ ] Build in-memory room creation, joining, leaving, and capacity limits.
- [ ] Implement a fixed-rate game loop and a minimal authoritative player position state.
- [ ] Receive and validate movement inputs; publish periodic state snapshots.
- [ ] Broadcast join/leave events and remove disconnected players.
- [ ] Add heartbeat/timeouts, structured logging, and safe shutdown.
- [ ] Write unit tests for room lifecycle, validation, and basic movement.

## Phase 3 — Build a minimal test client from zero

- [ ] Create a basic browser page with **Connect**, **Join Room**, and **Disconnect** controls.
- [ ] Draw players as simple labeled rectangles/dots on a canvas; no game integration yet.
- [ ] Capture WASD movement and send input messages to the server.
- [ ] Render incoming state snapshots for local and remote players.
- [ ] Show connection state, player ID, room ID, and round-trip latency.
- [ ] Verify two browser tabs (then two machines) can join, move, and disconnect cleanly.
- [ ] Test lag, packet bursts, malformed inputs, refresh/rejoin, and server restart.

## Phase 4 — Integrate with Clutcher

- [ ] Inspect the actual game's integration points and permitted source/assets before writing the adapter.
- [ ] Write a **new** client-side network adapter for the v0.1 protocol.
- [ ] Translate game input and player transforms into network messages.
- [ ] Spawn/despawn remote players and update their visual state.
- [ ] Add snapshot interpolation for remote players and tune responsiveness.
- [ ] Handle map initialization, spawn positions, reconnection, and UI errors.
- [ ] Verify a two-player session works within the game rather than only in the test page.

## Phase 5 — Combat and matches

- [ ] Define weapon, projectile/hitscan, health, damage, and respawn data structures.
- [ ] Implement server-side validation of combat events and fair hit handling.
- [ ] Create a match state machine: lobby → warmup → live → results.
- [ ] Implement scores, round timer, scoreboard, spawn rules, and win conditions.
- [ ] Select **one** first game mode and document its rules in `docs/gamemodes.md`.
- [ ] Test late joins, player departures mid-round, simultaneous events, and match reset.

## Phase 6 — More modes and polish

- [ ] Define reusable game-mode interfaces and isolate mode-specific rules.
- [ ] Add additional game modes one by one with tests for each mode.
- [ ] Improve prediction/reconciliation and remote-player smoothing if needed.
- [ ] Add configuration for rooms, maps, teams, limits, and match settings.
- [ ] Profile CPU, memory, bandwidth, and player-count capacity.

## Phase 7 — Deployment and maintenance

- [ ] Add a health endpoint, robust error handling, and production logs.
- [ ] Prepare a VPS deployment with process supervision and TLS/WSS proxying.
- [ ] Configure firewall, connection limits, and safe secrets management.
- [ ] Automate tests/builds in CI and document release/rollback steps.
- [ ] Run multi-player soak tests and document known issues.

---

## First tasks — do these in order

1. [ ] Create the clean Node.js/TypeScript project skeleton.
2. [ ] Start a WebSocket server and accept one test client.
3. [ ] Implement the protocol handshake and room creation/joining.
4. [ ] Add authoritative movement and periodic room snapshots.
5. [ ] Build the canvas test client and connect two browser tabs.
6. [ ] Confirm both players can move, disconnect, and rejoin without stale player state.

**v0.1 done when:** Two browser clients share a room and display each other's movement reliably. No weapons, matchmaking, legacy code, or extra game modes required.

## Decisions to make

- **Stack:** Proposed Node.js + TypeScript + WebSocket; not finalized
- **Networking architecture:** Server-authoritative; details TBD
- **First game mode:** TBD after basic multiplayer works
- **Hosting:** Local first; VPS later
- **Dependencies on legacy MP code:** None
