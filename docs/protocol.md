# Wire protocol v1

Transport: WebSocket at `/ws`. UTF-8 JSON messages, with a `type` discriminator in snake_case. The server authoritatively stores player positions; clients send **inputs**, never absolute positions.

## Client → server

```json
{"type":"join_room","room":"lobby"}
```

```json
{"type":"input","x":1,"y":0}
```

Both x and y must be finite numbers between -1 and 1. Diagonal inputs are normalized server-side. Inputs apply to the player's movement during each server tick.

```json
{"type":"ping","nonce":123456}
```

## Server → client

After connecting:

```json
{"type":"welcome","id":"<uuid>","protocol_version":1,"tick_hz":20}
```

After joining a room:

```json
{"type":"joined","room":"lobby"}
```

Server snapshots (20 per second in the MVP):

```json
{"type":"snapshot","room":"lobby","tick":42,"players":[{"id":"<uuid>","x":12.0,"y":6.0}]}
```

Ping response:

```json
{"type":"pong","nonce":123456}
```

Validation response:

```json
{"type":"error","message":"join a room before sending input"}
```

## Limits / behavior

- Room IDs: 1–32 ASCII letters, numbers, `-`, or `_`.
- Up to 16 connected players per room.
- JSON WebSocket frames max 2 KiB; max 100 text messages/second per connection.
- Outgoing per-client message queue is bounded to 32. Snapshots can be dropped for a slow client.
- Positions are clamped to the square from -1000 to +1000 on each axis.
- On disconnect, the player's membership is removed. Empty rooms are removed.
- A join request to a new room atomically changes membership if the destination has room.
- For now, all rooms exist in memory. No authentication, persistence, combat, reconnect token, or TLS termination is provided.

## Next protocol improvements

Add input sequence numbers, interpolation timestamps, authenticated identity, heartbeats/timeouts, explicit join/leave events, movement reconciliation, and binary messages if bandwidth requires it.
