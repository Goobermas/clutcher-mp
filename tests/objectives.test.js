import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../server/world.js";
import { siteForPosition } from "../server/objectives.js";
import { RULES } from "../server/match.js";

function setup(){
  const world=new World();
  const ct={id:"ct",roomId:null},t={id:"t",roomId:null};
  world.join(ct,"match",{}, {map:"oasis",mode:"defusal"});
  world.join(t,"match",{});
  world.setReady(ct,true);
  world.setReady(t,true);
  const base={x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vz:0,alive:true,airborne:false};
  world.setPlayerState(ct,{...base,x:-54,y:-4.2,z:-11});
  world.setPlayerState(t,{...base,x:-54,y:-4.2,z:-10});
  return {world,ct,t};
}

test("map-specific bombsite bounds can be resolved from actual player coordinates",()=>{
  assert.equal(siteForPosition("oasis",{x:-54,y:-4.2,z:-10}),"A");
  assert.equal(siteForPosition("oasis",{x:6,y:-3.8,z:-52}),"B");
  assert.equal(siteForPosition("oasis",{x:200,y:0,z:200}),null);
});

test("only the assigned carrier can plant, and completion changes to 40s C4 phase",()=>{
  const {world,ct,t}=setup();
  const match=world.roomMatches.get("match");
  world.matchState("match",1000);
  world.matchState("match",6000);
  assert.equal(match.phase,"live");
  assert.equal(match.objective.carrier,"t");
  assert.equal(match.objectiveIntent(world.rooms.get("match").get(ct.id),"plant",6200,world.rooms.get("match"),"oasis"),false);
  assert.equal(match.objectiveIntent(world.rooms.get("match").get(t.id),"plant",6200,world.rooms.get("match"),"oasis"),true);
  for(let now=6300;now<=9500;now+=100) {
    match.objectiveIntent(world.rooms.get("match").get(t.id),"plant",now,world.rooms.get("match"),"oasis");
    world.matchState("match",now);
  }
  assert.equal(match.phase,"planted");
  assert.equal(match.objective.placed.site,"A");
  assert.equal(match.rules.bombMs,40_000);
  const snapshot=world.matchState("match",9700);
  assert.ok(snapshot.remainingMs<=40_000 && snapshot.remainingMs>38_000);
});

test("interrupted planting resets progress",()=>{
  const {world,t}=setup();
  const match=world.roomMatches.get("match");
  world.matchState("match",1000);
  world.matchState("match",6000);
  match.objectiveIntent(world.rooms.get("match").get(t.id),"plant",6200,world.rooms.get("match"),"oasis");
  world.matchState("match",7000); // no renewed hold
  assert.equal(match.objective.planter,null);
  assert.equal(match.phase,"live");
});

test("CT must be near C4 and hold use for normal defuse time",()=>{
  const {world,ct,t}=setup();
  const match=world.roomMatches.get("match"),room=world.rooms.get("match");
  world.matchState("match",0);
  world.matchState("match",RULES.defusal.freezeMs);
  for(let now=6000;now<=9500;now+=100){
    match.objectiveIntent(room.get(t.id),"plant",now,room,"oasis");
    world.matchState("match",now);
  }
  assert.equal(match.phase,"planted");
  const start=9700;
  for(let now=start;now<=start+10_100;now+=100){
    match.objectiveIntent(room.get(ct.id),"defuse",now,room,"oasis");
    world.matchState("match",now);
  }
  assert.equal(match.phase,"ended");
  assert.equal(match.winner,"CT");
  assert.equal(match.score.CT,1);
});
