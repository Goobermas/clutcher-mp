# Tampermonkey client — v0.1

Install `client/clutcher-mp.user.js` into Tampermonkey and open either `http://clutcher.io/` or `https://clutcher.io/` (including subdomains).

The script adds a small **Clutcher MP** HUD with native Play integration and:

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

## Play button, bots and team assignment (v0.2)

The new Tampermonkey userscript reads the actual game entry points from the supplied `main.js` build: `window.game.startGame(map, botCount, difficulty, mode)` and `window.game.finishTeamSelect(team)`.

1. Once the socket connects, the client joins the selected room. The server assigns CT or T and sends back the room's authoritative map and mode.
2. Press **PLAY** in Clutcher's native menu. The script intercepts the normal local-game Play button and requests a fresh room acknowledgement so solo players can change map/mode before starting.
3. On `joined`, the script calls `startGame(map, 0, 0, mode)`, then automatically calls `finishTeamSelect(assignedTeam)` after map loading.
4. The native team selector and menu outfit choice are hidden. Native bot settings are switched off, and the `startGame` method is wrapped to force **0** bots.
5. The client HUD displays assigned team, map/mode, and CT/T player counts. The actual game is still a local world per browser, not yet a synchronized 3D multiplayer match.

**Important:** Run the **updated server** with `git pull && npm install && npm test && HOST=127.0.0.1 PORT=8085 npm start` (adapt HOST to your proxy's backend route). Older server builds do not send team/map/mode in `joined` and will be rejected by v0.2 client.

## Timer and score synchronization (v0.3)

The Node server is the authority for `match_state` messages at 4 Hz. The userscript displays the CT/T score, match phase, round, and clock in its panel and mirrors the timer/round/score to the native game HUD when available. Clutcher's local round-ending logic is disabled while the multiplayer match is active to prevent singleplayer Defusal from overruling the server.

The server starts a five-second countdown **only when one CT and one T have both clicked Play and completed loading**. Defusal has 115.2-second rounds, five-second freezes and first to eight rounds out of 15; TDM has ten-minute matches and six-second results. A Defusal timeout currently awards CT one point because bomb interactions are not networked. Returning to menu or disconnecting pauses the match until both sides are ready again.

**Not implemented:** authoritative combat/damage, legitimate TDM kill scoring, C4 interactions and T victories. Real 3D location and action *visuals* are now synchronized. Full round scoring can only be implemented after these gameplay messages exist.

## Remote-player models and actions (v0.4)

On the actual map, Clutcher MP now places other players into the bot model renderer. These aren't AI opponents—the script overrides each remote bot's autonomous update so it follows incoming coordinates and rotations, with crouching, jumping, currently held weapon, shooting tracers, and reload animations.

The server relays `player_state` packets with the browser's real 3D coordinates and `player_action` events for gunshots/reloads/jumps/landings. When another client leaves, its remote model is removed. If you're alone there will be **zero** bots: no opponents and no AI.

This is a **visual networking prototype**. Hits, health, kills, weapons firing logic, collision reconciliation and C4 are not yet server-authoritative. The view/model APIs were inspected from the supplied obfuscated game bundle and older client reference; live-game compatibility remains unverified.

## Current limitations

The browser may additionally block WebSockets via the game's Content Security Policy. Check browser DevTools if WSS and TLS are correct but it still fails. Do not disable browser security.

## Verify

1. Run Node.js server on VPS (`HOST=127.0.0.1 PORT=8085 npm start`, behind your existing reverse proxy).
2. Confirm the TLS endpoint works and presents a valid certificate.
3. Install script in two browser sessions, both joining `lobby`.
4. Press Play in both Clutcher tabs. Verify the other's AI-disabled character model moves at the same coordinates, turns, crouches and shows firing/reload animations.


## Real cosmetics and broader animation sync (v0.5)

This version reads the game engine's currently equipped weapon and glove
appearance rather than picking a generic bot loadout. The remote bot's agent
renderer receives weapon paint kit, skin name, float/wear, seed, gloves and
the correct special knife world model when present.

Visual events now cover drawing/switching weapons, inspecting, timed reloads,
clip in/out/bolt sounds, fire/tracer, knife attack, jump/land, footsteps,
scope transitions, grenade-throw gestures and death/respawn.
Locomotion, crouch and air state follow networked 3D state. Existing bot AI
remains disabled; every remote actor represents a connected human.

A visual state is **not** an authoritative gameplay event. There is still
no synchronized server-side damage, bomb or grenade physics, and some skins,
stickers or weapon-specific third-person animations may require further
asset-specific work. Live visual behavior hasn't been verified yet.
