import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const userscript = readFileSync(new URL("../client/clutcher-mp.user.js", import.meta.url), "utf8");

function section(start, end) {
  const a = userscript.indexOf(start);
  const b = userscript.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "Expected scripts contain named sections");
  return userscript.slice(a, b);
}

test("actual Clutcher startReload and inspect calls broadcast once and preserve native code", () => {
  const emitted = [];
  const install = new Function("sendVisualAction", "installCosmeticHooks",
    section("  function installActionHooks(game) {", "\n  function publishGameState()") +
    "\nreturn installActionHooks;"
  )((kind, fields) => emitted.push({ kind, ...fields }), () => {});

  function makeObjects() {
    return {
      weapons: {
        current: "ak47", reloading: false,
        def() { return { reload: 2.7, mag: 30 }; },
        state() { return { ammo: 0, reserve: 70 }; },
        startReload() { this.reloading = true; return "native-reload"; },
        knifeAttack() {}, setWeapon() {}, setScope() {},
        throwGrenade() {}
      },
      viewmodel: {
        inspectT: 0,
        inspect() { this.inspectT = 2.8; return "native-inspect"; }
      }
    };
  }
  const game = { ...makeObjects(), fireBullet() {}, dealDamage() {}, audio: null };
  install(game);
  assert.equal(game.weapons.startReload(), "native-reload");
  assert.equal(game.viewmodel.inspect(), "native-inspect");
  assert.deepEqual(emitted.map(x => x.kind), ["reload", "inspect"]);
  assert.equal(emitted[0].empty, true);
  assert.equal(emitted[0].duration, 2.7);
  emitted.length = 0;
  install(game);
  game.weapons.startReload();
  game.viewmodel.inspect();
  assert.equal(emitted.length, 2, "No duplicate hooks on same object");
  emitted.length = 0;
  Object.assign(game, makeObjects());
  install(game);
  game.weapons.startReload();
  game.viewmodel.inspect();
  assert.deepEqual(emitted.map(x => x.kind), ["reload", "inspect"],
    "New scene load's weapons/viewmodel are hooked");
});

test("inspect falls back to animating held weapon when no third-person clip exists", () => {
  let now = 1000;
  const methods = new Function("performance", "deferredActions", "remoteAction",
    section("  function stopRemoteInspect(bot) {", "  function remoteAction(message") +
    "\nreturn {startRemoteInspect, startRemoteReloadFallback, animateRemoteInspect, stopRemoteInspect};"
  )({ now: () => now }, new Map(), () => {});

  function vector(x,y,z) {
    return {x,y,z,set(a,b,c) {this.x=a;this.y=b;this.z=c;}};
  }
  const heldWeapon = {position:vector(0,0,0),rotation:vector(0,0,0)};
  const bot = { alive:true, weapon:"ak47", crouchT:0,
    cs2Agent:{ heldWeapon, _weaponId:"weapon_ak47",
      loco:{actionName:()=>null,hasAction:()=>false,playAction:()=>0} }
  };
  assert.equal(methods.startRemoteInspect(bot), true);
  now = 2200;
  methods.animateRemoteInspect(bot);
  assert.ok(Math.abs(heldWeapon.rotation.y) > 0.01,
    "The remote observer visibly rotates the held gun");
  now = 4000;
  methods.animateRemoteInspect(bot);
  assert.equal(heldWeapon.rotation.y, 0,
    "Weapon pose restores after inspection");
  assert.equal(bot._mpInspect, null);

  // Reload has its own fallback when no third-person reload clip is bundled.
  now = 5000;
  assert.equal(methods.startRemoteReloadFallback(bot, 2), true);
  now = 6000;
  methods.animateRemoteInspect(bot);
  assert.ok(Math.abs(heldWeapon.position.y) > 0.01, "Fallback visibly lowers weapon");
  now = 7200;
  methods.animateRemoteInspect(bot);
  assert.equal(heldWeapon.position.y, 0);
});

test("native third-person reload action uses the bot renderer's weapon id", () => {
  let called;
  const game = {};
  const remote = { alive:true,weapon:"ak47",crouchT:0,
    cs2Agent:{_weaponId:"weapon_ak47",loco:{},reload(...args){called=args;return 2.7;}}
  };
  const models = new Map([["peer", remote]]);
  const remoteAction = new Function("gameInstance","remoteModels","deferRemoteAction",
    "startRemoteInspect","performance",
    section("  function remoteAction(message", "  function sendVisualAction(") +
    "\nreturn remoteAction;"
  )(() => game,models,()=>{},()=>true,{now:()=>3000});
  remoteAction({id:"peer",kind:"reload",duration:2.7,empty:true});
  assert.deepEqual(called,["weapon_ak47",2.7,{empty:true,crouched:false}]);
});
