# Tampermonkey client — v0.1

Install `client/clutcher-mp.user.js` into Tampermonkey and open either `http://clutcher.io/` or `https://clutcher.io/` (including subdomains).

The script adds a small **Clutcher MP** HUD with:

- WebSocket endpoint, room name, connect/join/disconnect controls
- Auto-join, reconnect with exponential backoff, connection state, ping and player count
- WASD directional inputs sent to the Node.js multiplayer server
- Minimap showing **network prototype positions** for players in the same room
- Persistent endpoint and room settings via Tampermonkey

## Existing reverse proxy / HTTP and HTTPS game URLs

Your existing reverse proxy exposes `wss://mp.sillyhack.com/ws` (standard public TLS port 443). The Node.js multiplayer server continues to listen on `http://127.0.0.1:8085`, so **no new external port is needed** if your existing proxy still forwards the WebSocket path correctly.

- Userscript matches both `http://clutcher.io/*` and `https://clutcher.io/*`, including `www` and other subdomains.
- The public WebSocket URL uses **WSS on both HTTP and HTTPS pages** for consistent behavior.
- The client migrates the previous default `wss://mp.sillyhack.com:8085/ws` to `wss://mp.sillyhack.com/ws` without changing custom URLs.
- The backend still uses `/ws`; the old multiplayer script used the same path, but **its messages are not interchangeable**. The new Node server expects `join_room`, not legacy `join`/`serverId`; it has no legacy `/servers` discovery API.

If the client fails to connect, verify that the existing reverse proxy forwards the WebSocket upgrade headers and that `mp.sillyhack.com` has a valid TLS certificate. Do not replace the WSS URL with plain `ws://` on an HTTPS page.

## Current limitations

This is a **networking bridge/prototype**, not a full in-game multiplayer modification. It does *not* spawn game characters, read the game's real coordinates, or synchronize weapons/combat. The server itself only understands 2D test movement (`input: {x, y}`) and publishes simple 2D snapshots. Real gameplay integration needs a new mapping between actual game state and an expanded multiplayer protocol.

The browser may additionally block WebSockets via the game's Content Security Policy. Check browser DevTools if WSS and TLS are correct but it still fails. Do not disable browser security.

## Verify

1. Run Node.js server on VPS (`HOST=127.0.0.1 PORT=8085 npm start`, behind your existing reverse proxy).
2. Confirm the TLS endpoint works and presents a valid certificate.
3. Install script in two browser sessions, both joining `lobby`.
4. Press WASD in one game tab; watch its dot move in the other tab's HUD.
