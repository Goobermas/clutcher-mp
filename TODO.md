# Clutcher Multiplayer — TODO

> Goal: Build a maintainable, testable multiplayer server and compatible browser client for Clutcher, starting with a **small playable MVP** before expanding game modes.
>
> **MVP definition:** Two players can connect to one room, see each other move, exchange basic gameplay events, finish a round, and reconnect without crashing the server.

## Phase 0 — Project setup (start here)

- [ ] Add a `README.md` explaining the project, how to run it, and its current status.
- [ ] Decide on the stack (suggestion: Node.js + WebSocket for a browser-based client) and record the decision.
- [ ] Create `server/`, `client/`, `shared/`, `docs/`, and `tests/` folders as needed.
- [ ] Add `.gitignore`, `.env.example`, a license decision, and npm scripts (`dev`, `start`, `test`).
- [ ] Add a basic CI workflow to run checks on every push.
- [ ] Document how to use the game assets/source legally; keep third-party assets and secrets out of Git.

## Phase 1 — Audit existing multiplayer work

- [ ] Gather the **latest server source**, any older server versions, and the most recent matching client script.
- [ ] Record known-working behaviors, broken behaviors, and protocol differences between versions.
- [ ] Identify where the existing client handles networking, player state, input, shooting, and game-mode state.
- [ ] Inventory the actual game modes and their rules in `docs/gamemodes.md` (don't guess from UI names).
- [ ] Write a versioned message/protocol specification in `docs/protocol.md`.

## Phase 2 — Networking MVP

- [ ] Start a local server and accept WebSocket connections.
- [ ] Implement connection handshake, protocol version checks, and player/session IDs.
- [ ] Implement room creation, joining, leaving, and room size limits.
- [ ] Send initial world state and broadcast player join/leave events.
- [ ] Synchronize player position, rotation, and movement at a controlled tick rate.
- [ ] Implement ping/heartbeat, disconnect cleanup, and a safe reconnect flow.
- [ ] Validate incoming messages and cap payload sizes and message rates.

## Phase 3 — Playable matches

- [ ] Choose one simple game mode for the **first playable build**.
- [ ] Add a server-owned match lifecycle: lobby → warmup → live → round end → next round.
- [ ] Synchronize spawn points, teams (where relevant), and player deaths/respawns.
- [ ] Implement shooting, hit validation, damage, and kill events with server-side checks.
- [ ] Synchronize score, round timer, win conditions, and the scoreboard.
- [ ] Test match start/end, player leaves mid-round, and late join scenarios.

## Phase 4 — Client compatibility

- [ ] Create or adapt a client network adapter that speaks the documented protocol.
- [ ] Map server events into the game's existing player, HUD, weapon, and match systems.
- [ ] Add interpolation for remote players and reasonable latency handling.
- [ ] Show useful connection, timeout, and version-mismatch errors in the client.
- [ ] Confirm two browsers on separate machines can play together reliably.

## Phase 5 — More game modes

- [ ] Add each game mode **one at a time** using the inventory in `docs/gamemodes.md`.
- [ ] Separate shared match logic from mode-specific rules (spawns, teams, rounds, scoring).
- [ ] Add per-mode settings and automated tests for win conditions.
- [ ] Verify map support, collision assumptions, and weapon rules for each mode.

## Phase 6 — Reliability, security, and deployment

- [ ] Add structured logs, error handling, and configuration validation.
- [ ] Add automated tests for protocol parsing, rooms, disconnects, and game-mode rules.
- [ ] Run a small load test with simulated players and measure CPU, memory, and bandwidth.
- [ ] Configure a VPS deployment (process supervision, firewall, HTTPS/WSS via reverse proxy).
- [ ] Add graceful restart/shutdown behavior and a health-check endpoint.
- [ ] Document deployment, backup, troubleshooting, and rollback steps.

## First milestone — what to do next

1. [ ] Commit the current server and matching client source (or clearly document where they live).
2. [ ] Write down the game's actual network messages and supported modes.
3. [ ] Boot the server locally and confirm one client connects.
4. [ ] Connect a second client and synchronize both player positions.
5. [ ] Record a reproducible two-player test and note remaining bugs.

**Definition of done:** Two players can join the same room, see one another moving, and leave/rejoin cleanly. Prioritize this before adding every game mode.

---

### Project notes / decisions

- **Language/runtime:** TBD
- **Transport/protocol:** TBD
- **Authoritative server design:** TBD (recommended for combat/state that affects other players)
- **Existing server version to build from:** TBD
- **First supported game mode:** TBD
- **Hosting target:** TBD
