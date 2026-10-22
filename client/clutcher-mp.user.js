// ==UserScript==
// @name         Clutcher MP - Multiplayer Bridge
// @namespace    https://sillyhack.com/
// @version      0.4.0
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
  let matchState = null;
  let matchDeadline = 0;
  let isReady = false;
  let activeGame = null;
  let lastNativeHudAt = 0;
  let lastPhaseSignature = '';
  let autoReconnect = true;
  let retryTimer = null;
  let retryDelay = 1500;
  const heldKeys = new Set();
  const remoteModels = new Map();
  let remoteConstructor = null;
  let lastGrounded = true;
  let lastSentWeapon = null;

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
      .match-line { display:flex;justify-content:space-between;gap:6px;padding:7px 8px;
        background:#101b2b;border:1px solid #344256;border-radius:6px;margin-bottom:8px;
        font-weight:700;font-size:13px; }
      .match-line .time { color:#dce9ff; font-variant-numeric:tabular-nums; }
      .match-line .ct { color:#68baff; }
      .match-line .t { color:#f5c15c; }
      .phase { font-size:11px;color:#b2bfd1;margin:0 0 7px 0; }
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
        <div class="match-line"><span class="ct" id="mpCT">CT 0</span><span class="time" id="mpClock">—:——</span><span class="t" id="mpT">0 T</span></div>
        <div class="phase" id="mpPhase">Waiting for match state</div>
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



  // Visual remote players. Reuse the game's model renderer, but never run
  // the normal bot AI. The previous single-player bot count stays ZERO.
  function discoverRemoteConstructor(game) {
    if (remoteConstructor) return remoteConstructor;
    const manager = game?.botMgr;
    if (!manager?.setup || !Array.isArray(manager.bots)) return null;
    remoteConstructor = manager.bots[0]?.constructor ?? null;
    if (!remoteConstructor && manager.bots.length === 0) {
      try {
        // One temporary bot is only used to discover its constructor.
        // Clear it immediately before any update frame.
        manager.setup(1, 3, assignedTeam || 'CT');
        remoteConstructor = manager.bots[0]?.constructor ?? null;
      } finally {
        manager.setup(0, 3, assignedTeam || 'CT');
      }
    }
    return remoteConstructor;
  }

  function removeRemoteModel(id) {
    const bot = remoteModels.get(id);
    if (!bot) return;
    const game = gameInstance();
    const bots = game?.botMgr?.bots;
    if (Array.isArray(bots)) {
      const idx = bots.indexOf(bot);
      if (idx !== -1) bots.splice(idx, 1);
    }
    for (const model of [bot.cs2Agent?.root, bot.shadow, bot.mesh]) {
      if (model) try { game?.scene?.remove?.(model); } catch {}
    }
    remoteModels.delete(id);
  }

  function clearRemoteModels() {
    for (const id of [...remoteModels.keys()]) removeRemoteModel(id);
    remoteConstructor = null;
  }

  function makeRemoteModel(player) {
    const game = gameInstance();
    const state = player.game;
    if (!game || game.state !== 'playing' || !game.botMgr ||
        !state || player.id === playerId) return null;
    const Bot = discoverRemoteConstructor(game);
    if (!Bot) return null;
    try {
      const bot = new Bot(game, player.team === 'CT' ? 'CT' : 'T', state.name || 'Player', 3);
      bot._clutcherMpRemote = player.id;
      bot._networkTarget = state;
      bot.target = { multiplayer: true };
      bot.x = state.x;
      bot.y = state.y;
      bot.z = state.z;
      bot.yaw = state.yaw;
      bot._visY = state.y;
      bot.weapon = state.weapon;
      bot.respawnT = Infinity;
      bot.health = 100;
      bot.alive = state.alive;
      bot.update = function(dt) {
        const next = this._networkTarget;
        if (!next) return;
        const alpha = Math.min(1, Math.max(0, dt) * 16);
        this.x += (next.x - this.x) * alpha;
        this.y += (next.y - this.y) * alpha;
        this.z += (next.z - this.z) * alpha;
        const delta = Math.atan2(Math.sin(next.yaw - this.yaw), Math.cos(next.yaw - this.yaw));
        this.yaw += delta * alpha;
        this._lookPitch = next.pitch;
        this.crouchT = next.crouch ? 0.1 : 0;
        this.onGround = !next.airborne;
        this.vy = next.airborne ? 1 : 0;
        this.vx += (next.vx - this.vx) * alpha;
        this.vz += (next.vz - this.vz) * alpha;
        this.weapon = next.weapon;
        this.name = next.name || this.name;
        this._visY = this.y;
        // The real game renderer animates the character body, gun and shadow.
        this._updateCS2Body?.(dt, game);
        this.shadow?.position?.set?.(this.x, this.y + 0.02, this.z);
      };
      game.botMgr.bots.push(bot);
      remoteModels.set(player.id, bot);
      try { game.hud?.buildAvatars?.(); } catch {}
      return bot;
    } catch (error) {
      console.warn('[Clutcher MP] Remote character model failed:', error);
      return null;
    }
  }

  function syncRemoteModels() {
    const game = gameInstance();
    if (!game || game.state !== 'playing' || !isReady || !joinedRoom) {
      if (remoteModels.size) clearRemoteModels();
      return;
    }
    const seen = new Set();
    for (const player of players) {
      if (player.id === playerId || !player.game) continue;
      const data = player.game;
      if (!['CT', 'T'].includes(player.team) ||
          !['x','y','z','yaw','pitch','vx','vz'].every(key => Number.isFinite(data[key]))) continue;
      seen.add(player.id);
      const model = remoteModels.get(player.id) || makeRemoteModel(player);
      if (!model) continue;
      model.team = player.team;
      model._networkTarget = data;
      if (data.alive && !model.alive) {
        model.alive = true;
        model.health = 100;
        model.cs2Agent?.revive?.();
        if (model.shadow) model.shadow.visible = true;
      } else if (!data.alive && model.alive) {
        model.alive = false;
        if (model.cs2Agent?.root) model.cs2Agent.root.visible = false;
        if (model.shadow) model.shadow.visible = false;
      } else if (data.alive && model.cs2Agent?.root) {
        model.cs2Agent.root.visible = true;
      }
    }
    for (const id of [...remoteModels.keys()]) {
      if (!seen.has(id)) removeRemoteModel(id);
    }
  }

  function remoteAction(message) {
    const bot = remoteModels.get(message.id);
    const game = gameInstance();
    if (!bot || !game || !bot.alive) return;
    try {
      if (message.kind === 'fire') {
        bot.cs2Agent?.shoot?.(bot.weapon);
        const sound = 'shot_' + bot.weapon;
        if (game.audio?.manifest?.[sound] || game.audio?.bank?.has?.(sound)) {
          game.audio?.play?.(sound, { pos: bot });
        }
        if (message.dir?.length === 3) {
          const [dx, dy, dz] = message.dir;
          const sy = bot.y + (bot.crouchT ? 1.1 : 1.6);
          game.effects?.tracer?.(bot.x, sy, bot.z,
            bot.x + dx * 35, sy + dy * 35, bot.z + dz * 35, 'rifle', bot.weapon);
        }
      } else if (message.kind === 'reload') {
        bot.cs2Agent?.reload?.(bot.weapon, message.duration || 2.5,
          { crouched: !!bot.crouchT });
      } else if (message.kind === 'jump') {
        game.audio?.play?.('gear_small', { pos: bot });
      } else if (message.kind === 'land') {
        game.audio?.play?.('land', { pos: bot });
      }
    } catch (error) {
      console.debug('[Clutcher MP] Remote animation skipped:', error);
    }
  }

  function installActionHooks(game) {
    if (!game || game.__clutcherMpActions) return;
    game.__clutcherMpActions = true;
    if (typeof game.fireBullet === 'function') {
      const original = game.fireBullet;
      game.fireBullet = function(shooter, x, y, z, dx, dy, dz) {
        if (isReady && shooter === game.player && [dx,dy,dz].every(Number.isFinite)) {
          const length = Math.hypot(dx,dy,dz) || 1;
          send({ type:'action', kind:'fire', dir:[dx/length,dy/length,dz/length] });
        }
        return original.apply(this, arguments);
      };
    }
    if (typeof game.dealDamage === 'function') {
      const original = game.dealDamage;
      game.dealDamage = function(target) {
        // Never apply fake local damage to another human's visual bot.
        if (target?._clutcherMpRemote) return;
        return original.apply(this, arguments);
      };
    }
    const audio = game.audio;
    if (typeof audio?.playWeapon === 'function' && !audio.__clutcherMpAudioHook) {
      const original = audio.playWeapon;
      audio.__clutcherMpAudioHook = true;
      audio.playWeapon = function(part, weapon, options) {
        if (isReady && String(part).startsWith('clipout') && !options?.pos) {
          send({ type:'action', kind:'reload',
            duration: Math.max(0.1, Math.min(15, Number(game.weapons?.def?.()?.reload) || 2.5)) });
        }
        return original.apply(this, arguments);
      };
    }
  }

  function publishGameState() {
    const game = gameInstance();
    const p = game?.player;
    if (!isReady || !joinedRoom || game?.state !== 'playing' || !p) return;
    installActionHooks(game);
    const values = [p.x, p.y, p.z, p.yaw, p.pitch, p.vx, p.vz];
    if (!values.every(Number.isFinite)) return;
    const name = String(PAGE.localStorage?.getItem?.('clutcher_name') || 'Player');
    send({
      type:'player_state', name,
      x:p.x, y:p.y, z:p.z,
      yaw:p.yaw, pitch:p.pitch, vx:p.vx, vz:p.vz,
      crouch:!!p.crouching, airborne:!p.onGround,
      alive:!!p.alive, weapon:game.weapons?.current || 'knife'
    });
    if (lastGrounded && !p.onGround && p.vy > 0.5) {
      send({ type:'action', kind:'jump' });
    } else if (!lastGrounded && p.onGround) {
      send({ type:'action', kind:'land' });
    }
    lastGrounded = !!p.onGround;
    const weapon = game.weapons?.current || 'knife';
    lastSentWeapon = weapon;
  }

  setInterval(() => {
    publishGameState();
    syncRemoteModels();
  }, 50);

  function secondsRemaining() {
    if (!matchState) return 0;
    if (matchState.phase === 'waiting') return matchState.roundSeconds || 600;
    return Math.max(0, (matchDeadline - performance.now()) / 1000);
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function clearMatch() {
    matchState = null;
    matchDeadline = 0;
    isReady = false;
    lastPhaseSignature = '';
    $('mpClock').textContent = '—:——';
    $('mpCT').textContent = 'CT 0';
    $('mpT').textContent = '0 T';
    $('mpPhase').textContent = 'Waiting for match state';
  }

  function markReady(ready) {
    if (!joinedRoom || socket?.readyState !== WebSocket.OPEN || isReady === ready) return;
    isReady = ready;
    send({ type: 'ready', ready });
  }

  function lockNativeRoundLogic(game) {
    if (activeGame === game && game.__clutcherMpClockLocked) return;
    if (activeGame && activeGame !== game) releaseNativeRoundLogic();
    if (!game || game.state !== 'playing') return;
    if (!game.__clutcherMpClockLocked) {
      game.__clutcherMpClockLocked = {
        startRound: game.startRound,
        endRound: game.endRound,
        modeCtl: game.modeCtl,
        modeUpdate: game.modeCtl?.update,
        modeRoundEnd: game.modeCtl?.roundEnd,
        modeNextRound: game.modeCtl?.nextRound,
        modeMatchEnd: game.modeCtl?.matchEnd,
        modeOnKill: game.modeCtl?.onKill
      };
      // The Node server owns round transitions. The native local game must
      // not decide a winner because no enemy bots remain on either side.
      game.startRound = function () {};
      game.endRound = function () {};
      if (game.modeCtl) {
        game.modeCtl.update = function () {};
        game.modeCtl.roundEnd = function () {};
        game.modeCtl.nextRound = function () {};
        game.modeCtl.matchEnd = function () {};
        game.modeCtl.onKill = function () {};
      }
    }
    game.roundActive = true;
    activeGame = game;
  }

  function releaseNativeRoundLogic() {
    const game = activeGame;
    if (!game) return;
    const native = game.__clutcherMpClockLocked;
    if (native) {
      game.startRound = native.startRound;
      game.endRound = native.endRound;
      if (native.modeCtl) {
        native.modeCtl.update = native.modeUpdate;
        native.modeCtl.roundEnd = native.modeRoundEnd;
        native.modeCtl.nextRound = native.modeNextRound;
        native.modeCtl.matchEnd = native.modeMatchEnd;
        native.modeCtl.onKill = native.modeOnKill;
      }
      delete game.__clutcherMpClockLocked;
    }
    activeGame = null;
  }

  function applyMatchState(message) {
    if (!joinedRoom || message.room !== joinedRoom) return;
    if (!['waiting','countdown','live','ended','match_end'].includes(message.phase)) return;
    if (!message.score || !Number.isFinite(message.remainingMs) ||
        !Number.isFinite(message.round) || !Number.isFinite(message.roundSeconds) ||
        !Number.isFinite(message.score.CT) || !Number.isFinite(message.score.T)) return;

    // A new server message corrects drift; between broadcasts, use the local
    // monotonic timer. No local client is allowed to set a score.
    const previousRevision = matchState?.revision;
    const previousRound = matchState?.round;
    const previousPhase = matchState?.phase;
    matchState = message;
    // Native Defusal round logic is intentionally suspended, so honor the
    // server's next-round spawn transition here instead of locally advancing.
    const game = gameInstance();
    if (game?.state === 'playing') {
      const newDefusalRound = assignedMode === 'defusal' &&
        message.phase === 'countdown' &&
        (message.round !== previousRound || previousPhase === 'match_end') &&
        previousPhase && previousPhase !== 'waiting';
      const newDmMatch = assignedMode === 'dm' &&
        previousPhase === 'ended' && message.phase === 'live';
      if (newDefusalRound || newDmMatch) {
        try {
          game.respawnPlayer?.();
          game.hud?.hideDeath?.();
          game.hud?.updateHealth?.();
        } catch (error) {
          console.warn('[Clutcher MP] Server round spawn failed:', error);
        }
      }
    }
    matchDeadline = performance.now() + Math.max(0, message.remainingMs);
    const phaseSignature = message.phase + ':' + message.round + ':' +
      message.score.CT + ':' + message.score.T;
    $('mpCT').textContent = 'CT ' + message.score.CT;
    $('mpT').textContent = message.score.T + ' T';
    $('mpPhase').textContent = message.phase.toUpperCase() +
      (assignedMode === 'defusal' ? ' • Round ' + message.round + '/' + (message.maxRounds || 15)
        : ' • Team Deathmatch') +
      (message.phase === 'waiting' ? ' • waiting for a loaded player on each side' :
      message.phase === 'ended' && message.winner ? ' • ' + message.winner + ' wins' : '');
    if (phaseSignature !== lastPhaseSignature ||
        previousRevision !== message.revision || previousRound !== message.round) {
      lastNativeHudAt = 0;
      lastPhaseSignature = phaseSignature;
    }
    updateMatchPresentation();
  }

  function updateMatchPresentation() {
    if (!matchState) return;
    const time = secondsRemaining();
    $('mpClock').textContent = formatClock(time);
    const game = gameInstance();
    if (!game || game.state !== 'playing' || !joinedRoom) {
      if (isReady && joinedRoom) markReady(false);
      if (activeGame) releaseNativeRoundLogic();
      return;
    }

    lockNativeRoundLogic(game);
    // Sync both the universal HUD timer and Defusal's native round controller.
    game.roundActive = true;
    game.roundTimeLeft = time;
    game.frozen = matchState.phase === 'waiting' || matchState.phase === 'countdown';
    game.respawnAllowed = assignedMode === 'dm';

    const ctl = game.modeCtl;
    if (assignedMode === 'defusal' && ctl) {
      ctl.score ||= { CT: 0, T: 0 };
      ctl.score.CT = matchState.score.CT;
      ctl.score.T = matchState.score.T;
      ctl.roundNum = matchState.round;
      ctl.roundClock = time;
      ctl.freezeT = matchState.phase === 'countdown' ? time : 0;
      ctl.endT = ['ended', 'match_end'].includes(matchState.phase) ? time : 0;
      ctl._endClock = ctl.endT;
      ctl.state = ['countdown', 'waiting'].includes(matchState.phase)
        ? 'freeze' : matchState.phase === 'match_end' ? 'match_end' :
          matchState.phase === 'ended' ? 'end' : 'live';
    }

    // Not every native HUD mode exposes team scores yet, so maintain the
    // authoritative scoreboard in our panel as a reliable fallback.
    const now = performance.now();
    if (now - lastNativeHudAt >= 250) {
      lastNativeHudAt = now;
      try { game.hud?.updateScorebar?.(); } catch (error) {
        console.debug('[Clutcher MP] Native scorebar update skipped:', error);
      }
    }
  }

  // Local presentation ticks do not advance score or game phases.
  setInterval(updateMatchPresentation, 100);

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
      lockNativeRoundLogic(game);
      installActionHooks(game);
      markReady(true);
      updateMatchPresentation();
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
    clearMatch();
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
          else if (gameInstance()?.state === 'playing') {
            lockNativeRoundLogic(gameInstance());
            markReady(true);
          }
          break;
        case 'match_state':
          applyMatchState(message);
          break;
        case 'snapshot':
          if (message.room !== joinedRoom || !Array.isArray(message.players)) break;
          players = message.players.filter((p) =>
            typeof p.id === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y)
          ).slice(0, 16);
          updateStats();
          syncRemoteModels();
          draw();
          break;
        case 'player_action':
          remoteAction(message);
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
      clearRemoteModels();
      clearMatch();
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
    clearRemoteModels();
    clearMatch();
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
    clearMatch();
    clearRemoteModels();
    releaseNativeRoundLogic();
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
