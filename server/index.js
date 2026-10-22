import http from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { World, TICK_HZ } from "./world.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8085);
const PROTOCOL_VERSION = 1;
const MAX_MESSAGES_PER_SECOND = 100;
const MAX_BUFFERED_BYTES = 256 * 1024;
const world = new World();
const testPage = readFileSync(new URL("../client/test.html", import.meta.url));

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
  socket.send(typeof message === "string" ? message : JSON.stringify(message));
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain" }).end("Method not allowed");
  } else if (pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }).end(testPage);
  } else if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ status: "ok", protocol_version: PROTOCOL_VERSION }));
  } else {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 8192,
  perMessageDeflate: false
});

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (socket) => {
  const session = { id: randomUUID(), roomId: null };
  let rateWindowStart = Date.now();
  let messageCount = 0;
  socket.isAlive = true;

  socket.on("pong", () => { socket.isAlive = true; });
  send(socket, {
    type: "welcome",
    id: session.id,
    protocol_version: PROTOCOL_VERSION,
    tick_hz: TICK_HZ
  });

  socket.on("message", (raw, isBinary) => {
    const now = Date.now();
    if (now - rateWindowStart >= 1000) {
      rateWindowStart = now;
      messageCount = 0;
    }
    if (++messageCount > MAX_MESSAGES_PER_SECOND) {
      socket.close(1008, "Rate limit exceeded");
      return;
    }

    if (isBinary) {
      send(socket, { type: "error", message: "JSON text messages only." });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw.toString("utf8"));
    } catch {
      send(socket, { type: "error", message: "Invalid JSON." });
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      send(socket, { type: "error", message: "Invalid message." });
      return;
    }

    try {
      switch (data.type) {
        case "join_room": {
          const assignment = world.join(session, data.room, socket, {
            map: data.map,
            mode: data.mode
          });
          send(socket, {
            type: "joined",
            room: session.roomId,
            team: assignment.team,
            map: assignment.map,
            mode: assignment.mode
          });
          send(socket, world.matchState(session.roomId));
          send(socket, {type:"grenade_snapshot",
            projectiles:world.grenades.snapshot(session.roomId)});
          break;
        }
        case "input":
          world.setInput(session, data.x, data.y);
          break;
        case "ready":
          world.setReady(session, data.ready);
          send(socket, world.matchState(session.roomId));
          break;
        case "player_state":
          world.setPlayerState(session, data);
          break;
        case "objective_intent":
          world.setObjectiveIntent(session,data.kind);
          break;
        case "grenade_throw":
        case "grenade_state":
        case "grenade_finish": {
          const now=performance.now();
          const message=data.type==="grenade_throw"
            ? world.beginGrenade(session,data,now)
            : data.type==="grenade_state"
              ? world.updateGrenade(session,data,now)
              : world.finishGrenade(session,data,now);
          for(const peer of world.roomRecipients(session.roomId,session.id))
            send(peer,message);
          break;
        }
        case "action": {
          const { recipients, message } = world.relayAction(session, data);
          for (const peer of recipients) send(peer, message);
          break;
        }
        case "ping":
          if (!Number.isSafeInteger(data.nonce) || data.nonce < 0) {
            throw new Error("Invalid ping nonce.");
          }
          send(socket, { type: "pong", nonce: data.nonce });
          break;
        default:
          throw new Error("Unknown message type.");
      }
    } catch (error) {
      send(socket, { type: "error", message: error.message });
    }
  });

  socket.on("close", () => {
    world.leave(session);
    console.log(`Player disconnected: ${session.id}`);
  });
  socket.on("error", (error) => console.error("WebSocket error:", error.message));
  console.log(`Player connected: ${session.id}`);
});

const tickInterval = setInterval(() => {
  for (const { recipients, message } of world.tick()) {
    const encoded = JSON.stringify(message);
    for (const socket of recipients) send(socket, encoded);
  }
}, 1000 / TICK_HZ);

// Independent 4 Hz room clock updates. Every client receives the same
// remaining time, round number, and CT/T score from the server.
const matchInterval = setInterval(() => {
  world.grenades.sweep(performance.now());
  for (const { recipients, message } of world.matchStates()) {
    for (const socket of recipients) send(socket, message);
  }
}, 250);

const heartbeatInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);

function shutdown() {
  console.log("Shutting down...");
  clearInterval(tickInterval);
  clearInterval(matchInterval);
  clearInterval(heartbeatInterval);
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  server.close(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Clutcher MP v0.1 listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
});
