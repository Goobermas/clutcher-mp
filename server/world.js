export const TICK_HZ = 20;
export const MOVE_SPEED = 120;
export const MAX_PLAYERS_PER_ROOM = 16;
export const MAX_ROOMS = 100;
export const WORLD_LIMIT = 1000;
export const MAPS = Object.freeze(["oasis", "dusker"]);
export const MODES = Object.freeze(["defusal", "dm"]);

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
          if (MODES.includes(options?.mode)) settings.mode = options.mode;
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
    }
    const team = balancedTeam(room);
    room.set(session.id, {
      id: session.id,
      socket,
      team,
      x: room.size * 30,
      y: 0,
      inputX: 0,
      inputY: 0
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
      }
    }
    session.roomId = null;
    session.team = null;
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
          players: [...room.values()].map(({ id, team, x, y }) => ({ id, team, x, y }))
        }
      });
    }
    return snapshots;
  }
}
