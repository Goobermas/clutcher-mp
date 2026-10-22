# Clutcher MP — TODO

> **Fresh implementation, no old server code.** Backend: **Node.js + ws**, client: plain JavaScript browser test; actual Clutcher integration later.
>
> **v0.1 milestone:** Two clients in one room can see synchronized player movement.

## Phase 0 — Clean Node.js foundation

- [x] Replace Rust/Cargo project with Node.js (plain JavaScript, no compiler).
- [x] Add `package.json` with `npm start`, `npm run dev`, and `npm test`.
- [x] Add README, gitignore, environment example and protocol docs.
- [x] Add test client and Node's built-in unit tests.
- [ ] Run `npm install` on the VPS and verify `npm test` passes.
- [ ] Add CI and decide on a project license.

## Phase 1 — WebSocket networking

- [x] Create HTTP server and WebSocket `/ws` endpoint.
- [x] Generate unique player IDs and report protocol version.
- [x] Implement in-memory rooms with limits, joining, switching and cleanup.
- [x] Validate input and apply basic payload/rate limits and heartbeat checks.
- [x] Add `/health` endpoint.
- [ ] Add live socket integration tests and more extensive failure handling.

## Phase 2 — Two-player movement MVP

- [x] Implement authoritative positions, directions and 20 Hz room snapshots.
- [x] Normalize diagonal movement, clamp positions.
- [x] Add browser canvas test client with controls and ping display.
- [ ] **Run two browser tabs and verify shared movement works.**
- [ ] Test on separate computers, disconnections, rejoining and lag.
- [ ] Add interpolation and client reconciliation.

## Phase 3 — Real Clutcher client

- [x] Add a Tampermonkey connection/testing HUD for rooms, 2D movement, and snapshots (not game-integrated).
- [x] Configure the userscript for the existing WSS proxy endpoint on port 443 (backend on 8085).
- [x] Match both HTTP and HTTPS Clutcher game pages.
- [x] Intercept native Play button to load the selected map with zero bots.
- [x] Hide native team selection; use server-balanced CT/T assignments.
- [x] Lock map/mode per room and share them across joiners.
- [x] Add team assignment and room-settings unit tests.
- [ ] Verify that the existing reverse proxy works with the new Node.js server and client.
- [ ] Test Play auto-loading on Clutcher v0.21 in two browser sessions.
- [ ] Prevent native single-player Defusal logic from ending empty rounds unexpectedly.
- [ ] Synchronize actual 3D player transforms and spawn remote player models.

- [ ] Identify legal/usable game-client integration points.
- [ ] Write new client networking adapter for protocol v1.
- [ ] Sync player model spawning, removal, animations and transforms.
- [ ] Connect maps, UI and latency-handling systems.

## Phase 4 — Gameplay

- [x] Add per-room server-owned shared 5s countdown / 10min round / 5s result timer.
- [x] Gate match start on one loaded CT and T; pause/reset countdown when teams become unready.
- [x] Broadcast `match_state` with timer, round, and CT/T scores.
- [x] Display server clock/score in Tampermonkey panel and native Defusal HUD.
- [x] Prevent the native Defusal controller from ending/awarding its own rounds.
- [x] Add ready/timer/score unit tests and a test-page match clock.
- [ ] Verify native HUD updates in two real browser game sessions.
- [ ] Add server-authoritative networked kills and TDM scoring.
- [ ] Add C4 plant/defuse state and proper server-determined round victories.


- [ ] Design server-side health, combat, weapon and hit detection rules.
- [ ] Add match lifecycle: lobby → warmup → live → results.
- [ ] Implement scores, teams, rounds, respawning and win conditions.
- [ ] Implement the first game mode and verify game rules.
- [ ] Add modes incrementally with tests.

## Phase 5 — Production

- [ ] Add identity/authentication and robust abuse prevention.
- [ ] Add logs/metrics, load testing, and benchmarks.
- [ ] Deploy behind HTTPS/WSS reverse proxy with access controls.
- [ ] Configure process supervision and safe restart/rollback.

## Next action

1. [ ] On the Ubuntu VPS: `git pull && npm install && npm test && npm start`.
2. [ ] Verify `/health` and connect two tabs (SSH tunnel recommended).
3. [ ] Confirm two-player WASD synchronization and disconnect cleanup.
4. [ ] Only then implement the actual Clutcher client adapter.

**No Rust/Cargo required.**
