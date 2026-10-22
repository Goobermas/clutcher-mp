import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../client/clutcher-mp.user.js",import.meta.url),"utf8");
const start=source.indexOf("  const NADE_TYPES=");
const end=source.indexOf("  function publishGameState()",start);
assert.ok(start>=0 && end>start);

function rig() {
  const outgoing=[];
  const calls=[];
  const player={id:"self"};
  const game={state:"playing",player,scene:{},audio:{}};
  const mgr={
    list:[],update(dt) {
      calls.push("simulate:"+this.list.map(p=>p._mpRemote||"native").join(","));
      for(const p of this.list)p.x+=p.vx*dt;
    },
    throwFrom(owner,grenade,x,y,z,dx,dy,dz) {
      this.list.push({id:grenade,owner,x,y,z,vx:10,vy:5,vz:0,
        fuse:1.6,spin:0,mesh:{position:{set(){}},rotation:{}},
        fly:null,def:{dmg:40}});
    },
    remove(i){this.list.splice(i,1);},
    popFlash(p){calls.push("flash:"+p.x);},
    bloomSmoke(p){calls.push("smoke:"+p.x);},
    igniteAt(p){calls.push("fire:"+p.x);},
    explodeHE(p){calls.push("he:"+p.x);}
  };
  game.grenadeMgr=mgr;
  const runtime=new Function("gameInstance","remoteProjectiles","pendingProjectiles",
    "localProjectiles","previousGrenadeManager","grenadeSerial",
    "isReady","joinedRoom","playerId","send","console",
    source.slice(start,end)+
    "\nreturn {installGrenadeHooks,ensureRemoteProjectile,receiveProjectile,applyRemoteGrenadeEffect,publishGrenadePositions};"
  )(()=>game,new Map(),new Map(),new Map(),null,0,true,"room","self",
    m=>outgoing.push(m),{warn(){}});
  return {runtime,game,mgr,outgoing,calls,player};
}

test("native throw reports its real flight values, never a reconstructed guess",()=>{
  const {runtime,mgr,outgoing,player}=rig();
  runtime.installGrenadeHooks({state:"playing",grenadeMgr:mgr,player}); // owner identity retained
  mgr.throwFrom(player,"flash",0,1,0,0,0,-1);
  const packet=outgoing.find(e=>e.type==="grenade_throw");
  assert.ok(packet);
  assert.deepEqual([packet.x,packet.y,packet.z,packet.vx,packet.vy,packet.vz],
    [0,1,0,10,5,0]);
});

test("the receiver never resimulates a remote bounce",()=>{
  const {runtime,mgr,calls,game}=rig();
  runtime.installGrenadeHooks(game);
  runtime.receiveProjectile({
    id:"other:g1",owner:"other",team:"T",grenade:"smoke",
    x:3,y:2,z:1,vx:10,vy:5,vz:0,fuse:1.2,spin:0
  });
  const before=mgr.list[0].x;
  mgr.update(.1);
  assert.equal(mgr.list[0].x,before,"Remote location must be source-controlled");
  assert.deepEqual(calls.filter(x=>x.startsWith("simulate:")),["simulate:"]);
  runtime.receiveProjectile({
    id:"other:g1",x:3.75,y:2.2,z:1,
    vx:-2,vy:1,vz:0,fuse:1.1,spin:1
  });
  assert.equal(mgr.list[0].x,3.75,"Authoritative bounce sample is exact");
  runtime.applyRemoteGrenadeEffect({
    id:"other:g1",grenade:"smoke",effect:"smoke",x:3.75,y:2.2,z:1
  });
  assert.ok(calls.includes("smoke:3.75"));
  assert.equal(mgr.list.length,0);
});

test("flash and both molotov/incendiary variants use the native effect path",()=>{
  for(const [kind,effect,expected] of [
    ["flash","flash","flash:2"],["molotov","fire","fire:2"],
    ["incend","fire","fire:2"]
  ]) {
    const {runtime,mgr,game,calls}=rig();
    runtime.installGrenadeHooks(game);
    runtime.receiveProjectile({id:"peer:g",owner:"peer",team:"CT",grenade:kind,
      x:2,y:1,z:0,vx:1,vy:0,vz:0,fuse:2,spin:0});
    runtime.applyRemoteGrenadeEffect({id:"peer:g",grenade:kind,effect,x:2,y:1,z:0});
    assert.ok(calls.includes(expected),kind+" should call native game effect");
    assert.equal(mgr.list.length,0);
  }
});
