# Clutcher MP

Fresh Node.js multiplayer server built from scratch for a browser-based game. **No Rust or Cargo required.**

The v0.1 milestone is intentionally simple: two browser clients join the same room and see each other's movements on a canvas test page.

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

By default the server listens on `http://127.0.0.1:3000`.

Open it in **two browser tabs**. Click **Connect** and **Join room** in both tabs (room name `lobby`), then use **WASD** in either tab. Your player is blue and other players are yellow.

WebSocket endpoint: `ws://127.0.0.1:3000/ws`

Health endpoint: `http://127.0.0.1:3000/health`

## Running on a VPS

For access beyond the VPS itself, bind to all network interfaces:

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

Then use an SSH tunnel for safe initial testing from your own computer:

```bash
ssh -L 3000:127.0.0.1:3000 ubuntu@YOUR_VPS_IP
```

If you use that tunnel, leave the server's `HOST` at `127.0.0.1`, and open `http://127.0.0.1:3000` on your own computer. Avoid exposing port 3000 to the internet at this prototype stage: there is no authentication or encryption. Configure a reverse proxy with HTTPS/WSS and access controls before public deployment.

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
