# Clutcher MP

Fresh Node.js multiplayer server built from scratch for a browser-based game. **No Rust or Cargo required.** The v0.2 userscript also starts Clutcher's actual map with **0 bots** and **server-assigned CT/T teams**.

The networking v0.1 milestone is intentionally simple: two browser clients join the same room and see each other's movements on a canvas test page.

## Requirements

- Node.js **22 or newer**
- npm

Check:

```bash
node --version
npm --version
```

## Run locally (including on Ubuntu)

```bash
npm install
npm start
```

By default the server listens on `http://127.0.0.1:8085`.

Open it in **two browser tabs**. Click **Connect** and **Join room** in both tabs (room name `lobby`), then use **WASD** in either tab. Your player is blue and other players are yellow.

WebSocket endpoint: `ws://127.0.0.1:8085/ws`

Health endpoint: `http://127.0.0.1:8085/health`

## Running on a VPS

If port 8085 is already allowed through the VPS network/firewall and you want to connect directly from another machine, bind to all network interfaces:

```bash
HOST=0.0.0.0 PORT=8085 npm start
```

Then use an SSH tunnel for safe initial testing from your own computer:

```bash
ssh -L 8085:127.0.0.1:8085 ubuntu@YOUR_VPS_IP
```

If you use that tunnel, leave the server's `HOST` at `127.0.0.1`, and open `http://127.0.0.1:8085` on your own computer. **Warning:** direct public access exposes an unauthenticated, unencrypted development server. Prefer the SSH tunnel until HTTPS/WSS and access controls are configured. If something is already listening on port 8085, stop it or choose another port.

## Tampermonkey prototype client

Install [client/clutcher-mp.user.js](client/clutcher-mp.user.js) into Tampermonkey to connect from the Clutcher HTTPS game page. The userscript has a room/connection HUD and an independent player-position minimap. The native **PLAY** button now launches the game map directly, with bots disabled and CT/T automatically assigned by the server. Remote 3D player models and real gameplay state synchronization are **not implemented yet**.

**Existing WSS proxy:** The script now targets `wss://mp.sillyhack.com/ws` via your existing HTTPS/WSS reverse proxy (public port 443). Node.js stays on internal port `8085`. Tampermonkey matches both HTTP and HTTPS Clutcher pages. The previous default `:8085` WSS URL is automatically migrated. See [setup and limitations](docs/tampermonkey.md).

## Development

```bash
npm test
npm run dev
```

The server is written in plain JavaScript (no TypeScript build). Networking uses the [ws](https://github.com/websockets/ws) package and Node's built-in HTTP server.

### Files

- `server/index.js` — HTTP and WebSocket server, connections, validation and broadcasts
- `server/world.js` — in-memory rooms, movement and authoritative snapshots
- `client/test.html` — standalone browser/networking test
- `tests/world.test.js` — built-in Node tests
- `docs/protocol.md` — message formats and limits
- `TODO.md` — milestones

**Not implemented:** Clutcher game-client integration, health/damage, weapons, collision, matchmaking, user authentication, production hosting.
