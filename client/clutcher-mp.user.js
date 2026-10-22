// ==UserScript==
// @name         Clutcher MP - Multiplayer Bridge
// @namespace    https://sillyhack.com/
// @version      0.2.0
// @description  New Clutcher multiplayer WebSocket client (networking prototype)
// @author       SillyHack
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  // The existing TLS reverse proxy serves WSS publicly on port 443.
  // The Node.js backend can continue listening internally on port 8085.
  const DEFAULT_URL = 'wss://mp.sillyhack.com/ws';
  const PREVIOUS_DEFAULT_URL = 'wss://mp.sillyhack.com:8085/ws';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const DEFAULT_ROOM = 'lobby';
  const PROTOCOL_VERSION = 1;
  const SEND_INTERVAL_MS = 50;
  const PING_INTERVAL_MS = 2000;

  const storedUrl = GM_getValue('clutcher_mp_url', DEFAULT_URL);
  // Upgrade only the former script default; preserve manually configured URLs.
  const savedUrl = storedUrl === PREVIOUS_DEFAULT_URL ? DEFAULT_URL : storedUrl;
  if (savedUrl !== storedUrl) GM_setValue('clutcher_mp_url', savedUrl);
  const savedRoom = GM_getValue('clutcher_mp_room', DEFAULT_ROOM);

  let socket = null;
  let playerId = null;
  let joinedRoom = null;
  let players = [];
  let assignedTeam = null;
  let assignedMap = null;
  let assignedMode = null;
  let pendingPlay = false;
  let launchBusy = false;
  let autoReconnect = true;
  let retryTimer = null;
  let retryDelay = 1500;
  const heldKeys = new Set();

  // These are document-level game elements, outside our shadow DOM.
  const nativeStyles = document.createElement('style');
  nativeStyles.id = 'clutcher-mp-native-styles';
  nativeStyles.textContent = [
    '#teamsel { display: none !important; pointer-events: none !important; }',
    '#opt-outfit { display: none !important; }',
    '#opt-botson button[data-v="1"] { display: none !important; }',
    '#menu .srow.botdep { display: none !important; }'
  ].join('\n');
  document.documentElement.appendChild(nativeStyles);

  const host = document.createElement('div');
  host.id = 'clutcher-mp-bridge';
  host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box; }
      .panel { width: 263px; color: #e5e7eb; background: rgba(12,18,29,.96);
        border: 1px solid #374151; border-radius: 12px; overflow: hidden;
        box-shadow: 0 10px 35px #0008; font: 12px/1.45 system-ui, sans-serif; }
      .head { display: flex; align-items: center; gap: 8px; padding: 9px 11px;
        background: #192438; border-bottom: 1px solid #334155; }
      .head strong { font-size: 13px; flex: 1; letter-spacing: .2px; }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
      .status-dot.connected { background: #22c55e; }
      .status-dot.connecting { background: #f59e0b; }
      .minimize { background: none; border: 0; color: #cbd5e1; font-size: 18px;
        cursor: pointer; padding: 0 4px; }
      .body { padding: 10px; }
      .body.hidden { display: none; }
      label { display: block; color: #a5b4cc; margin-bottom: 4px; }
      input { width: 100%; background: #0d1524; color: #e5e7eb; border: 1px solid #45546d;
        border-radius: 5px; padding: 7px; font: 12px/1.3 system-ui, sans-serif; }
      .field { margin-bottom: 9px; }
      .buttons { display: flex; gap: 5px; margin: 9px 0; }
      button.action { flex: 1; padding: 7px 4px; border: 1px solid #475569; border-radius: 5px;
        background: #27374e; color: #f1f5f9; font: inherit; cursor: pointer; }
      button.action:hover { background: #385274; }
      #mpStatus { min-height: 19px; color: #a5b4cc; overflow-wrap: anywhere; }
      .stats { display: flex; justify-content: space-between; color: #9ca3af; margin: 6px 0; }
      canvas { display: block; width: 100%; background: #0c1524; border: 1px solid #334155;
        border-radius: 5px; }
      .hint { margin: 6px 0 0; color: #8190a7; font-size: 11px; }
      .team { color: #8bd0ff; font-weight: 600; }
      /* Native team cards are not used in server-assigned multiplayer. */
      #teamsel { display: none !important; }
    </style>
    <section class="panel">
      <div class="head">
        <span class="status-dot" id="mpDot"></span>
        <strong>Clutcher MP <small style="color:#94a3b8">v0.1</small></strong>
        <button class="minimize" id="mpToggle" title="Collapse panel">−</button>
      </div>
      <div class="body" id="mpBody">
        <div class="field">
          <label for="mpUrl">WebSocket server</label>
          <input id="mpUrl" spellcheck="false" autocomplete="off">
        </div>
        <div class="field">
          <label for="mpRoom">Room</label>
          <input id="mpRoom" maxlength="32" spellcheck="false" autocomplete="off">
        </div>
        <div class="buttons">
          <button class="action" id="mpConnect">Connect</button>
          <button class="action" id="mpJoin">Join</button>
          <button class="action" id="mpDisconnect">Leave</button>
        </div>
        <div id="mpStatus" role="status">Disconnected</div>
        <div class="stats"><span>Your team: <b class="team" id="mpTeam">—</b></span><span id="mpMapName">No map</span></div>
        <div class="stats"><span id="mpPlayers">0 players</span><span id="mpPing">Ping: —</span></div>
        <canvas id="mpMap" width="236" height="126"></canvas>
        <p class="hint">Play starts the real map with 0 bots and an assigned team. Remote positions are still a test overlay, not in-game models.</p>
      </div>
    </section>`;

  const $ = (id) => shadow.getElementById(id);
  const urlInput = $('mpUrl');
  const roomInput = $('mpRoom');
  const status = $('mpStatus');
  const dot = $('mpDot');
  const canvas = $('mpMap');
  const ctx = canvas.getContext('2d');

  urlInput.value = savedUrl;
  roomInput.value = savedRoom;

  function setStatus(message, state = 'disconnected') {
    status.textContent = message;
    dot.className = 'status-dot' + (state === 'disconnected' ? '' : ' ' + state);
  }

  function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) return;
    socket.send(JSON.stringify(data));
  }

  function stopRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry() {
    if (!autoReconnect || retryTimer !== null) return;
    const delay = retryDelay;
    setStatus('Reconnecting in ' + Math.round(delay / 1000) + 's...');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
    retryDelay = Math.min(retryDelay * 2, 20000);
  }

  function chosenOption(group, fallback) {
    const selected = document.querySelector('#opt-' + group + ' button.sel');
    return selected?.dataset?.v || fallback;
  }

  function gameInstance() {
    return PAGE.game || window.game || null;
  }

  function enforceNoBots() {
    const game = gameInstance();
    if (!game || typeof game.startGame !== 'function') return false;

    // Also enforces zero bots if native code attempts to start another local match.
    if (!game.__clutcherMpNoBots) {
      const originalStart = game.startGame;
      game.startGame = function (map, bots, difficulty, mode) {
        return originalStart.call(this, map, 0, difficulty, mode);
      };
      game.__clutcherMpNoBots = true;
    }

    // Keep the native Settings UI consistent and avoid expensive bot warmups.
    const off = document.querySelector('#opt-botson button[data-v="0"]');
    if (off && !off.classList.contains('sel')) off.click();
    return true;
  }

  async function launchAssignedGame() {
    if (launchBusy || !pendingPlay) return;
    if (!['CT', 'T'].includes(assignedTeam) || !joinedRoom) {
      setStatus('Waiting for server to assign a team...', 'connecting');
      return;
    }
    const game = gameInstance();
    if (!game || typeof game.startGame !== 'function') {
      setStatus('Clutcher is still loading. Try Play again.', 'connecting');
      return;
    }
    if (game.state === 'playing') {
      pendingPlay = false;
      return;
    }
    if (game.state !== 'menu' && game.state !== 'teamselect') {
      setStatus('Return to the game menu before pressing Play.');
      pendingPlay = false;
      return;
    }

    launchBusy = true;
    pendingPlay = false;
    enforceNoBots();
    const map = assignedMap || 'oasis';
    const mode = assignedMode || 'defusal';
    setStatus('Loading ' + map + ' as ' + assignedTeam + ' (0 bots)...', 'connected');

    try {
      if (game.state === 'menu') {
        const ok = await game.startGame(map, 0, 0, mode);
        if (!ok) throw new Error('Game could not load the selected map.');
      }
      if (game.state !== 'teamselect') throw new Error('Game did not enter the expected loading state.');

      // The game itself needs finishTeamSelect() to initialize the character,
      // weapons and round. Only the assigned team is passed, with bots set to 0.
      if (game._pending) game._pending.botCount = 0;
      await game.finishTeamSelect(assignedTeam);
      if (game.state !== 'playing') throw new Error('Game did not finish entering the map.');
      setStatus('Playing ' + map + ' • ' + assignedTeam + ' • no bots', 'connected');
    } catch (error) {
      console.error('[Clutcher MP] Auto-launch failed:', error);
      setStatus('Could not start: ' + (error?.message || String(error)).slice(0, 110));
    } finally {
      launchBusy = false;
    }
  }

  // Stop the native Play onclick (which normally uses a local bot count and
  // opens manual team selection). Ask the server to assign a team first.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target?.closest?.('#btn-play')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (launchBusy) return;
    pendingPlay = true;
    enforceNoBots();
    if (socket?.readyState === WebSocket.OPEN) {
      joinRoom();
    } else if (socket?.readyState === WebSocket.CONNECTING) {
      setStatus('Connecting to server before starting...', 'connecting');
    } else {
      connect();
    }
  }, true);

  // Ignore manual team-card clicks even if some other game code shows the cards.
  document.addEventListener('click', (event) => {
    const element = event.target;
    if (!element?.closest?.('#teamsel [data-team]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Poll because Clutcher creates window.game asynchronously via its ES module.
  setInterval(enforceNoBots, 250);

  function connect() {
    stopRetry();
    autoReconnect = true;
    retryDelay = Math.max(retryDelay, 1500);

    let endpoint;
    try {
      endpoint = new URL(urlInput.value.trim());
      if (!['ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Use ws:// or wss://');
      if (endpoint.username || endpoint.password) throw new Error('Do not include credentials in URL');
      if (location.protocol === 'https:' && endpoint.protocol !== 'wss:') {
        setStatus('HTTPS game requires wss:// (TLS). Plain ws://:8085 is blocked.');
        autoReconnect = false;
        return;
      }
    } catch {
      autoReconnect = false;
      setStatus('Invalid WebSocket URL.');
      return;
    }

    GM_setValue('clutcher_mp_url', endpoint.href);
    GM_setValue('clutcher_mp_room', roomInput.value.trim());

    if (socket) {
      const old = socket;
      socket = null;
      old.close();
    }

    joinedRoom = null;
    playerId = null;
    players = [];
    assignedTeam = assignedMap = assignedMode = null;
    updateStats();
    setStatus('Connecting to ' + endpoint.host + '...', 'connecting');

    let ws;
    try {
      ws = new WebSocket(endpoint.href);
    } catch (error) {
      setStatus('Cannot open socket: ' + String(error.message || error));
      scheduleRetry();
      return;
    }
    socket = ws;

    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      retryDelay = 1500;
      setStatus('Connected — joining room...', 'connected');
      joinRoom();
    });

    ws.addEventListener('message', (event) => {
      if (socket !== ws || typeof event.data !== 'string') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      switch (message.type) {
        case 'welcome':
          if (message.protocol_version !== PROTOCOL_VERSION) {
            setStatus('Unsupported protocol: ' + message.protocol_version);
            autoReconnect = false;
            ws.close();
            return;
          }
          playerId = message.id;
          updateStats();
          break;
        case 'joined':
          if (!['CT', 'T'].includes(message.team) ||
              !['oasis', 'dusker'].includes(message.map) ||
              !['defusal', 'dm'].includes(message.mode)) {
            pendingPlay = false;
            setStatus('Outdated server: git pull + restart Node.js for auto teams.');
            break;
          }
          joinedRoom = message.room;
          assignedTeam = message.team;
          assignedMap = message.map;
          assignedMode = message.mode;
          players = [];
          $('mpTeam').textContent = assignedTeam;
          $('mpMapName').textContent = assignedMap + ' / ' + assignedMode;
          setStatus('Room: ' + joinedRoom + ' • Team: ' + assignedTeam, 'connected');
          updateStats();
          if (pendingPlay) void launchAssignedGame();
          break;
        case 'snapshot':
          if (message.room !== joinedRoom || !Array.isArray(message.players)) break;
          players = message.players.filter((p) =>
            typeof p.id === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y)
          ).slice(0, 16);
          updateStats();
          draw();
          break;
        case 'pong':
          if (Number.isSafeInteger(message.nonce)) {
            $('mpPing').textContent = 'Ping: ' + Math.max(0, Date.now() - message.nonce) + 'ms';
          }
          break;
        case 'error':
          setStatus('Server: ' + String(message.message || 'unknown error').slice(0, 140), 'connected');
          break;
      }
    });

    ws.addEventListener('error', () => {
      if (socket === ws) setStatus('Connection failed. Check WSS/TLS and server address.');
    });

    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null;
      joinedRoom = null;
      playerId = null;
      players = [];
      assignedTeam = assignedMap = assignedMode = null;
      $('mpTeam').textContent = '—';
      $('mpMapName').textContent = 'No map';
      heldKeys.clear();
      updateStats();
      draw();
      scheduleRetry();
      if (!autoReconnect) setStatus('Disconnected');
    });
  }

  function joinRoom() {
    const room = roomInput.value.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(room)) {
      setStatus('Room must be 1–32 letters, digits, - or _.');
      return;
    }
    GM_setValue('clutcher_mp_room', room);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setStatus('Connect first.');
      return;
    }
    joinedRoom = null;
    players = [];
    send({
      type: 'join_room',
      room,
      map: chosenOption('map', 'oasis'),
      mode: chosenOption('mode', 'defusal')
    });
  }

  function disconnect() {
    autoReconnect = false;
    pendingPlay = false;
    stopRetry();
    heldKeys.clear();
    if (socket) {
      const old = socket;
      socket = null;
      old.close(1000, 'User disconnected');
    }
    joinedRoom = null;
    playerId = null;
    players = [];
    assignedTeam = assignedMap = assignedMode = null;
    $('mpTeam').textContent = '—';
    $('mpMapName').textContent = 'No map';
    updateStats();
    draw();
    setStatus('Disconnected');
  }

  function updateStats() {
    const ct = players.filter((player) => player.team === 'CT').length;
    const t = players.filter((player) => player.team === 'T').length;
    $('mpPlayers').textContent = players.length + ' online • CT ' + ct + ' / T ' + t;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#142134';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#29384a';
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    const self = players.find((p) => p.id === playerId);
    const centerX = self?.x ?? 0;
    const centerY = self?.y ?? 0;
    ctx.font = '10px system-ui';
    for (const player of players) {
      const x = canvas.width / 2 + (player.x - centerX) * 0.45;
      const y = canvas.height / 2 + (player.y - centerY) * 0.45;
      if (x < 4 || x > canvas.width - 4 || y < 4 || y > canvas.height - 4) continue;
      const isSelf = player.id === playerId;
      ctx.fillStyle = player.team === 'CT' ? '#38bdf8' : '#fbbf24';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(isSelf ? 'You' : player.id.slice(0, 5), x + 7, y - 5);
    }
  }

  function typingInField() {
    const active = document.activeElement;
    const shadowActive = shadow.activeElement;
    return Boolean(
      (active && (active.matches('input, textarea, select') || active.isContentEditable)) ||
      (shadowActive && shadowActive.matches('input, textarea, select'))
    );
  }

  window.addEventListener('keydown', (event) => {
    if (typingInField() || event.ctrlKey || event.altKey || event.metaKey) {
      heldKeys.clear();
      return;
    }
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) heldKeys.add(key);
  }, true);

  window.addEventListener('keyup', (event) => {
    heldKeys.delete(event.key.toLowerCase());
  }, true);

  window.addEventListener('blur', () => heldKeys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) heldKeys.clear();
  });

  setInterval(() => {
    if (!joinedRoom || !socket || socket.readyState !== WebSocket.OPEN) return;
    const enabled = document.hasFocus() && !typingInField() && !document.hidden;
    send({
      type: 'input',
      x: enabled ? Number(heldKeys.has('d')) - Number(heldKeys.has('a')) : 0,
      y: enabled ? Number(heldKeys.has('s')) - Number(heldKeys.has('w')) : 0
    });
  }, SEND_INTERVAL_MS);

  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      send({ type: 'ping', nonce: Date.now() });
    }
  }, PING_INTERVAL_MS);

  $('mpConnect').addEventListener('click', () => {
    retryDelay = 1500;
    connect();
  });
  $('mpJoin').addEventListener('click', joinRoom);
  $('mpDisconnect').addEventListener('click', disconnect);
  $('mpToggle').addEventListener('click', () => {
    const collapsed = $('mpBody').classList.toggle('hidden');
    $('mpToggle').textContent = collapsed ? '+' : '−';
  });

  draw();
  setTimeout(connect, 700);
})();
