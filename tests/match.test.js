import test from "node:test";
import assert from "node:assert/strict";
import { RoomMatch, FREEZE_MS, ROUND_MS, END_MS } from "../server/match.js";
import { World } from "../server/world.js";

test("room clock waits for a loaded CT and T", () => {
  const world = new World();
  const a = { id: "ct", roomId: null };
  const b = { id: "t", roomId: null };
  world.join(a, "lobby", {}, { mode: "defusal" });
  world.join(b, "lobby", {});
  world.setReady(a, true);
  assert.equal(world.matchState("lobby", 1000).phase, "waiting");
  world.setReady(b, true);
  const start = world.matchState("lobby", 2000);
  assert.equal(start.phase, "countdown");
  assert.equal(start.remainingMs, FREEZE_MS);
  assert.deepEqual(start.score, { CT: 0, T: 0 });
  assert.deepEqual({ ct: start.ct, t: start.t, ready: start.ready }, { ct: 1, t: 1, ready: 2 });
});

test("both clients see the same match clock and score from one room", () => {
  const world = new World();
  const a = { id: "a", roomId: null };
  const b = { id: "b", roomId: null };
  world.join(a, "duo", {});
  world.join(b, "duo", {});
  world.setReady(a, true);
  world.setReady(b, true);
  world.matchState("duo", 500);
  const one = world.matchState("duo", 1200);
  const two = world.matchStates(1200).find(({message}) => message.room === "duo").message;
  assert.deepEqual(one, two);
  assert.equal(one.remainingMs, FREEZE_MS - 700);
});

test("defusal CT scores one point at a server-controlled timeout", () => {
  const match = new RoomMatch("defusal");
  match.advance(1000, true);
  assert.equal(match.phase, "countdown");
  match.advance(1000 + FREEZE_MS, true);
  assert.equal(match.phase, "live");
  assert.equal(match.snapshot("lobby", new Map(), 1000 + FREEZE_MS).remainingMs, ROUND_MS);
  match.advance(1000 + FREEZE_MS + ROUND_MS, true);
  assert.equal(match.phase, "ended");
  assert.equal(match.winner, "CT");
  assert.deepEqual(match.score, { CT: 1, T: 0 });
  match.advance(1000 + FREEZE_MS + ROUND_MS + END_MS, true);
  assert.equal(match.round, 2);
  assert.equal(match.phase, "countdown");
  assert.deepEqual(match.score, { CT: 1, T: 0 });
});

test("a missing ready player pauses the match and does not award a score", () => {
  const match = new RoomMatch("defusal");
  match.advance(1000, true);
  match.advance(1000 + FREEZE_MS, true);
  match.advance(9000, false);
  assert.equal(match.phase, "waiting");
  match.advance(1_000_000, false);
  assert.deepEqual(match.score, { CT: 0, T: 0 });
  match.advance(1_000_100, true);
  assert.equal(match.phase, "countdown");
});

test("TDM never invents points from timer expiration", () => {
  const match = new RoomMatch("dm");
  match.advance(0, true);
  match.advance(FREEZE_MS, true);
  match.advance(FREEZE_MS + ROUND_MS, true);
  assert.equal(match.phase, "ended");
  assert.equal(match.winner, null);
  assert.deepEqual(match.score, { CT: 0, T: 0 });
});

test("server forgets match score once an empty room is destroyed", () => {
  const world = new World();
  const session = { id: "a", roomId: null };
  world.join(session, "test", {});
  assert.equal(world.roomMatches.has("test"), true);
  world.leave(session);
  assert.equal(world.roomMatches.has("test"), false);
  assert.equal(world.matchState("test"), null);
});

test("clients cannot send a score as an input to the room model", () => {
  const world = new World();
  const session = { id: "a", roomId: null };
  world.join(session, "test", {});
  world.setReady(session, true);
  assert.throws(() => world.setReady(session, "yes"), /Ready must be true or false/);
  const state = world.matchState("test", 3000);
  assert.deepEqual(state.score, { CT: 0, T: 0 });
});
