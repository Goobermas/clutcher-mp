import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const userscript = readFileSync(new URL("../client/clutcher-mp.user.js", import.meta.url), "utf8");

function section(start, end) {
  const a = userscript.indexOf(start);
  const b = userscript.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "Expected named userscript sections");
  return userscript.slice(a, b);
}

test("native reload broadcasts once; local inspect remains untouched", () => {
  const emitted = [];
  const install = new Function("sendVisualAction", "installCosmeticHooks",
    section("  function installActionHooks(game) {", "\n  function publishGameState()") +
    "\nreturn installActionHooks;"
  )((kind, fields) => emitted.push({ kind, ...fields }), () => {});

  function makeObjects() {
    return {
      weapons: {
        current:"ak47", reloading:false,
        def() {return {reload:2.7, mag:30};},
        state() {return {ammo:0, reserve:70};},
        startReload() {this.reloading=true; return "native-reload";},
        knifeAttack() {}, setWeapon() {}, setScope() {}, throwGrenade() {}
      },
      viewmodel: {
        inspectT:0,
        inspect() {this.inspectT=2.8; return "native-inspect";}
      }
    };
  }

  const game = {...makeObjects(), fireBullet() {}, dealDamage() {}, audio:null};
  const originalInspect = game.viewmodel.inspect;
  install(game);
  assert.equal(game.viewmodel.inspect, originalInspect, "Never hook local inspect");
  assert.equal(game.weapons.startReload(), "native-reload");
  assert.equal(game.viewmodel.inspect(), "native-inspect");
  assert.deepEqual(emitted.map(x => x.kind), ["reload"]);
  assert.equal(emitted[0].empty, true);
  assert.equal(emitted[0].duration, 2.7);

  emitted.length=0;
  install(game);
  game.weapons.startReload();
  game.viewmodel.inspect();
  assert.deepEqual(emitted.map(x => x.kind), ["reload"], "No duplicate hooks");

  emitted.length=0;
  Object.assign(game, makeObjects());
  const nextInspect = game.viewmodel.inspect;
  install(game);
  assert.equal(game.viewmodel.inspect, nextInspect, "No inspect hook on replacement viewmodel");
  game.weapons.startReload();
  game.viewmodel.inspect();
  assert.deepEqual(emitted.map(x => x.kind), ["reload"]);
});

test("reload fallback moves held weapon then restores the exact transform", () => {
  let now = 1000;
  const methods = new Function("performance",
    section("  function stopRemoteReloadFallback(bot) {",
      "  function deferRemoteAction(bot, message) {") +
    "\nreturn {startRemoteReloadFallback, animateRemoteReloadFallback, stopRemoteReloadFallback};"
  )({now:()=>now});

  function vector(x,y,z) {
    return {x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;}};
  }
  const mesh={position:vector(0,0,0),rotation:vector(0,0,0)};
  const bot={alive:true,cs2Agent:{heldWeapon:mesh}};
  assert.equal(methods.startRemoteReloadFallback(bot, 2), true);
  now=2000;
  methods.animateRemoteReloadFallback(bot);
  assert.ok(Math.abs(mesh.position.y)>0.01,"Reload fallback visibly moves weapon");
  now=3200;
  methods.animateRemoteReloadFallback(bot);
  assert.equal(mesh.position.y,0);
  assert.equal(mesh.rotation.z,0);
  assert.equal(bot._mpReloadPose,null);
});

test("remote reload uses correct third-person weapon ID", () => {
  let called;
  const remote={alive:true,weapon:"ak47",crouchT:0,
    cs2Agent:{_weaponId:"weapon_ak47",loco:{},heldWeapon:{},
      reload(...args){called=args;return 2.7;}}
  };
  const remoteAction = new Function("gameInstance","remoteModels","deferRemoteAction",
    "startRemoteReloadFallback","performance",
    section("  function remoteAction(message", "  function sendVisualAction(") +
    "\nreturn remoteAction;"
  )(() => ({}), new Map([["peer", remote]]),()=>{},()=>false,{now:()=>1000});
  remoteAction({id:"peer",kind:"reload",duration:2.7,empty:true});
  assert.deepEqual(called,["weapon_ak47",2.7,{empty:true,crouched:false}]);
});

test("remote reload waits for asynchronous weapon model initialization", () => {
  const deferred=[];
  const models=new Map([["peer",{alive:true,weapon:"ak47",
    cs2Agent:{loco:{},heldWeapon:null}}]]);
  const remoteAction = new Function("gameInstance","remoteModels","deferRemoteAction",
    "startRemoteReloadFallback","performance",
    section("  function remoteAction(message", "  function sendVisualAction(") +
    "\nreturn remoteAction;"
  )(() => ({}), models, (_,m)=>deferred.push(m),()=>false,{now:()=>1});
  remoteAction({id:"peer",kind:"reload",weapon:"ak47",duration:2});
  assert.deepEqual(deferred.map(m=>m.kind),["reload"]);
});

test("inspect is absent from multiplayer action handling", () => {
  assert.equal(userscript.includes("sendVisualAction('inspect'"), false);
  assert.equal(userscript.includes("case 'inspect':"), false);
  assert.equal(userscript.includes("startRemoteInspect"), false);
  assert.equal(userscript.includes("_mpInspect"), false);
});
