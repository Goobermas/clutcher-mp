# Tampermonkey client — v0.1

Install `client/clutcher-mp.user.js` into Tampermonkey and open `https://clutcher.io/` (or a supported subdomain).

The script adds a small **Clutcher MP** HUD with:

- WebSocket endpoint, room name, connect/join/disconnect controls
- Auto-join, reconnect with exponential backoff, connection state, ping and player count
- WASD directional inputs sent to the Node.js multiplayer server
- Minimap showing **network prototype positions** for players in the same room
- Persistent endpoint and room settings via Tampermonkey

## Server address / HTTPS gotcha

The script starts with `wss://mp.sillyhack.com:8085/ws`, based on the requested server name and port.

**This will not work against a plain `ws://` Node.js server until TLS is configured.** Clutcher is an HTTPS site, and the browser blocks insecure `ws://` connections. Use either:

1. Terminate TLS for **port 8085** using a valid certificate for `mp.sillyhack.com` and forward to the Node.js server; use `wss://mp.sillyhack.com:8085/ws`. This requires a TLS proxy or HTTPS-enabled backend, not just switching the protocol text.
2. Preferably, front the existing HTTP/WebSocket service (localhost:8085) with a TLS-enabled reverse proxy or Cloudflare Tunnel on standard port **443**; enter `wss://mp.sillyhack.com/ws` into the HUD. This normally avoids opening any *new* application ports.

If `mp.sillyhack.com` is orange-cloud proxied on Cloudflare DNS, **8085 isn't on Cloudflare's supported proxy port list**. Use WSS through 443 or a supported HTTPS port instead.

## Current limitations

This is a **networking bridge/prototype**, not a full in-game multiplayer modification. It does *not* spawn game characters, read the game's real coordinates, or synchronize weapons/combat. The server itself only understands 2D test movement (`input: {x, y}`) and publishes simple 2D snapshots. Real gameplay integration needs a new mapping between actual game state and an expanded multiplayer protocol.

The browser may additionally block WebSockets via the game's Content Security Policy. Check browser DevTools if WSS and TLS are correct but it still fails. Do not disable browser security.

## Verify

1. Run Node.js server on VPS (`HOST=127.0.0.1 PORT=8085 npm start`, behind your secure proxy).
2. Confirm the TLS endpoint works and presents a valid certificate.
3. Install script in two browser sessions, both joining `lobby`.
4. Press WASD in one game tab; watch its dot move in the other tab's HUD.
