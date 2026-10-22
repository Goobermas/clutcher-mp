export const TYPES = new Set(["he","flash","smoke","molotov","incend","decoy"]);
const finite = value => Number.isFinite(value);
export const vectorOK = v => v && ["x","y","z","vx","vy","vz"]
  .every(k=>finite(v[k]) && Math.abs(v[k])<4096);

export class GrenadeRelay {
  constructor(){ this.rooms=new Map(); }
  room(roomId){if(!this.rooms.has(roomId))this.rooms.set(roomId,new Map());return this.rooms.get(roomId);}
  start(session,player,data,now){
    if(!player?.ready || !player.gameState?.alive ||
        !TYPES.has(data.grenade) || !/^[a-zA-Z0-9_-]{1,36}$/.test(data.id || "") ||
        !vectorOK(data) || !finite(data.fuse) || data.fuse<0 || data.fuse>15) {
      throw new Error("Invalid grenade launch.");
    }
    if(Math.hypot(data.x-player.gameState.x,data.z-player.gameState.z)>4 ||
       Math.abs(data.y-player.gameState.y)>4) throw new Error("Grenade launch too far from player.");
    const room=this.room(session.roomId);
    const owned=[...room.values()].filter(g=>g.owner===session.id);
    if(owned.length>=12)throw new Error("Too many active grenades.");
    const id=session.id+":"+data.id;
    if(room.has(id))throw new Error("Grenade already exists.");
    const projectile={id,owner:session.id,team:player.team,grenade:data.grenade,
      x:data.x,y:data.y,z:data.z,vx:data.vx,vy:data.vy,vz:data.vz,
      fuse:data.fuse,spin:finite(data.spin)?data.spin:0,
      startedAt:now,updatedAt:now};
    room.set(id,projectile);
    return {type:"grenade_spawn",...projectile};
  }
  update(session,data,now){
    const room=this.rooms.get(session.roomId);
    const id=session.id+":"+data.id;
    const grenade=room?.get(id);
    if(!grenade || !vectorOK(data)) throw new Error("Unknown or invalid grenade.");
    if(now-grenade.startedAt>30000)throw new Error("Grenade expired.");
    const dt=Math.max(0,(now-grenade.updatedAt)/1000);
    if(Math.hypot(data.x-grenade.x,data.y-grenade.y,data.z-grenade.z)>Math.max(4,dt*90+2))
      throw new Error("Unexpected grenade displacement.");
    Object.assign(grenade,{x:data.x,y:data.y,z:data.z,vx:data.vx,vy:data.vy,vz:data.vz,
      fuse:finite(data.fuse)?Math.max(-3,Math.min(15,data.fuse)):grenade.fuse,
      spin:finite(data.spin)?data.spin:grenade.spin,updatedAt:now});
    return {type:"grenade_state",id,x:grenade.x,y:grenade.y,z:grenade.z,
      vx:grenade.vx,vy:grenade.vy,vz:grenade.vz,fuse:grenade.fuse,spin:grenade.spin};
  }
  finish(session,data,now){
    const room=this.rooms.get(session.roomId);
    const id=session.id+":"+data.id;
    const grenade=room?.get(id);
    if(!grenade)throw new Error("Unknown grenade.");
    const effects={flash:"flash",smoke:"smoke",he:"he",molotov:"fire",incend:"fire",decoy:"decoy"};
    if(data.effect!==effects[grenade.grenade])throw new Error("Mismatched grenade effect.");
    if(!["x","y","z"].every(k=>finite(data[k]) && Math.abs(data[k]-grenade[k])<=4))
      throw new Error("Effect position does not match grenade.");
    room.delete(id);
    return {type:"grenade_effect",id,grenade:grenade.grenade,
      effect:data.effect,x:data.x,y:data.y,z:data.z,owner:session.id,team:grenade.team,
      elapsedMs:now-grenade.startedAt};
  }
  snapshot(roomId){
    return [...(this.rooms.get(roomId)?.values() || [])].map(g=>({...g}));
  }
  leave(session){
    const room=this.rooms.get(session.roomId);
    if(!room)return;
    for(const [id,g] of room)if(g.owner===session.id)room.delete(id);
    if(!room.size)this.rooms.delete(session.roomId);
  }
  clear(roomId){this.rooms.delete(roomId);}
  sweep(now){
    for(const [id,room] of this.rooms){
      for(const [key,g] of room)if(now-g.startedAt>30000)room.delete(key);
      if(!room.size)this.rooms.delete(id);
    }
  }
}
