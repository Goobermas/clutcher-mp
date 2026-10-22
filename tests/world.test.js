import test from "node:test";
import assert from "node:assert/strict";
import { World, validRoomName, validInput, normalizedInput, TICK_HZ } from "../server/world.js";

test("room names are validated", () => {
  assert.equal(validRoomName("lobby-1"), true);
  assert.equal(validRoomName("private_room"), true);
  assert.equal(validRoomName("../admin"), false);
  assert.equal(validRoomName("has spaces"), false);
  assert.equal(validRoomName(""), false);
  assert.equal(validRoomName("x".repeat(33)), false);
});

test("input values are bounded and diagonal motion is normalized", () => {
  assert.equal(validInput(1, -1), true);
  assert.equal(validInput(2, 0), false);
  assert.equal(validInput(NaN, 0), false);
  assert.ok(Math.abs(Math.hypot(...Object.values(normalizedInput(1, 1))) - 1) < 0.00001);
});

test("joining, switching rooms and leaving cleans up room state", () => {
  const world = new World();
  const session = { id: "p1", roomId: null };
  world.join(session, "alpha", {});
  assert.equal(world.rooms.get("alpha").size, 1);
  world.join(session, "beta", {});
  assert.equal(world.rooms.has("alpha"), false);
  assert.equal(world.rooms.get("beta").size, 1);
  world.leave(session);
  assert.equal(world.rooms.size, 0);
});

test("movement is server-owned and snapshots contain both players", () => {
  const world = new World();
  const first = { id: "p1", roomId: null };
  const second = { id: "p2", roomId: null };
  world.join(first, "lobby", {});
  world.join(second, "lobby", {});
  world.setInput(first, 1, 0);
  const [snapshot] = world.tick();
  assert.equal(snapshot.message.type, "snapshot");
  assert.equal(snapshot.message.players.length, 2);
  assert.equal(snapshot.message.players.find((p) => p.id === "p1").x, 120 / TICK_HZ);
  assert.equal(snapshot.recipients.length, 2);
});
