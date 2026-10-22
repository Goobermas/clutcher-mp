# Clutcher MP

Fresh Node.js multiplayer server built from scratch for a browser-based game. **No Rust or Cargo required.** The v0.5 userscript loads Clutcher's real map with **0 bots**, **server-assigned CT/T teams**, and a **shared match clock and score**.

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

Install [client/clutcher-mp.user.js](client/clutcher-mp.user.js) into Tampermonkey to connect from the Clutcher HTTPS game page. The userscript has a room/connection HUD and an independent player-position minimap. The native **PLAY** button now launches the game map directly, with bots disabled and CT/T automatically assigned by the server. Remote 3D player models and combat synchronization are **not implemented yet**. The server only increments the CT score for a Defusal round timing out; TDM scores remain zero until combat networking exists.

**Existing WSS proxy:** The script now targets `wss://mp.sillyhack.com/ws` via your existing HTTPS/WSS reverse proxy (public port 443). Node.js stays on internal port `8085`. Tampermonkey matches both HTTP and HTTPS Clutcher pages. The previous default `:8085` WSS URL is automatically migrated. See [setup and limitations](docs/tampermonkey.md).

## Development

```bash
npm test
npm run dev
```

The server is written in plain JavaScript (no TypeScript build). Networking uses the [ws](https://github.com/websockets/ws) package and Node's built-in HTTP server.

### Native game rules and remote player models

**Bomb Defuse:** 5-second freeze, 115.2-second round (approximately 1:55),
first team to **8 rounds**, maximum 15 rounds, and 5-second between-round results.
The native preset has no halftime team swap. Clutcher also defines a 40-second
C4 fuse, 3.2-second plant and 10/5-second defuse (without/with kit), but
**C4 and actual kill validation are not networked yet**.

**Team Deathmatch:** 10-minute matches, immediate start (no Defusal freeze),
6-second results, then a new match. Team scores still need networked kills.

The updated userscript sends the actual 3D position, view angle, stance, velocity,
alive state and equipped weapon. Each remote human is drawn using a **Clutcher
bot character model with AI disabled**; shot visuals, reloads, jumps and
landings are broadcast as animation events. This does not yet synchronize
damage, ammo, grenades, kills, bombs, or the full objective rules.

### Shared match clock and score

When at least one CT and one T have loaded the map, the server follows the selected game mode's timing (Defusal 5s freeze / ~1:55 rounds; TDM 10-minute matches). Each client uses the `match_state` broadcast to render the same time, round, and CT/T totals. Returning to menu stops that player's readiness.

In the current prototype, **only Defusal timeout awards a point** (CT wins when time runs out). TDM and all kill/bomb outcomes need a new server-side combat/objective protocol; please don't mistake the synced score display for finished game scoring.

The small test page has a **Ready** button to simulate map loading and confirm the clock and score agree across two tabs. See [wire protocol](docs/protocol.md).

### Files

- `server/index.js` — HTTP and WebSocket server, connections, validation and broadcasts
- `server/world.js` — in-memory rooms, movement and authoritative snapshots
- `client/test.html` — standalone browser/networking test
- `tests/world.test.js` — built-in Node tests
- `docs/protocol.md` — message formats and limits
- `TODO.md` — milestones

**Not implemented:** authoritative hits/health/damage, kills, C4 objectives, grenades, player auth, production hosting. Remote models and actions are *visual only* so far.


## Cosmetic and animation replication (v0.5)

This milestone aims to make remote players look like their actual browser players,
not generic AI. The userscript reads the game's native `_carriedFinish()` and
`_ownGloves()` APIs and replicates **currently equipped** weapon and knife
finishes, skin names/kits, wear/float, seed, and gloves. Remote bot actors use
the game's `_botSkin()` / `_botGloves()` selection and `setWeapon()` /
`setGloves()` for materials. Non-default knives need a special
`knife_<model>` override so the renderer does not revert to the default knife.

The state stream carries crouch, motion/velocity, airborne, alive/dead,
aim angle, weapon choice, scope, reload, fire, walk and melee *states*. Discrete
animation events include draw/equip, reload timing and empty-mag
status, clipout/clipin/bolt sounds, normal gunfire/tracers, knife stab/slash,
jump/land, footsteps, scope changes, grenade throw gesture, death and respawn.

**Known limits:** These are visual client-reported states, not server-validated
combat or inventories. Sticker/charm rendering, full 3D grenade objects,
game-specific clip availability and exact animation parity across all weapons
are not verified. Third-person inspect isn't synchronized (no native clip exists). The script has no live end-to-end multiplayer test yet.

## Reload animation fix (v0.5.1)

The game reloads through `game.weapons.startReload()`. We observe this native call
and play the corresponding third-person reload clip with `cs2Agent.reload()`.
If the weapon has no third-person reload clip, the remote held weapon shows a
short reload-only fallback motion. Reload events wait briefly while the remote
weapon mesh is loading.

## Inspect behavior (v0.5.2)

**Inspect is local only.** Clutcher has no third-person inspect animation.
The multiplayer userscript does not observe, send, receive or emulate inspect,
and never touches the game's native first-person inspect behavior.

## Multiplayer objectives and throwables (v0.6)

**Defusal plant/defuse fix:** The early multiplayer prototype disabled the
native controller's `update()`, which also prevented C4 planting. The v0.6
Node server now owns a room-level carrier, checks the player's reported
position against known Oasis/Dusker bombsite bounds, and measures a
3.2-second uninterrupted plant hold. It then changes the room to a 40-second
planted phase. A Counter-Terrorist can hold use near the planted C4 to defuse
using the base 10-second timer; if it expires, T wins. The client shows the
authentic native C4 model, plant viewmodel action, HUD progress, and round
score. Bomb drops/collection and validated kit purchases still need work.

**Grenades:** Source game physics is the authority for each grenade flight:
a thrown HE, flash, smoke, molotov, incendiary or decoy gets a room-unique ID,
a spawn packet with its actual native position/velocity, and ~20 Hz
`grenade_state` position/velocity/fuse updates. Peer game clients do *not*
run a second collision simulation for that object; they render the native
projectile mesh at the source-simulated coordinates. On landing/fuse
completion, the source reports a position-linked `grenade_effect`.
Receivers use native Clutcher flash-blind, smoke cloud, HE explosion or
incendiary/molotov fire visuals/sounds at those coordinates.

**Important limitations:** '1:1 trajectory' here means authoritative sampled
projectile coordinates and shared effect coordinates, **not guaranteed
pixel-identical per-render-frame positions** despite network latency.
Smoke/fire particle randomness may differ, and the remote effects are not
server-authoritative damage. Server still does not validate weapon damage,
kills, ownership of bought grenades, or grenade inventory. This is the
first integration pass; live multi-client visual/physics verification has not
yet occurred. Grenade effect packets are only broadcast to connected peers,
so a player joining after detonation will not receive already-active smoke/fire.
