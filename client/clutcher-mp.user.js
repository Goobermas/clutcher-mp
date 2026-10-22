// ==UserScript==
// @name         Clutcher MP - Multiplayer Bridge
// @namespace    https://sillyhack.com/
// @version      0.6.0
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
  const localProjectiles=new Map();
  const remoteProjectiles=new Map();
  let grenadeSerial=0;
  let previousGrenadeManager=null;
  let lastObjectivePulse=0;
  let lastBombSignature=null;

  const deferredActions = new Map();
  let remoteConstructor = null;
  let lastGrounded = true;
  let lastAlive = null;
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




  // Copy only visual item metadata; avoid transmitting an entire inventory.
  function localAppearance(game) {
    const weapon = game?.weapons?.current || 'knife';
    const state = game?.weapons?.states?.[weapon] || {};
    let finish = null;
    let gloves = null;
    try { finish = game._carriedFinish?.(weapon, state) || null; } catch {}
    try { gloves = game._ownGloves?.() || null; } catch {}
    const item = finish?.item && typeof finish.item === 'object'
      ? { wear: Number(finish.item.wear) || 0, seed: Number(finish.item.seed) || 0 }
      : null;
    const gloveItem = gloves?.item;
    return {
      weapon,
      skin: finish?.skin || null,
      skinItem: item,
      gloves: gloves?.model ? {
        model: String(gloves.model).slice(0, 160),
        kit: gloves.kit ?? null,
        item: {
          wear: Number(gloveItem?.wear) || 0,
          seed: Number(gloveItem?.seed) || 0
        }
      } : null
    };
  }

  function cosmeticKey(data) {
    try { return JSON.stringify([
      data?.weapon || null, data?.skin || null, data?.skinItem || null, data?.gloves || null
    ]); } catch { return String(data?.weapon || ''); }
  }

  // Override native cosmetic selection ONLY for our remote human actors.
  function installCosmeticHooks(game) {
    if (!game || game.__clutcherMpCosmetics) return;
    game.__clutcherMpCosmetics = true;
    for (const [method, remoteValue] of [
      ['_botSkin', bot => bot._mpSkin],
      ['_botSkinName', bot => bot._mpSkin?.name || null],
      ['_botGloves', bot => bot._mpGloves]
    ]) {
      const original = game[method];
      if (typeof original !== 'function') continue;
      game[method] = function(bot) {
        if (bot?._clutcherMpRemote) return remoteValue(bot) ?? null;
        return original.apply(this, arguments);
      };
    }
  }

  function applyKnifeModel(bot, state) {
    const model = state?.weapon === 'knife' ? String(state.skin?.weapon || '') : '';
    if (!/^knife_[a-z0-9_]{1,40}$/i.test(model) ||
        ['knife_ct', 'knife_t'].includes(model)) {
      bot._mpAppliedKnife = null;
      return;
    }
    const signature = cosmeticKey(state);
    if (bot._mpAppliedKnife === signature) return;
    const agent = bot.cs2Agent;
    if (!agent?.setWeapon) return;
    const paint = state.skin?.kit ? {
      kit: state.skin.kit,
      item: {
        wear: Number(state.skinItem?.wear ?? state.skin?.wmin) || 0,
        seed: Number(state.skinItem?.seed ?? state.skin?.seed) || 0
      }
    } : null;
    try {
      const result = agent.setWeapon(model, 'knife', paint);
      const nativeId = bot.team === 'T' ? 'knife_t' : 'knife_ct';
      const preserveNativeId = () => {
        if (bot._networkTarget?.weapon === 'knife' && bot.cs2Agent === agent) {
          // Native bot update compares this bookkeeping id every frame.
          agent._weaponId = nativeId;
        }
      };
      preserveNativeId();
      result?.then?.(preserveNativeId)?.catch?.(() => { bot._mpAppliedKnife = null; });
      bot._mpAppliedKnife = signature;
    } catch (error) {
      console.debug('[Clutcher MP] Custom remote knife not available:', error);
    }
  }

  function applyRemoteCosmetics(bot, data) {
    if (!bot || !data) return;
    const signature = cosmeticKey(data);
    if (bot._mpAppearanceKey !== signature) {
      bot._mpAppearanceKey = signature;
      bot._mpSkin = data.skin || null;
      bot._mpSkinItem = data.skinItem || null;
      if (bot._mpSkin && bot._mpSkinItem) {
        bot._mpSkin = {
          ...bot._mpSkin,
          wmin: Number(bot._mpSkinItem.wear) || 0,
          seed: Number(bot._mpSkinItem.seed) || 0
        };
      }
      bot._mpGloves = data.gloves || null;
      bot._mpAppliedKnife = null;
      // Rebuild the held model when the same gun switches finish/wear/seed.
      if (bot.cs2Agent) bot.cs2Agent._weaponId = null;
    }
    if (bot.cs2Agent?.setGloves && bot._mpGlovesKey !== cosmeticKey({gloves:data.gloves})) {
      bot._mpGlovesKey = cosmeticKey({gloves:data.gloves});
      try {
        const gloves = bot._mpGloves;
        const result = bot.cs2Agent.setGloves(gloves?.model || null,
          gloves ? {kit:gloves.kit, item:gloves.item} : null,
          {size:512});
        result?.catch?.(() => { bot._mpGlovesKey = null; });
      } catch { bot._mpGlovesKey = null; }
    }
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
    deferredActions.delete(id);
  }

  function clearRemoteModels() {
    for (const id of [...remoteModels.keys()]) removeRemoteModel(id);
    remoteConstructor = null;
    deferredActions.clear();
  }

  function makeRemoteModel(player) {
    const game = gameInstance();
    const state = player.game;
    if (!game || game.state !== 'playing' || !game.botMgr ||
        !state || player.id === playerId) return null;
    const Bot = discoverRemoteConstructor(game);
    if (!Bot) return null;
    installCosmeticHooks(game);
    try {
      const bot = new Bot(game, player.team === 'CT' ? 'CT' : 'T', state.name || 'Player', 3);
      bot._clutcherMpRemote = player.id;
      bot._networkTarget = state;
      bot.target = { multiplayer: true };
      bot._mpAppearanceKey = null;
      bot._mpGlovesKey = null;
      bot._mpAppliedKnife = null;
      applyRemoteCosmetics(bot, state);
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
        playDeferredActions(this);
        animateRemoteReloadFallback(this);
        applyKnifeModel(this, next);
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
      applyRemoteCosmetics(model, data);
      // Recover if the one-shot reload packet arrived before this model's
      // animation rig. Do not restart the clip on every 20 Hz snapshot.
      if (data.reloading && !model._mpReloading && model.cs2Agent?.loco) {
        remoteAction({id:player.id,kind:'reload',weapon:data.weapon,
          duration:2.5,empty:false},false);
      } else if (!data.reloading) {
        model._mpReloading = false;
      }
      if (data.alive && !model.alive) {
        model.alive = true;
        model.health = 100;
        model.cs2Agent?.revive?.();
        if (model.cs2Agent?.root) model.cs2Agent.root.visible = true;
        if (model.shadow) model.shadow.visible = true;
      } else if (!data.alive && model.alive) {
        // Preserve the native death clip/ragdoll instead of deleting the model.
        try { model.die?.('chest', false, null); }
        catch { model.alive = false; }
      } else if (data.alive && model.cs2Agent?.root) {
        model.cs2Agent.root.visible = true;
      }
    }
    for (const id of [...remoteModels.keys()]) {
      if (!seen.has(id)) removeRemoteModel(id);
    }
  }



  // Visible reload fallback only for third-person assets lacking a reload clip.
  // Local inspect stays entirely native; it is never networked.
  function stopRemoteReloadFallback(bot) {
    const pose = bot?._mpReloadPose;
    if (!pose) return;
    if (pose.mesh) {
      pose.mesh.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
      pose.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    }
    bot._mpReloadPose = null;
  }

  function startRemoteReloadFallback(bot, duration) {
    const mesh = bot?.cs2Agent?.heldWeapon;
    if (!mesh?.rotation || !mesh?.position) return false;
    stopRemoteReloadFallback(bot);
    bot._mpReloadPose = {
      mesh, start: performance.now(),
      duration: Math.min(15000, Math.max(600, Number(duration || 2.5) * 1000)),
      rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
    };
    return true;
  }

  function animateRemoteReloadFallback(bot) {
    const pose = bot._mpReloadPose;
    if (!pose) return;
    if (bot.cs2Agent?.heldWeapon !== pose.mesh) {
      stopRemoteReloadFallback(bot);
      return;
    }
    const t = Math.max(0, Math.min(1, (performance.now() - pose.start) / pose.duration));
    if (t >= 1 || !bot.alive) {
      stopRemoteReloadFallback(bot);
      return;
    }
    const tilt = Math.sin(Math.PI * t);
    pose.mesh.rotation.x = pose.rotation.x + tilt * .27;
    pose.mesh.rotation.y = pose.rotation.y - tilt * .16;
    pose.mesh.rotation.z = pose.rotation.z - tilt * .35;
    pose.mesh.position.y = pose.position.y - tilt * .11;
  }

  function deferRemoteAction(bot, message) {
    const list = deferredActions.get(message.id) || [];
    list.push({message, expiration:performance.now()+2000});
    if (list.length > 10) list.shift();
    deferredActions.set(message.id,list);
  }

  function playDeferredActions(bot) {
    if (!bot?._clutcherMpRemote) return;
    const list = deferredActions.get(bot._clutcherMpRemote);
    if (!list?.length) return;
    const live = list.filter(item => item.expiration > performance.now());
    if (!live.length) {
      deferredActions.delete(bot._clutcherMpRemote);
      return;
    }
    // Rig and held weapon are loaded asynchronously by the game.
    if (!bot.cs2Agent?.loco || !bot.cs2Agent?.heldWeapon) {
      deferredActions.set(bot._clutcherMpRemote, live);
      return;
    }
    deferredActions.delete(bot._clutcherMpRemote);
    for (const item of live) remoteAction(item.message, false);
  }

  function remoteAction(message, allowDeferred = true) {
    const bot = remoteModels.get(message.id);
    const game = gameInstance();
    if (!game) return;
    if ((!bot || !bot.cs2Agent?.loco || !bot.cs2Agent?.heldWeapon) &&
        allowDeferred && ['reload','equip'].includes(message.kind)) {
      deferRemoteAction(bot, message);
      return;
    }
    if (!bot) return;
    try {
      if (message.kind === 'spawn') {
        bot.alive = true;
        bot.health = 100;
        bot.cs2Agent?.revive?.();
        return;
      }
      if (message.kind === 'death') {
        if (bot.alive) bot.die?.('chest', false, null);
        return;
      }
      if (!bot.alive) return;
      const agent = bot.cs2Agent;
      switch (message.kind) {
        case 'fire': {
          agent?.shoot?.(message.weapon || bot.weapon);
          const sound = 'shot_' + (message.weapon || bot.weapon);
          game.audio?.play?.(sound, { pos: bot });
          if (message.dir?.length === 3) {
            const [dx, dy, dz] = message.dir;
            const height = bot.y + (bot.crouchT ? 1.1 : 1.6);
            game.effects?.tracer?.(bot.x, height, bot.z,
              bot.x + dx * 35, height + dy * 35, bot.z + dz * 35,
              'rifle', bot.weapon);
          }
          break;
        }
        case 'reload': {
          // This game's bot renderer keys reload clips by the actual
          // third-person weapon ID, not by first-person inventory name.
          const weaponId = agent?._weaponId || message.weapon || bot.weapon;
          const result = agent?.reload?.(weaponId, message.duration || 2.5, {
            empty: !!message.empty, crouched: !!bot.crouchT
          });
          const fallback = result ? false : startRemoteReloadFallback(bot,message.duration);
          bot._mpReloading = !!(result || fallback);
          bot._mpLastReloadAt = performance.now();
          if (!result) {
            console.debug('[Clutcher MP] No native reload clip for',weaponId,
              fallback ? '— procedural fallback active' : '— model pending');
          }
          break;
        }
        case 'knife':
          agent?.knifeAttack?.(message.heavy ? 'stab' : 'swing');
          game.audio?.play?.(message.heavy ? 'knife_swing_heavy' : 'knife_swing',
            {pos:bot});
          break;
        case 'equip':
          agent?.draw?.(bot.weapon, {crouched:!!bot.crouchT});
          break;
        case 'weapon_sound':
          if (['clipout','clipin','bolt','draw','toss'].includes(message.sound)) {
            game.audio?.playWeapon?.(message.sound, message.weapon || bot.weapon, {pos:bot});
          } else if (message.sound) {
            game.audio?.play?.(message.sound, {pos:bot});
          }
          break;
        case 'step':
          game.audio?.play?.(message.sound || 'step', {pos:bot});
          break;
        case 'jump':
          game.audio?.play?.('gear_small', {pos:bot,vol:0.5});
          break;
        case 'land':
          game.audio?.play?.('land', {pos:bot});
          break;
        case 'grenade_prep':
          agent?.throwGrenade?.({crouched:!!bot.crouchT});
          break;
        case 'grenade_throw':
          agent?.throwGrenade?.({crouched:!!bot.crouchT});
          game.audio?.play?.('prethrow_gear', {pos:bot});
          break;
        case 'scope':
          bot._networkTarget = {...bot._networkTarget,scoped:!!message.scoped};
          break;
        case 'crouch':
          bot.crouchT = bot._networkTarget?.crouch ? 0.1 : 0;
          break;
      }
    } catch (error) {
      console.debug('[Clutcher MP] Remote visual action unsupported:', message.kind, error);
    }
  }

  function sendVisualAction(kind, fields = {}) {
    if (!isReady || socket?.readyState !== WebSocket.OPEN ||
        gameInstance()?.state !== 'playing') return;
    send({type:'action', kind, ...fields});
  }

  function installActionHooks(game) {
    if (!game) return;
    const oldHooks = game.__clutcherMpHookRefs;
    if (oldHooks?.weapons === game.weapons &&
        oldHooks?.viewmodel === game.viewmodel &&
        oldHooks?.audio === game.audio) return;
    game.__clutcherMpHookRefs = {
      weapons:game.weapons,viewmodel:game.viewmodel,audio:game.audio
    };
    game.__clutcherMpActions = true;
    installCosmeticHooks(game);

    function wrap(obj, method, listener, after = false) {
      if (typeof obj?.[method] !== 'function' || obj[method].__mpActionWrapped) return;
      const original = obj[method];
      const hooked = function(...args) {
        const observe = () => {
          try { listener(args, this); } catch (error) {
            console.debug('[Clutcher MP] Action observation:', method, error);
          }
        };
        if (!after) observe();
        const result = original.apply(this, args);
        if (after) observe();
        return result;
      };
      hooked.__mpActionWrapped = true;
      obj[method] = hooked;
    }

    wrap(game, 'fireBullet', ([shooter, x, y, z, dx, dy, dz]) => {
      if (shooter !== game.player || ![dx,dy,dz].every(Number.isFinite)) return;
      const n = Math.hypot(dx,dy,dz) || 1;
      sendVisualAction('fire', {
        weapon:game.weapons?.current || 'knife',
        dir:[dx/n,dy/n,dz/n]
      });
    });

    wrap(game.weapons, 'knifeAttack', ([heavy]) => {
      sendVisualAction('knife', {heavy:!!heavy});
    });

    // The game's actual reload entry point is weapons.startReload(), NOT
    // weapons.reload(). Observe after native logic confirms the reload.
    wrap(game.weapons, 'startReload', () => {
      const weapons = game.weapons;
      if (!weapons?.reloading) return;
      const def = weapons.def?.();
      const state = weapons.state?.();
      const per = Math.max(0.1, Number(def?.reload) || 2.5);
      const shells = def?.shellReload
        ? Math.max(1, Math.min(Number(def?.mag || 1) - Number(state?.ammo || 0),
          Number(state?.reserve || 1))) : 1;
      sendVisualAction('reload', {
        duration:Math.min(30,per*shells),
        empty:Number(state?.ammo) <= 0,
        weapon:weapons.current || 'knife'
      });
    }, true);

    wrap(game.weapons, 'setWeapon', ([weapon]) => {
      if (typeof weapon === 'string') sendVisualAction('equip', {weapon});
    });

    wrap(game.weapons, 'throwGrenade', () => {
      sendVisualAction('grenade_throw', {weapon:game.weapons?.current || 'knife'});
    });

    wrap(game.weapons, 'setScope', ([level]) => {
      sendVisualAction('scope', {scoped:Number(level) > 0});
    });

    if (typeof game.dealDamage === 'function') {
      const original = game.dealDamage;
      game.dealDamage = function(target) {
        // Real network players must never take speculative local bot damage.
        if (target?._clutcherMpRemote) return;
        return original.apply(this, arguments);
      };
    }

    const audio = game.audio;
    if (audio && !audio.__clutcherMpAudioHook) {
      audio.__clutcherMpAudioHook = true;
      let localWeaponAudioDepth = 0;
      if (typeof audio.playWeapon === 'function') {
        const original = audio.playWeapon;
        audio.playWeapon = function(part, weapon, options) {
          const local = !options?.pos || options.pos === game.player;
          if (local && ['clipout','clipin','bolt','draw','toss'].includes(part)) {
            sendVisualAction('weapon_sound', {sound:part,weapon:weapon || game.weapons?.current});
          }
          localWeaponAudioDepth++;
          try { return original.apply(this, arguments); }
          finally { localWeaponAudioDepth--; }
        };
      }
      if (typeof audio.play === 'function') {
        const original = audio.play;
        audio.play = function(sound, options) {
          const local = !options?.pos || options.pos === game.player;
          if (local && typeof sound === 'string' && !localWeaponAudioDepth) {
            if (/^step(?:_[a-z]+)?$/.test(sound)) {
              sendVisualAction('step', {sound});
            } else if (sound === 'land') {
              sendVisualAction('land');
            } else if (/^(?:knife_draw(?:_t)?|gear_small)$/.test(sound)) {
              sendVisualAction('weapon_sound', {sound});
            }
          }
          return original.apply(this, arguments);
        };
      }
    }
  }


  const NADE_TYPES=new Set(['he','flash','smoke','molotov','incend','decoy']);

  function releaseRemoteProjectile(id) {
    const g=remoteProjectiles.get(id);
    if (!g) return;
    const mgr=gameInstance()?.grenadeMgr;
    const idx=mgr?.list?.indexOf(g) ?? -1;
    if (idx>=0) mgr.remove(idx);
    remoteProjectiles.delete(id);
  }

  function clearProjectiles() {
    for(const id of [...remoteProjectiles.keys()])releaseRemoteProjectile(id);
    localProjectiles.clear();
    remoteProjectiles.clear();
    lastBombSignature=null;
  }

  function ensureRemoteProjectile(data) {
    if (!data || !NADE_TYPES.has(data.grenade) || data.owner===playerId ||
        ![data.x,data.y,data.z,data.vx,data.vy,data.vz].every(Number.isFinite)) return;
    const game=gameInstance(),mgr=game?.grenadeMgr;
    if(!mgr?.throwFrom || game.state!=='playing') return;
    let g=remoteProjectiles.get(data.id);
    if (!g) {
      const owner={id:data.owner,team:data.team,_mpRemoteGrenadeOwner:true};
      const oldSize=mgr.list.length;
      try {
        // Load the authentic grenade model and flight audio through Clutcher.
        // The replicated projectile never executes its own collision physics.
        mgr.throwFrom(owner,data.grenade,data.x,data.y,data.z,0,0,-1,1);
      } catch(e) {
        console.warn('[Clutcher MP] Remote grenade model:',e);
        return;
      }
      g=mgr.list[oldSize];
      if(!g)return;
      g._mpRemote=data.id;
      g.owner=owner;
      remoteProjectiles.set(data.id,g);
    }
    Object.assign(g,{x:data.x,y:data.y,z:data.z,vx:data.vx,vy:data.vy,vz:data.vz,
      fuse:Number.isFinite(data.fuse)?data.fuse:g.fuse,
      spin:Number.isFinite(data.spin)?data.spin:g.spin});
    g.mesh?.position?.set?.(g.x,g.y-.04,g.z);
    if(g.mesh) {
      g.mesh.rotation.y=g.spin;
      g.mesh.rotation.x=g.spin*.7;
    }
    g.fly?.setPos?.(g.x,g.y,g.z);
  }

  function applyRemoteGrenadeEffect(message) {
    const game=gameInstance(),mgr=game?.grenadeMgr;
    if(!mgr)return;
    const known=remoteProjectiles.get(message.id);
    if(!known || !['flash','smoke','he','fire','decoy'].includes(message.effect))return;
    const owner=known.owner;
    releaseRemoteProjectile(message.id);
    const projectile={
      id:message.grenade,owner,
      x:message.x,y:message.y,z:message.z,
      def:{dmg:0.000001,range:8},done:false
    };
    try {
      const method={
        flash:'popFlash',smoke:'bloomSmoke',he:'explodeHE',fire:'igniteAt'
      }[message.effect];
      if(method)mgr[method]?.(projectile);
      // Flash uses native visibility/facing checks; smoke and fire use
      // native persistent particle/volume managers at the same coordinates.
    } catch(error) {
      console.warn('[Clutcher MP] Remote grenade effect:',error);
    }
  }

  function installGrenadeHooks(game) {
    const mgr=game?.grenadeMgr;
    if(!mgr || mgr===previousGrenadeManager)return;
    previousGrenadeManager=mgr;

    const nativeThrow=mgr.throwFrom;
    if(typeof nativeThrow==='function')mgr.throwFrom=function(owner,kind,...args) {
      const before=this.list.length;
      const result=nativeThrow.apply(this,arguments);
      const g=this.list[before];
      if (owner===game.player && g && NADE_TYPES.has(kind) && isReady) {
        const id=String(++grenadeSerial);
        g._mpLocal=id;
        localProjectiles.set(id,g);
        send({type:'grenade_throw',id,grenade:kind,x:g.x,y:g.y,z:g.z,
          vx:g.vx,vy:g.vy,vz:g.vz,fuse:g.fuse,spin:g.spin});
      }
      return result;
    };

    // Only the thrower's native Clutcher physics simulates bounces.
    // Receivers take its exact projectile samples instead of running
    // potentially divergent local physics and fuse timers.
    const nativeUpdate=mgr.update;
    if(typeof nativeUpdate==='function')mgr.update=function(dt) {
      const replica=this.list.filter(p=>p._mpRemote);
      if(!replica.length)return nativeUpdate.apply(this,arguments);
      this.list=this.list.filter(p=>!p._mpRemote);
      try {return nativeUpdate.apply(this,arguments);}
      finally {
        this.list.push(...replica);
        for(const g of replica) {
          g.mesh?.position?.set?.(g.x,g.y-.04,g.z);
          g.fly?.setPos?.(g.x,g.y,g.z);
        }
      }
    };

    for(const [method,effect] of [
      ['popFlash','flash'],['bloomSmoke','smoke'],
      ['igniteAt','fire'],['explodeHE','he']
    ]) {
      const native=mgr[method];
      if(typeof native!=='function')continue;
      mgr[method]=function(g) {
        if (g?._mpLocal && isReady) {
          send({type:'grenade_finish',id:g._mpLocal,effect,
            x:g.x,y:g.y,z:g.z});
          localProjectiles.delete(g._mpLocal);
        }
        return native.apply(this,arguments);
      };
    }
  }

  function publishGrenadePositions() {
    const game=gameInstance();
    if(!isReady || !joinedRoom || game?.state!=='playing')return;
    installGrenadeHooks(game);
    for(const [id,g] of localProjectiles) {
      if(!game.grenadeMgr.list.includes(g)) {
        localProjectiles.delete(id);
        continue;
      }
      send({type:'grenade_state',id,x:g.x,y:g.y,z:g.z,
        vx:g.vx,vy:g.vy,vz:g.vz,fuse:g.fuse,spin:g.spin});
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
    const appearance = localAppearance(game);
    send({
      type:'player_state', name,
      x:p.x, y:p.y, z:p.z,
      yaw:p.yaw, pitch:p.pitch, vx:p.vx, vz:p.vz,
      crouch:!!p.crouching, airborne:!p.onGround,
      alive:!!p.alive,
      ...appearance,
      scoped: !!game.weapons?.scopeLevel,
      reloading: !!game.weapons?.reloading,
      walking: !!game.input?.downA?.('walk'),
      firing: !!game.input?.mouse1,
      melee: appearance.weapon === 'knife' && !!game.input?.mouse1
    });
    if (lastAlive !== null && lastAlive !== !!p.alive) {
      sendVisualAction(p.alive ? 'spawn' : 'death');
    }
    lastAlive = !!p.alive;
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
    publishGrenadePositions();
    syncRemoteModels();
  }, 50);


  function updateObjectiveVisual(game,state) {
    if(!game || assignedMode!=='defusal' || !state?.objective || !game.modeCtl)return;
    const ctl=game.modeCtl, o=state.objective, p=game.player;
    // Only the server can assign the bomb carrier.
    ctl.carrier=o.carrier===playerId ? p : remoteModels.get(o.carrier) || null;
    if(o.carrier===playerId && p.team==='T' && state.phase!=='ended') {
      if(game.weapons?.slots && game.weapons.slots[5]!=='c4') {
        game.weapons.slots[5]='c4';
        game.weapons.states.c4 ||= {ammo:1,reserve:0};
        game.hud?.updateWeapon?.();
      }
    } else if(game.weapons?.slots?.[5]==='c4' && !o.placed) {
      game.weapons.slots[5]=null;
      if(game.weapons.current==='c4')game.weapons.equip?.('knife');
      game.hud?.updateWeapon?.();
    }

    ctl.plantProgress=o.planter===playerId?o.plantProgress||0:0;
    ctl.defuseProgress=o.defuser===playerId?o.defuseProgress||0:0;
    ctl.defuser=o.defuser===playerId?p:remoteModels.get(o.defuser)||null;
    const planting=ctl.plantProgress>0;
    const defusing=ctl.defuseProgress>0;
    if(game.viewmodel)game.viewmodel.action=planting?'plant':defusing?'defuse':null;
    if(p)p.forceCrouch=planting||defusing;
    if(planting) {
      if(game.weapons?.current!=='c4' && game.weapons?.slots?.[5]==='c4')
        game.weapons.equip?.('c4');
      const cs2=game.cs2;
      if(cs2?.has?.('plant') && cs2?.playTimed &&
          cs2.rig?.current?.getClip?.()?.name!=='plant') {
        cs2.playTimed('plant',Math.max(.25,3.2*(1-ctl.plantProgress)),
          {fade:.05,idleAfter:'idle'});
      }
    }

    const placed=o.placed;
    const signature=placed ? [placed.at,placed.by,placed.site].join(':') : null;
    if(placed && signature!==lastBombSignature) {
      if(ctl.planted?.mesh)game.scene?.remove?.(ctl.planted.mesh);
      ctl.planted=null;
      // Native _tossBomb creates the game's own world C4 mesh. Unlike
      // ctl.plant(), it does not award client money or decide the round.
      try {
        ctl._tossBomb?.(placed.x,placed.y+.02,placed.z,0,0,null);
        const visual=ctl.dropped;
        if(visual?.mesh) {
          visual.mesh.position?.set?.(placed.x,placed.y+.02,placed.z);
          ctl.bombMesh=visual.mesh;
          ctl.planted={...placed,mesh:visual.mesh};
          ctl.dropped=null;
        }
        game.audio?.play?.('planted',{pos:placed});
        game.hud?.announce?.('Bomb planted at '+placed.site,2300);
      } catch(error) {console.warn('[Clutcher MP] C4 visual:',error);}
      lastBombSignature=signature;
    } else if(!placed && lastBombSignature) {
      try { ctl.cleanupBomb?.(); } catch {}
      lastBombSignature=null;
    }
    if(placed) {
      ctl.state=state.phase==='planted'?'planted':ctl.state;
      ctl.bombT=state.phase==='planted'?secondsRemaining():0;
      if(ctl.planted && ctl.bombMesh)
        ctl.bombMesh.position?.set?.(placed.x,placed.y+.02,placed.z);
    }
  }

  function pulseObjective() {
    const game=gameInstance(),p=game?.player,ctl=game?.modeCtl;
    if(!isReady || assignedMode!=='defusal' ||
        game?.state!=='playing' || !p?.alive || !ctl || !matchState)return;
    const o=matchState.objective;
    if(!o)return;
    const use=!!(game.input?.downA?.('use') || ctl.useHeld);
    const plantClick=game.weapons?.current==='c4' &&
      !!(game.input?.mouse1 || ctl.plantHeld);
    if(matchState.phase==='live' && p.team==='T' && o.carrier===playerId &&
        (use||plantClick) && ctl.inSite?.(p) && p.onGround &&
        Math.hypot(p.vx,p.vz)<.35) {
      send({type:'objective_intent',kind:'plant'});
    } else if(matchState.phase==='planted' && p.team==='CT' && use &&
        o.placed && p.onGround && Math.hypot(p.vx,p.vz)<.35 &&
        Math.hypot(p.x-o.placed.x,p.z-o.placed.z)<1.8) {
      send({type:'objective_intent',kind:'defuse'});
    }
  }

  setInterval(pulseObjective,100);

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
        case 'grenade_snapshot':
          if(Array.isArray(message.projectiles))
            for(const projectile of message.projectiles)ensureRemoteProjectile(projectile);
          break;
        case 'grenade_spawn':
        case 'grenade_state':
          ensureRemoteProjectile(message.type==='grenade_state'
            ? {...message,...(remoteProjectiles.get(message.id)
              ? {grenade:remoteProjectiles.get(message.id).id,
                 owner:remoteProjectiles.get(message.id).owner?.id,
                 team:remoteProjectiles.get(message.id).owner?.team}
              : {})} : message);
          break;
        case 'grenade_effect':
          applyRemoteGrenadeEffect(message);
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
      clearProjectiles();
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
    clearProjectiles();
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
    // In a loaded match, show real map X/Z rather than the 2D canvas-test coordinates.
    const centerX = self?.game?.x ?? self?.x ?? 0;
    const centerY = self?.game?.z ?? self?.y ?? 0;
    ctx.font = '10px system-ui';
    for (const player of players) {
      const x = canvas.width / 2 + ((player.game?.x ?? player.x) - centerX) * 0.45;
      const y = canvas.height / 2 + ((player.game?.z ?? player.y) - centerY) * 0.45;
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
