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
