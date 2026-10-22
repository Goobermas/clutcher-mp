# Clutcher MP — Development TODO

> **Greenfield project:** Build multiplayer from scratch. **Backend: Rust** (Tokio + Axum WebSockets). Browser/game client: JavaScript or TypeScript. Do not reuse old multiplayer code.
>
> **v0.1 goal:** Two browser clients join one room and see synchronized movement. Code for the initial prototype is committed; runtime verification is still required.

## Phase 0 — Rust foundation

- [x] Choose server stack: Rust + Tokio + Axum + WebSockets.
- [x] Add `Cargo.toml`, `src/main.rs`, `.gitignore`, and `.env.example`.
- [x] Write `README.md` with build and run instructions.
- [x] Add first server and browser test client to the repository.
- [ ] Run `cargo fmt`, `cargo test`, and `cargo clippy` locally; fix any issues.
- [ ] Add GitHub Actions CI with build/test checks.
- [ ] Decide on a license and clarify use of original game assets.

## Phase 1 — Protocol and rooms

- [x] Define versioned JSON WebSocket messages in `docs/protocol.md`.
- [x] Add connection welcome with unique player ID.
- [x] Implement room creation, joining, switching, capacity limits and cleanup.
- [x] Add bounded outbound queues and basic input validation/rate limiting.
- [ ] Add session heartbeats and explicit idle timeouts.
- [ ] Add join/leave event messages.
- [ ] Add protocol integration tests using real sockets.

## Phase 2 — Player synchronization

- [x] Implement server-authoritative position state and movement inputs.
- [x] Run the simulation at 20 ticks per second with snapshots.
- [x] Normalize diagonal movement and limit map coordinates.
- [x] Create a browser canvas client with WASD controls and ping display.
- [ ] **Actually test two browser tabs moving in the same room.**
- [ ] Test two separate devices on a LAN.
- [ ] Add interpolation, sequence numbers, and client reconciliation.
- [ ] Add reconnect handling and congestion behavior testing.

## Phase 3 — Real Clutcher integration

- [ ] Inspect the actual game client's integration points and allowed assets.
- [ ] Write a brand-new network adapter for protocol v1.
- [ ] Synchronize player transforms, spawning, and despawning.
- [ ] Wire server states to the game UI.
- [ ] Test with two players in the real game client.

## Phase 4 — Gameplay and game modes

- [ ] Design server-side combat, damage, health, and respawning.
- [ ] Build the lobby → warmup → live → results match state machine.
- [ ] Add a scoreboard, timer, round rules, and win conditions.
- [ ] Implement and test the first real game mode.
- [ ] Isolate reusable game-mode logic and add more modes one by one.

## Phase 5 — Reliability and production deployment

- [ ] Add real authentication/authorization before internet exposure.
- [ ] Add metrics, stronger abuse controls, and proper disconnect heartbeat detection.
- [ ] Load-test rooms with simulated clients.
- [ ] Deploy on a VPS behind HTTPS/WSS and add process supervision.
- [ ] Document production configuration, rollback, and releases.

### Immediate next steps

1. [ ] Clone the repository and install Rust with Cargo.
2. [ ] Run `cargo run` and open the test page at `http://127.0.0.1:3000`.
3. [ ] Test two browser tabs in `lobby`; verify movement and disconnects.
4. [ ] Run formatting, unit tests, and Clippy; fix anything reported.
5. [ ] Start the real game-client adapter **only after** networking MVP passes.

**Hosting:** localhost first; VPS later.
