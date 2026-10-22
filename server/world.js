import { RoomMatch } from "./match.js";

export const TICK_HZ = 20;
export const MOVE_SPEED = 120;
export const MAX_PLAYERS_PER_ROOM = 16;
export const MAX_ROOMS = 100;
export const WORLD_LIMIT = 1000;
export const MAPS = Object.freeze(["oasis", "dusker"]);
export const MODES = Object.freeze(["defusal", "dm"]);


/** Drop functions, prototype keys, oversized strings and deeply nested client data. */
export function cleanCosmetic(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") return value.slice(0, 160);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(item => cleanCosmetic(item, depth + 1));
  if (typeof value !== "object") return null;
  const object = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) ||
        ["constructor", "prototype", "__proto__"].includes(key)) continue;
    object[key] = cleanCosmetic(item, depth + 1);
  }
  return object;
}

export function validRoomName(roomId) {
  return typeof roomId === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(roomId);
}

export function validInput(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
    && Math.abs(x) <= 1 && Math.abs(y) <= 1;
}

export function normalizedInput(x, y) {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

// Assign the next joiner to the smaller side. Never trust a client-supplied team.
export function balancedTeam(players) {
  let ct = 0, t = 0;
  for (const player of players.values()) {
    if (player.team === "CT") ct++;
    else if (player.team === "T") t++;
  }
  return ct <= t ? "CT" : "T";
}

export class World {
  constructor() {
    this.rooms = new Map();
    this.roomSettings = new Map();
    this.roomMatches = new Map();
    this.tickNumber = 0;
  }

  join(session, roomId, socket, options = {}) {
    if (!validRoomName(roomId)) {
      throw new Error("Room names must be 1–32 letters, numbers, - or _.");
    }
    if (session.roomId === roomId) {
      const player = this.rooms.get(roomId)?.get(session.id);
      const settings = this.roomSettings.get(roomId);
      if (player && settings) {
        // A solo player may change the map/mode before pressing Play.
        // Once another player joins, the room's settings are locked.
        if (this.rooms.get(roomId).size === 1) {
          if (MAPS.includes(options?.map)) settings.map = options.map;
          if (MODES.includes(options?.mode)) {
            settings.mode = options.mode;
            const match = this.roomMatches.get(roomId);
            if (match?.phase === "waiting") match.mode = settings.mode;
          }
        }
        return { ...settings, team: player.team };
      }
    }

    const target = this.rooms.get(roomId);
    if (target && target.size >= MAX_PLAYERS_PER_ROOM) {
      throw new Error("Room is full.");
    }
    if (!target && this.rooms.size >= MAX_ROOMS) {
      const old = this.rooms.get(session.roomId);
      if (!old || old.size !== 1) throw new Error("Room limit reached.");
    }

    // New rooms take their map/mode from the first player. Later joiners inherit it.
    // No player gets to choose their team.
    const map = MAPS.includes(options?.map) ? options.map : "oasis";
    const mode = MODES.includes(options?.mode) ? options.mode : "defusal";

    this.leave(session);
    const room = this.rooms.get(roomId) ?? new Map();
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, room);
      this.roomSettings.set(roomId, { map, mode });
      this.roomMatches.set(roomId, new RoomMatch(mode));
    }
    const team = balancedTeam(room);
    room.set(session.id, {
      id: session.id,
      socket,
      team,
      x: room.size * 30,
      y: 0,
      inputX: 0,
      inputY: 0,
      ready: false,
      gameState: null
    });
    session.roomId = roomId;
    session.team = team;
    return { ...this.roomSettings.get(roomId), team };
  }

  leave(session) {
    if (!session.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (room) {
      room.delete(session.id);
      if (room.size === 0) {
        this.rooms.delete(session.roomId);
        this.roomSettings.delete(session.roomId);
        this.roomMatches.delete(session.roomId);
      }
    }
    session.roomId = null;
    session.team = null;
  }

  setReady(session, ready) {
    if (typeof ready !== "boolean") throw new Error("Ready must be true or false.");
    const player = this.rooms.get(session.roomId)?.get(session.id);
    if (!player) throw new Error("Join a room before readying.");
    player.ready = ready;
    if (!ready) player.gameState = null;
  }

  // 3D movement is presentation telemetry from the browser, not proof of
  // legitimate game physics or hits. Server validates size and value bounds.
  setPlayerState(session, state) {
    const player = this.rooms.get(session.roomId)?.get(session.id);
    if (!player?.ready) throw new Error("Load the game before sending player state.");
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("Invalid player state.");
    }
    const keys = ["x", "y", "z", "yaw", "pitch", "vx", "vz"];
    if (!keys.every(key => Number.isFinite(state[key]))) {
      throw new Error("Player coordinates and angles must be finite.");
    }
    if (["x", "y", "z"].some(key => Math.abs(state[key]) > 4096) ||
        ["vx", "vz"].some(key => Math.abs(state[key]) > 100) ||
        Math.abs(state.yaw) > 1000 || Math.abs(state.pitch) > 4) {
      throw new Error("Player state outside permitted bounds.");
    }
    const weapon = typeof state.weapon === "string" && /^[a-z0-9_]{1,36}$/.test(state.weapon)
      ? state.weapon : "knife";
    const name = typeof state.name === "string"
      ? state.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 24) : "Player";
    const appearance = {
      skin: cleanCosmetic(state.skin),
      skinItem: cleanCosmetic(state.skinItem),
      gloves: cleanCosmetic(state.gloves)
    };
    player.gameState = {
      name: name || "Player",
      x: state.x, y: state.y, z: state.z,
      yaw: state.yaw, pitch: state.pitch, vx: state.vx, vz: state.vz,
      crouch: state.crouch === true, airborne: state.airborne === true,
      alive: state.alive === true, weapon,
      ...appearance,
      scoped: state.scoped === true,
      reloading: state.reloading === true,
      walking: state.walking === true,
      firing: state.firing === true,
      melee: state.melee === true
    };
  }

  relayAction(session, payload) {
    const room = this.rooms.get(session.roomId);
    const actor = room?.get(session.id);
    if (!actor?.ready || !actor.gameState) throw new Error("Not in a loaded match.");
    if (!payload || !["fire", "reload", "jump", "land", "equip",
      "knife", "step", "weapon_sound", "grenade_prep", "grenade_throw",
      "scope", "crouch", "death", "spawn"].includes(payload.kind)) {
      throw new Error("Unsupported player action.");
    }
    const message = { type: "player_action", id: session.id, kind: payload.kind };
    if (payload.kind === "fire") {
      if (!Array.isArray(payload.dir) || payload.dir.length !== 3 ||
          !payload.dir.every(n => Number.isFinite(n) && Math.abs(n) <= 1.1)) {
        throw new Error("Invalid shot direction.");
      }
      message.dir = payload.dir;
    }
    if (payload.kind === "reload" && Number.isFinite(payload.duration)) {
      message.duration = Math.max(0.1, Math.min(30, payload.duration));
      message.empty = payload.empty === true;
    }
    if (typeof payload.weapon === "string" && /^[a-z0-9_]{1,36}$/.test(payload.weapon)) {
      message.weapon = payload.weapon;
    }
    if (payload.kind === "knife") message.heavy = payload.heavy === true;
    if (payload.kind === "scope") message.scoped = payload.scoped === true;
    if (payload.kind === "weapon_sound" || payload.kind === "step") {
      if (typeof payload.sound !== "string" ||
          !/^(?:clipout|clipin|bolt|draw|toss|step(?:_[a-z]+)?|knife_draw(?:_t)?|knife_swing(?:_heavy)?|gear_small|land)(?:_[a-z0-9]+)?$/.test(payload.sound)) {
        throw new Error("Invalid animation sound.");
      }
      message.sound = payload.sound;
    }
    return {
      recipients: [...room.values()].filter(player => player.id !== session.id)
        .map(player => player.socket),
      message
    };
  }

  matchState(roomId, now = performance.now()) {
    const room = this.rooms.get(roomId);
    const match = this.roomMatches.get(roomId);
    if (!room || !match) return null;
    const readyCT = [...room.values()].some(player => player.team === "CT" && player.ready);
    const readyT = [...room.values()].some(player => player.team === "T" && player.ready);
    match.advance(now, readyCT && readyT);
    return match.snapshot(roomId, room, now);
  }

  matchStates(now = performance.now()) {
    return [...this.rooms].map(([roomId, room]) => ({
      recipients: [...room.values()].map(player => player.socket),
      message: this.matchState(roomId, now)
    }));
  }

  setInput(session, x, y) {
    if (!validInput(x, y)) throw new Error("Input must be finite and between -1 and 1.");
    const player = this.rooms.get(session.roomId)?.get(session.id);
    if (!player) throw new Error("Join a room before sending movement.");
    const direction = normalizedInput(x, y);
    player.inputX = direction.x;
    player.inputY = direction.y;
  }

  tick() {
    this.tickNumber += 1;
    const snapshots = [];
    for (const [roomId, room] of this.rooms) {
      for (const player of room.values()) {
        player.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT,
          player.x + player.inputX * MOVE_SPEED / TICK_HZ));
        player.y = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT,
          player.y + player.inputY * MOVE_SPEED / TICK_HZ));
      }
      snapshots.push({
        roomId,
        recipients: [...room.values()].map((player) => player.socket),
        message: {
          type: "snapshot",
          room: roomId,
          tick: this.tickNumber,
          players: [...room.values()].map(({ id, team, x, y, gameState }) =>
            ({ id, team, x, y, ...(gameState ? { game: gameState } : {}) }))
        }
      });
    }
    return snapshots;
  }
}
