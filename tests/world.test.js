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

test("new arrivals are assigned to the smallest team, never by client choice", () => {
  const world = new World();
  const sessions = Array.from({ length: 5 }, (_, i) => ({ id: "p" + i, roomId: null }));
  const teams = sessions.map((session) =>
    world.join(session, "public", {}, { team: "T" }).team
  );
  assert.deepEqual(teams, ["CT", "T", "CT", "T", "CT"]);
  assert.equal(sessions[0].team, "CT");
  assert.equal(sessions[1].team, "T");
  world.leave(sessions[1]);
  const newcomer = { id: "p5", roomId: null };
  assert.equal(world.join(newcomer, "public", {}).team, "T");
});

test("room map/mode come from the first joiner and later clients inherit them", () => {
  const world = new World();
  const first = { id: "one", roomId: null };
  const second = { id: "two", roomId: null };
  const own = world.join(first, "lobby", {}, { map: "dusker", mode: "dm" });
  assert.deepEqual(own, { team: "CT", map: "dusker", mode: "dm" });
  const joined = world.join(second, "lobby", {}, { map: "oasis", mode: "defusal" });
  assert.deepEqual(joined, { team: "T", map: "dusker", mode: "dm" });
  const [snapshot] = world.tick();
  assert.deepEqual(snapshot.message.players.map((p) => p.team), ["CT", "T"]);
  world.leave(first);
  world.leave(second);
  assert.equal(world.roomSettings.has("lobby"), false);
});

test("the only player may change map before Play, but not once another has joined", () => {
  const world = new World();
  const a = { id: "a", roomId: null };
  const b = { id: "b", roomId: null };
  world.join(a, "lobby", {}, { map: "oasis", mode: "defusal" });
  assert.deepEqual(world.join(a, "lobby", {}, { map: "dusker", mode: "dm" }),
    { team: "CT", map: "dusker", mode: "dm" });
  world.join(b, "lobby", {});
  assert.deepEqual(world.join(a, "lobby", {}, { map: "oasis", mode: "defusal" }),
    { team: "CT", map: "dusker", mode: "dm" });
});

test("3D player state appears for peers, actions relay to everyone except the actor", () => {
  const world = new World();
  const a = { id: "a", roomId: null };
  const b = { id: "b", roomId: null };
  const socketA = { id: 1 };
  const socketB = { id: 2 };
  world.join(a, "map", socketA);
  world.join(b, "map", socketB);
  assert.throws(() => world.setPlayerState(a, {}), /Load the game/);
  world.setReady(a, true);
  world.setReady(b, true);
  const state = {
    x: 10, y: 2, z: 15, yaw: 0.5, pitch: 0.1,
    vx: 1, vz: 0, crouch: true, airborne: false,
    weapon: "ak47", alive: true, name: "Example"
  };
  world.setPlayerState(a, state);
  const players = world.tick()[0].message.players;
  assert.equal(players.find(p => p.id === "a").game.weapon, "ak47");
  assert.equal(players.find(p => p.id === "a").game.z, 15);
  assert.equal(players.find(p => p.id === "b").game, undefined);
  const action = world.relayAction(a, { kind: "fire", dir: [0, 0, -1] });
  assert.deepEqual(action.recipients, [socketB]);
  assert.deepEqual(action.message, { type: "player_action", id: "a", kind: "fire", dir: [0,0,-1] });
  world.setReady(a, false);
  assert.equal(world.tick()[0].message.players.find(p => p.id === "a").game, undefined);
});

test("invalid transforms and remote actions are rejected", () => {
  const world = new World();
  const a = { id: "a", roomId: null };
  world.join(a, "lobby", {});
  world.setReady(a, true);
  const base = { x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vz:0,alive:true,weapon:"ak47" };
  assert.throws(() => world.setPlayerState(a, { ...base, x: Infinity }), /finite/);
  assert.throws(() => world.setPlayerState(a, { ...base, x: 5000 }), /bounds/);
  world.setPlayerState(a, base);
  assert.throws(() => world.relayAction(a, {kind:"plant"}), /Unsupported/);
  assert.throws(() => world.relayAction(a, {kind:"fire", dir:[100,0,0]}), /Invalid shot/);
});

test("weapon finishes, paint seeds, knife models and gloves are included in 3D snapshots", () => {
  const world = new World();
  const player = { id: "stylist", roomId: null };
  world.join(player, "skins", {});
  world.setReady(player, true);
  const transform = {
    x:1,y:2,z:3,yaw:0.5,pitch:0.1,vx:0,vz:0,
    weapon:"knife", alive:true, crouch:true, scoped:false,
    skin:{ weapon:"knife_butterfly", kit:1337, name:"Test Fade", wmin:0.2, seed:15 },
    skinItem:{wear:0.069,seed:998},
    gloves:{model:"glove_sport", kit:18, item:{wear:0.13,seed:9}}
  };
  world.setPlayerState(player, transform);
  const state = world.tick()[0].message.players[0].game;
  assert.equal(state.skin.weapon, "knife_butterfly");
  assert.equal(state.skin.kit, 1337);
  assert.equal(state.skinItem.wear, 0.069);
  assert.equal(state.skinItem.seed, 998);
  assert.equal(state.gloves.model, "glove_sport");
  assert.equal(state.gloves.item.seed, 9);
  assert.equal(state.crouch, true);
});

test("visual metadata is scrubbed and events preserve weapon and animation parameters", () => {
  const world = new World();
  const one = { id:"one", roomId:null };
  const two = { id:"two", roomId:null };
  world.join(one,"room",{id:1});
  world.join(two,"room",{id:2});
  world.setReady(one,true);
  world.setReady(two,true);
  world.setPlayerState(one,{
    x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vz:0,weapon:"ak47",alive:true,
    skin:{name:"X".repeat(400), kitten:1, constructor:{trick:true}, nested:{seed:5}}
  });
  const appearance = world.tick()[0].message.players.find(p=>p.id==="one").game.skin;
  assert.equal(appearance.name.length,160);
  assert.equal(Object.hasOwn(appearance,"constructor"),false);
  assert.equal(appearance.nested.seed,5);
  assert.throws(() => world.relayAction(one, {kind:"inspect",weapon:"ak47"}), /Unsupported/);
  const equip=world.relayAction(one,{kind:"equip",weapon:"ak47"});
  assert.deepEqual(equip.recipients,[...world.rooms.get("room").values()].filter(p=>p.id!=="one").map(p=>p.socket));
  assert.deepEqual(equip.message,{type:"player_action",id:"one",kind:"equip",weapon:"ak47"});
  const knife=world.relayAction(one,{kind:"knife",heavy:true});
  assert.equal(knife.message.heavy,true);
  const reload=world.relayAction(one,{kind:"reload",duration:8.4,empty:true});
  assert.equal(reload.message.duration,8.4);
  assert.equal(reload.message.empty,true);
  assert.throws(()=>world.relayAction(one,{kind:"weapon_sound",sound:"../evil"}),/Invalid animation sound/);
});
