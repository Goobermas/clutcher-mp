# Clutcher MP — WebSocket Protocol v1

Connect to `/ws`. All messages are UTF-8 JSON objects with a `type` field. The Rust prototype has been removed; this is a **new Node.js implementation**.

## Client → server

Join a room (creates it if it does not exist):

```json
{"type":"join_room","room":"lobby","map":"oasis","mode":"defusal"}
```

Send a movement direction (not an absolute position):

```json
{"type":"input","x":1,"y":0}
```

Ping:

```json
{"type":"ping","nonce":123456}
```

## Server → client

On connection:

```json
{"type":"welcome","id":"<uuid>","protocol_version":1,"tick_hz":20}
```

After joining:

```json
{"type":"joined","room":"lobby","team":"CT","map":"oasis","mode":"defusal"}
```

At 20 Hz while rooms exist:

```json
{"type":"snapshot","room":"lobby","tick":42,"players":[{"id":"<uuid>","team":"CT","x":12,"y":6}]}
```

For ping / validation:

```json
{"type":"pong","nonce":123456}
```

```json
{"type":"error","message":"Join a room before sending movement."}
```

## Limits

- 16 players per room, 100 rooms per server, room name 1–32 ASCII letters/digits/`-`/`_`.
- 20 server ticks/s, speed 120 coordinate units/s, playable coordinates -1000..1000.
- Diagonal input normalization, rejected non-finite/out-of-range inputs.
- Message payload up to 2 KiB, 100 messages/second/connection.
- WebSocket ping/pong heartbeat every 30 seconds; close unresponsive clients.
- Slow clients skip snapshots if their pending WebSocket buffer exceeds 256 KiB.
- Rooms exist only in memory; closing the connection removes the player and empty rooms.

This is a development prototype: there is **no login, TLS termination, matchmaking, combat, collision or persistence**. Do not expose it publicly without configuring access controls and WSS.

## Automatic teams and shared game settings (v0.2)

- Every room assigns teams **server-side**: first connected member is CT, second is T, then joiners go to the smaller team (CT breaks ties).
- Clients cannot request a specific team. Leaving a room frees that team's slot for the next joiner; existing players are **not** automatically swapped during a match.
- The first room member sets `map` (`oasis` or `dusker`) and `mode` (`defusal` or `dm`). All subsequent joiners inherit both.
- When a room has only one player, that player can change its map/mode by sending another `join_room`. Once two or more are in the room, settings are locked until it becomes empty.
- The server responds with the assigned `team`, `map`, and `mode` in every `joined` acknowledgement.
- Snapshot player entries now include `team` alongside the current 2D test coordinates.

## Authoritative match clock and CT/T score (v0.3)

After starting the actual game/map, a client sends:

```json
{"type":"ready","ready":true}
```

A client returning to menu sends `{"type":"ready","ready":false}`. A disconnect removes its readiness automatically. A room waits until at least **one ready CT and one ready T** exist.

The server broadcasts a match update **four times per second** (and directly after join/ready requests):

```json
{
  "type":"match_state",
  "room":"lobby",
  "revision":3,
  "phase":"live",
  "round":1,
  "roundSeconds":115.2,
  "remainingMs":87000,
  "score":{"CT":0,"T":0},
  "winner":null,
  "ct":1,
  "t":1,
  "ready":2,
  "players":2
}
```

Server-owned state machine:

1. `waiting`: No running timer until there is a loaded player on each side.
2. `countdown`: Shared 5-second freeze in Defusal only.
3. `live`: Shared 115.2-second Defusal round or 600-second Team Deathmatch match.
4. `ended`: Shared 5-second Defusal results or 6-second Team Deathmatch results.
5. In Defusal, the server moves to `match_end` at eight wins (maximum 15 rounds), otherwise starts the next round. In TDM the next 600-second match begins after the results period. Scores reset when the room becomes empty.

**Scoring scope:** As an initial Defusal fallback, a round ending by timeout awards CT one point (there is no bomb-plant network protocol yet). Team Deathmatch scores remain 0–0 until server-validated combat events are implemented. There is no message that allows clients to submit arbitrary scores or round winners. The server does **not** yet understand kills, bomb plants, defuses, or weapon damage.

For clock presentation, each client receives `remainingMs`, predicts the display countdown using its monotonic clock until the next update, and corrects on every server snapshot. The Tampermonkey client mirrors score, round, and remaining time into the game's native Defusal controller and displays the state in its multiplayer HUD.

**Protocol extension is backwards-incompatible for older clients** which never send `ready` and consequently cannot start a match. Update the server and userscripts together.

## Actual game mode timings (v0.4)

Verified against the supplied Clutcher HTML / main.js:

| Game mode | Match / round clock | Freeze | Results | Win rule |
| --- | --- | --- | --- | --- |
| Bomb Defuse | 115.2s (approximately 1:55) | 5s | 5s | First to 8 of maximum 15 rounds |
| Team Deathmatch | 600s (10:00) | None | 6s | Highest kills at timeout; **kill scoring not implemented** |

Bomb Defuse game constants include 40s bomb fuse, 3.2s plant, 10s defuse, and 5s defuse with kit. **These objective actions are not yet simulated on this multiplayer server**. Only a Defusal round without a bomb plant awards CT on clock expiration. No halftime side swap is performed in this game's current preset.

The server also emits `match_end` on the eighth Defusal round won (or round limit), with an 8s end phase.

## Remote player presentation (v0.4)

A player whose game is loaded sends transforms about 20 times per second:

```json
{"type":"player_state","name":"Player","x":12.2,"y":1,"z":-4.4,"yaw":1.2,"pitch":0.1,"vx":0,"vz":0,"weapon":"ak47","crouch":false,"airborne":false,"alive":true}
```

The server validates and embeds it into the room's `snapshot.players[].game`. This is **client-reported visual data, not authoritative physics**. The game client can use it to drive an AI-disabled remote bot mesh.

Small one-shot visual action events:

```json
{"type":"action","kind":"fire","dir":[0,0,-1]}
```

Valid `kind` values: `fire` (requires normalized-ish 3-vector direction), `reload`, `jump`, `land`, `equip`.

The server forwards the event to *other* clients in the same room:

```json
{"type":"player_action","id":"<sender_uuid>","kind":"fire","dir":[0,0,-1]}
```

This path only drives character presentation (gun shot/tracer, reload, jump/landing cue). No client can award kills or score points with it. Real hit detection and damage validation are separate work.

**Old v0.3 assumption superseded:** Defusal no longer uses the placeholder 10:00 clock; TDM alone uses 10:00. Both server and userscript must be updated together.


## Cosmetic state and detailed animation events (v0.5)

The player's ordinary `player_state` (sent ~20 times/second) now includes:

```json
{
  "type":"player_state",
  "x":0,"y":1,"z":0,"yaw":0,"pitch":0,"vx":0,"vz":0,
  "weapon":"knife","alive":true,"crouch":false,"airborne":false,
  "scoped":false,"reloading":false,"walking":false,"firing":false,"melee":false,
  "skin":{"weapon":"knife_butterfly","kit":123,"name":"Example","wmin":0.07},
  "skinItem":{"wear":0.07,"seed":42},
  "gloves":{"model":"glove_sport","kit":18,"item":{"wear":0.12,"seed":9}}
}
```

Appearance is derived from the user's currently *equipped* loadout, not
arbitrary keys supplied by unrelated players. Server filters metadata
recursively (depth cap, number of keys, string cap, no prototype properties).
The WebSocket input limit is 8 KiB per message.

`action` now accepts these **visual-only** `kind` values:

`fire`, `reload`, `jump`, `land`, `equip`,
`knife`, `step`, `weapon_sound`, `grenade_prep`,
`grenade_throw`, `scope`, `crouch`, `death`, `spawn`.

Optional validated parameters:

- `weapon`: short lowercase identifier
- `reload`: `duration` seconds and `empty` flag
- `knife`: `heavy` flag (stab instead of slash)
- `scope`: `scoped` flag
- `weapon_sound` or `step`: allowlisted audio `sound` id
- `fire`: three-component finite direction `dir`

The server relays these to other room members as `player_action`. These
events animate models and audio only and **cannot award damage/kills**.
Skin/item persistence, validated ownership and identical animation clips
for every weapon are separate future milestones.

### v0.5.2: Inspect is not networked

The game provides no third-person inspect animation. The `inspect` action was
removed from the server allowlist and Tampermonkey client. First-person inspect
still functions locally and does not create a multiplayer animation event.

## Objective networking (v0.6)

New client -> server message `{"type":"objective_intent","kind":"plant"}`
(or `"defuse"`) is sent repeatedly while the mapped use/plant input is held.
The server requires a loaded alive player, stationary position, the assigned
T carrier inside a recognized bombsite, or a CT near the placed C4. Server
advances progress using monotonic time and cancels if intent stops for >450ms.

The `match_state` broadcast now includes `objective` with fields
`carrier`, `planter`, `plantProgress`, `defuser`,
`defuseProgress`, `placed` and `duration`.
Planting takes 3.2s, the planted timer is 40s, and base defusing takes 10s.
The native game controller renders the planted C4 but **does not decide
the outcome**; room server transitions to `planted` and awards T on timer
expiry or CT on completed defuse.

## Grenade network protocol (v0.6)

Messages sent by the owner:

```json
{"type":"grenade_throw","id":"1","grenade":"flash","x":1,"y":2,"z":3,"vx":9,"vy":7,"vz":-4,"fuse":1.6,"spin":0}
```

```json
{"type":"grenade_state","id":"1","x":1.4,"y":2.3,"z":2.8,"vx":8.7,"vy":6.2,"vz":-3.7,"fuse":1.55,"spin":0.4}
```

```json
{"type":"grenade_finish","id":"1","effect":"flash","x":2,"y":1.5,"z":0}
```

Server validates ownership, trajectory changes and effect/type pairing.
It broadcasts these as `grenade_spawn`, `grenade_state`, and
`grenade_effect`; the server room-uniquifies IDs using the sender's session
ID. Valid grenade types are `he`, `flash`, `smoke`, `molotov`,
`incend`, and `decoy`. Effect types are `he`, `flash`,
`smoke`, `fire`, and `decoy`.

Unlike sending throw direction alone, the owner reports every actual
post-collision position/velocity/fuse sample. Peers draw a remote grenade
using Clutcher's native model but deliberately **skip physics for that
replica**, and trigger its flash/smoke/fire/explosion presentation only from
the authoritative effect packet. Exact replicated landing coordinates are
sample-aligned, but latency and local effect-particle randomness can differ.

No remote player health/damage is changed by these visuals in this milestone.
