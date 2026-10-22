export const TICK_HZ = 20;
export const MOVE_SPEED = 120;
export const MAX_PLAYERS_PER_ROOM = 16;
export const MAX_ROOMS = 100;
export const WORLD_LIMIT = 1000;

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

export class World {
  constructor() {
    this.rooms = new Map();
    this.tickNumber = 0;
  }

  join(session, roomId, socket) {
    if (!validRoomName(roomId)) {
      throw new Error("Room names must be 1–32 letters, numbers, - or _.");
    }
    if (session.roomId === roomId) return;

    const target = this.rooms.get(roomId);
    if (target && target.size >= MAX_PLAYERS_PER_ROOM) {
      throw new Error("Room is full.");
    }
    if (!target && this.rooms.size >= MAX_ROOMS) {
      // Switching away from the last member of a room makes one slot available.
      const old = this.rooms.get(session.roomId);
      if (!old || old.size !== 1) throw new Error("Room limit reached.");
    }

    this.leave(session);

    const room = this.rooms.get(roomId) ?? new Map();
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, room);
    room.set(session.id, {
      id: session.id,
      socket,
      x: room.size * 30,
      y: 0,
      inputX: 0,
      inputY: 0
    });
    session.roomId = roomId;
  }

  leave(session) {
    if (!session.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (room) {
      room.delete(session.id);
      if (room.size === 0) this.rooms.delete(session.roomId);
    }
    session.roomId = null;
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
          players: [...room.values()].map(({ id, x, y }) => ({ id, x, y }))
        }
      });
    }
    return snapshots;
  }
}
