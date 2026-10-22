# Clutcher MP — WebSocket Protocol v1

Connect to `/ws`. All messages are UTF-8 JSON objects with a `type` field. The Rust prototype has been removed; this is a **new Node.js implementation**.

## Client → server

Join a room (creates it if it does not exist):

```json
{"type":"join_room","room":"lobby"}
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
{"type":"joined","room":"lobby"}
```

At 20 Hz while rooms exist:

```json
{"type":"snapshot","room":"lobby","tick":42,"players":[{"id":"<uuid>","x":12,"y":6}]}
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
