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
  "roundSeconds":600,
  "remainingMs":552000,
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
2. `countdown`: Shared 5-second freeze.
3. `live`: Shared 10-minute round clock.
4. `ended`: Shared 5-second results period.
5. Next round begins with a new freeze; room score carries forward. Scores reset when the room becomes empty.

**Scoring scope:** As an initial Defusal fallback, a round ending by timeout awards CT one point (there is no bomb-plant network protocol yet). Team Deathmatch scores remain 0–0 until server-validated combat events are implemented. There is no message that allows clients to submit arbitrary scores or round winners. The server does **not** yet understand kills, bomb plants, defuses, or weapon damage.

For clock presentation, each client receives `remainingMs`, predicts the display countdown using its monotonic clock until the next update, and corrects on every server snapshot. The Tampermonkey client mirrors score, round, and remaining time into the game's native Defusal controller and displays the state in its multiplayer HUD.

**Protocol extension is backwards-incompatible for older clients** which never send `ready` and consequently cannot start a match. Update the server and userscripts together.
