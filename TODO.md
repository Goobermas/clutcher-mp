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

- [x] Replicate equipped weapon/knife skins, kit, wear and seed.
- [x] Replicate glove models and glove paint/float data.
- [x] Handle non-default knives through the agent's world-model API.
- [x] Relay inspect, draw, reload stages, empty-mag reload, knife attack, shot, step, landing, scope, grenade gesture, death and respawn.
- [x] Filter cosmetic payload keys, cap strings/nesting, and validate animation types server-side.
- [x] Add cosmetic and animation unit tests.
- [ ] Verify *every* gun and knife skin against the live game render pipeline.
- [ ] Verify first/third-person inspect, reload, crouch, walk, firing and weapon swap clips in two browsers.
- [ ] Evaluate sticker/charm visibility and agent outfit customization if supported by the game assets.
- [ ] Implement actual grenade objects and objective action replication.


- [x] Match the native game mode timings: Defusal 5s freeze, 115.2s rounds, 8/15 target; TDM 600s and 6s result period.
- [x] Add remote human players as AI-disabled Clutcher bot models, synchronized to real 3D coordinates.
- [x] Relay validated player transform, crouch, airborne and weapon state.
- [x] Relay shot visuals, reloads, jumps and landing events to other clients.
- [x] Make server trigger native round respawns at match boundaries.
- [x] Test game-state validation, action routing, and native match deadlines.
- [ ] Verify remote player appearance, movement and animations in two live Clutcher tabs.
- [ ] Integrate actual combat, sound, skins and actions more fully.


- [x] Add per-room server-owned timers, tailored per selected mode.
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
4. [ ] Test visual remote bots and action animations in two live game sessions.

**No Rust/Cargo required.**
