# Clutcher MP

A **brand-new Rust multiplayer backend** built from scratch for a future Clutcher multiplayer client. This repository does not reuse any old multiplayer server or client code.

The first milestone is intentionally small: two browser tabs join the same room and watch each other move.

## Requirements

- Recent stable [Rust](https://rustup.rs/) toolchain with Cargo
- A modern browser

## Start the server

```bash
cargo run
```

Open **http://127.0.0.1:3000** in two tabs, then:

1. Click **Connect** in each tab.
2. Click **Join room** using the same room name (default: `lobby`).
3. Click one tab and move the blue player with **WASD**. The other tab should display it as yellow.
4. Disconnect or close one tab; the other should stop displaying that player on the next snapshot.

The Rust HTTP server serves the test client at `/`, a basic health endpoint at `/health`, and the WebSocket endpoint at `/ws`.

## Configuration

Defaults: `HOST=127.0.0.1`, `PORT=3000`. Set variables in your shell before running:

```bash
# Linux/macOS
HOST=0.0.0.0 PORT=3000 cargo run
```

```powershell
# Windows PowerShell
$env:HOST = "0.0.0.0"
$env:PORT = "3000"
cargo run
```

Binding to `0.0.0.0` permits other devices on your network to connect (subject to firewall rules). This development server has **no authentication or TLS**; don't expose it to the public internet as-is.

## Development

```bash
cargo fmt
cargo test
cargo clippy --all-targets
```

The networking protocol is documented in [docs/protocol.md](docs/protocol.md). The roadmap is in [TODO.md](TODO.md).

## Current scope

- Rust + Tokio + Axum WebSockets
- In-memory rooms, max 16 players each
- Server-side movement simulation at 20 ticks/second
- JSON input and state snapshots
- Input validation, rate limit, bounded send buffers, and disconnect cleanup
- Browser-based canvas test client (not integrated into the actual game)

**Not built yet:** weapon synchronization, collision, game modes, persistence, authentication, reconnection, anti-cheat, and production deployment.
