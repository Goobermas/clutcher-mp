import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../server/world.js";

const state={x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vz:0,alive:true};
function setup(){
  const world=new World();
  const a={id:"a",roomId:null},b={id:"b",roomId:null};
  world.join(a,"room",{socket:"a"});
  world.join(b,"room",{socket:"b"});
  world.setReady(a,true);
  world.setReady(b,true);
  world.setPlayerState(a,state);
  world.setPlayerState(b,state);
  return {world,a,b};
}
test("thrower-simulated projectile states relay exact coordinates and velocity",()=>{
  const {world,a}=setup();
  const launch={id:"gren1",grenade:"smoke",x:.4,y:1.5,z:0,
    vx:12,vy:4,vz:-3,fuse:1.5,spin:1};
  const out=world.beginGrenade(a,launch,1000);
  assert.equal(out.type,"grenade_spawn");
  assert.equal(out.id,"a:gren1");
  assert.equal(out.vx,12);
  const update=world.updateGrenade(a,{
    id:"gren1",x:1.05,y:1.7,z:-.2,vx:11,vy:3,vz:-3,fuse:1.44,spin:1.45
  },1050);
  assert.deepEqual([update.x,update.y,update.z],[1.05,1.7,-.2]);
  assert.equal(world.grenades.snapshot("room").length,1);
  const effect=world.finishGrenade(a,{
    id:"gren1",effect:"smoke",x:1.05,y:1.7,z:-.2
  },2500);
  assert.equal(effect.effect,"smoke");
  assert.equal(effect.id,"a:gren1");
  assert.equal(world.grenades.snapshot("room").length,0);
});
test("flash, smoke, HE and both incendiary grenade variants are accepted",()=>{
  const names=["flash","smoke","he","molotov","incend"];
  for(const type of names){
    const {world,a}=setup();
    const g=world.beginGrenade(a,{
      id:"throw1",grenade:type,x:.4,y:1.5,z:0,vx:8,vy:4,vz:-7,fuse:2
    },1000);
    const effects={flash:"flash",smoke:"smoke",he:"he",molotov:"fire",incend:"fire"};
    assert.equal(world.finishGrenade(a,{
      id:"throw1",effect:effects[type],x:.4,y:1.5,z:0
    },2000).grenade,type);
  }
});
test("other clients cannot mutate or detonate another player's grenade",()=>{
  const {world,a,b}=setup();
  world.beginGrenade(a,{
    id:"one",grenade:"flash",x:.2,y:1,z:0,vx:10,vy:5,vz:0,fuse:1.6
  },1000);
  assert.throws(()=>world.updateGrenade(b,{
    id:"one",x:1,y:2,z:0,vx:10,vy:5,vz:0
  },1050),/Unknown/);
  assert.throws(()=>world.finishGrenade(b,{
    id:"one",effect:"flash",x:.2,y:1,z:0
  },1200),/Unknown/);
  assert.throws(()=>world.finishGrenade(a,{
    id:"one",effect:"smoke",x:.2,y:1,z:0
  },1200),/Mismatched/);
});
test("unreasonable starting and teleporting states are rejected",()=>{
  const {world,a}=setup();
  assert.throws(()=>world.beginGrenade(a,{
    id:"bad",grenade:"smoke",x:400,y:1,z:0,vx:0,vy:0,vz:0,fuse:2
  },1000),/too far/);
  world.beginGrenade(a,{
    id:"ok",grenade:"smoke",x:.3,y:1,z:0,vx:10,vy:0,vz:0,fuse:2
  },1000);
  assert.throws(()=>world.updateGrenade(a,{
    id:"ok",x:200,y:1,z:0,vx:10,vy:0,vz:0
  },1050),/displacement/);
  world.leave(a);
  assert.equal(world.grenades.snapshot("room").length,0);
});
