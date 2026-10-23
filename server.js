'use strict';
/**
 * Last Card — game server.
 * TV-as-the-host, phone-as-the-controller. The server is the single source of truth.
 *
 * Start:  node server.js        (or double-click start.bat on Windows)
 * TV:     http://localhost:3000/tv.html
 * Phones: scan the QR code on the TV
 *
 * Works in two places with no settings to change:
 *   - On a laptop: the QR code points at the laptop's Wi-Fi address.
 *   - Online (e.g. Render): the QR code points at the website address the TV opened.
 * Optional: set PUBLIC_URL (e.g. https://last-card.onrender.com) to force the address.
 */
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { LastCardGame, COLORS, ALL_COLORS, face } = require('./game/lastcard');
const { MODES, BOT_LEVELS, TEAMS, SIGNALS, MATCH_TYPES, MATCH_TARGET, getMode } = require('./game/modes');
const { BOTS, decide, thinkTime, decideFrenzy, reactTime } = require('./game/bots');
const { createStore } = require('./game/persistence');

const PORT = Number(process.env.PORT) || 3000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const AWAY_TIMEOUT_MS = 20000; // auto-skip a disconnected player's turn after this
const ROOM_IDLE_MS = 30 * 60 * 1000; // delete rooms nobody has touched for 30 minutes
const MAX_SOLO_BOTS = 5;
// Hot Potato timing. FUSE_SPEED (tests only) shrinks every clock.
const HOT_SPEED = Number(process.env.FUSE_SPEED) || 1;
const FUSE_MIN_MS = 20000 * HOT_SPEED;
const FUSE_MAX_MS = 60000 * HOT_SPEED;
const TURN_MS = 5000 * HOT_SPEED;
const STALL_MS = 7000 * HOT_SPEED; // Frenzy: if nobody plays for this long, a card comes off the deck
const AVATARS = ['ace', 'blaze', 'sunny', 'atlas', 'velvet', 'cipher', 'zara', 'bingo', 'willow', 'jinx', 'riff', 'luna', 'dash', 'mirage', 'pixel', 'maple'];
const LEGACY_AVATARS = Object.freeze({akari:'ace',chibi:'sunny',dusk:'atlas',ember:'velvet',frost:'cipher',glimmer:'zara',halo:'bingo',iris:'willow',kitsu:'riff',nova:'dash',onyx:'mirage',sora:'maple'});
const normaliseAvatar = value => { const id = LEGACY_AVATARS[value] || value; return AVATARS.includes(id) ? id : AVATARS[0]; };
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

// ---------- network address shown in the QR code ----------
function lanAddress() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const skip = /(vethernet|virtualbox|vmware|docker|wsl|hyper-v|loopback|tailscale|zerotier|vpn)/i;
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = 0;
      if (a.address.startsWith('192.168.')) score = 3;
      else if (a.address.startsWith('10.')) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score = 1;
      if (/wi-?fi|wlan|wireless/i.test(name)) score += 1;
      candidates.push({ address: a.address, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  return candidates.length ? candidates[0].address : null;
}

/**
 * Work out the address phones should use, from the address the TV page was opened on.
 * localhost means "this laptop", so swap in its Wi-Fi address. Anything else is a real
 * website address (hosted online, or the laptop's own IP) and is used as-is.
 */
function publicBase(handshake) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.trim().replace(/\/+$/, '');
  const h = handshake.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    const ip = lanAddress();
    return ip ? `http://${ip}:${PORT}` : null;
  }
  const proto = String(h['x-forwarded-proto'] || (handshake.secure ? 'https' : 'http')).split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

// ---------- rooms ----------
/** @type {Map<string, Room>} */
const rooms = new Map();
// Opt-in durable single-host storage. Set STATE_DIR to a persistent disk mount.
const roomStore = createStore(process.env.STATE_DIR);
const saveRooms = () => roomStore?.save(rooms);

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const token = () => crypto.randomBytes(12).toString('hex');
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);

class Room {
  /** @param {string|null} base e.g. "http://192.168.1.20:3000" or "https://last-card.onrender.com" */
  constructor(io, base) {
    this.io = io;
    this.code = newCode();
    this.hostToken = token();
    this.players = []; // { id, name, avatar, socketId, connected, wins }
    this.game = null;
    this.round = 0;
    this.touched = Date.now();
    this.awayTimer = null;
    this.awayTurn = -1;
    this.hostLabel = base ? base.replace(/^https?:\/\//, '') : null;
    this.joinUrl = `${base || `http://localhost:${PORT}`}/j/${this.code}`;
    this.qrSvg = '';
    this.mode = 'classic';
    this.botLevel = 'medium';
    this.tvless = false; // phone-only Solo game with no TV attached
    this.botTimer = null;
    this.botKey = null;
    this.catchBotTimer = null;
    this.catchBotKey = null;
    this.teamSize = 2; // Tag Team: 2 or 3 players per team
    // Hot Potato clocks
    this.fuseTimer = null; this.fuseKey = null; this.fuseLitAt = 0;
    this.turnTimer = null; this.turnKey = null; this.turnDeadline = 0;
    // Match Play
    this.matchType = 'single';
    this.matchOver = false;
    this.championId = null;
    this.lastResult = null; // { gains: {id: points}, knocked: [ids] }
    this.scoredRound = 0;
    // Frenzy: one reaction timer per computer player, plus the stall breaker
    this.frenzyBots = new Map(); // id -> { timer, key }
    this.stallTimer = null; this.stallKey = null;
  }

  get tvChannel() { return `tv:${this.code}`; }
  get humans() { return this.players.filter((p) => !p.isBot); }
  get bots() { return this.players.filter((p) => p.isBot); }
  get leader() { return this.humans.find((p) => p.connected) || this.humans[0] || null; }
  get phase() { return this.game ? this.game.phase : 'lobby'; }
  player(id) { return this.players.find((p) => p.id === id); }

  async init() {
    this.qrSvg = await QRCode.toString(this.joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#09090b', light: '#ffffff' } });
    return this;
  }

  startRound() {
    if (this.matchOver) this.resetMatch();
    const seats = this.players.filter((p) => p.connected && !p.out);
    const humans = seats.filter((p) => !p.isBot);
    if (getMode(this.mode).solo) {
      if (humans.length !== 1) return { ok: false, error: 'Solo is for one player. Remove the others, or switch to Classic.' };
      if (!this.bots.length) return { ok: false, error: 'Add at least one computer player.' };
    }
    if (!humans.length) return { ok: false, error: 'At least one person needs to be playing.' };
    if (seats.length < MIN_PLAYERS) return { ok: false, error: `You need at least ${MIN_PLAYERS} players. Add a computer player to make up the numbers.` };
    let order = seats;
    let options = { mode: this.mode };
    if (getMode(this.mode).teams) {
      const problem = this.teamProblem(seats.length);
      if (problem) return { ok: false, error: problem };
      // Random teams, seated so partners never sit together: A B C A B C …
      order = [...seats];
      for (let i = order.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      const nTeams = seats.length / this.teamSize;
      const teams = Object.fromEntries(order.map((p, i) => [p.id, i % nTeams])); // seat i is on team i % nTeams
      options = { ...options, teams, teamNames: TEAMS.slice(0, nTeams).map((t) => t.name) };
    }
    this.clearBot();
    this.clearHot();
    this.clearFrenzy();
    this.lastResult = null;
    this.game = new LastCardGame(order.map((p) => ({ id: p.id, name: p.name })), options);
    this.round++;
    return { ok: true };
  }

  /** Tag Team: why this number of players can't be split into teams, or null if it can. */
  teamProblem(n) {
    const size = this.teamSize;
    if (n < size * 2) return `Tag Team needs at least ${size * 2} players for teams of ${size}. Add computer players to make up the numbers.`;
    if (n % size) return `${n} players can't split into teams of ${size}. Add or remove ${size === 2 ? 'one player' : 'a player or two'}, or change the team size.`;
    if (n / size > TEAMS.length) return 'That makes too many teams. Try teams of 3.';
    return null;
  }

  setTeamSize(n) {
    if (this.phase === 'playing') return { ok: false, error: 'Change teams between rounds.' };
    if (![2, 3].includes(Number(n))) return { ok: false, error: 'Teams are 2 or 3 players.' };
    this.teamSize = Number(n);
    return { ok: true };
  }

  // ---------- modes and computer players ----------
  setMode(id) {
    const mode = MODES.find((m) => m.id === id);
    if (!mode) return { ok: false, error: 'Unknown game.' };
    if (!mode.ready) return { ok: false, error: `${mode.name} is coming soon.` };
    if (this.phase === 'playing') return { ok: false, error: 'Finish this round before changing the game.' };
    if (this.tvless && !mode.solo) return { ok: false, error: 'Connect a TV to play other games.' };
    if (mode.solo && this.humans.length > 1) return { ok: false, error: 'Solo is for one player. Remove the others first.' };
    this.mode = mode.id;
    if (mode.teams && this.matchType === 'knockout') this.setMatch('single');
    if (mode.solo && !this.bots.length) this.setBots(3);
    return { ok: true };
  }

  maxBots() {
    if (getMode(this.mode).solo) return MAX_SOLO_BOTS;
    return Math.max(0, MAX_PLAYERS - this.humans.length);
  }

  setBots(count, level) {
    if (this.phase === 'playing') return { ok: false, error: 'Change computer players between rounds.' };
    if (level !== undefined) {
      if (!BOT_LEVELS.includes(level)) return { ok: false, error: 'Unknown difficulty.' };
      this.botLevel = level;
    }
    if (count !== undefined) {
      const want = Math.max(0, Math.min(this.maxBots(), Math.floor(Number(count)) || 0));
      while (this.bots.length > want) this.removePlayer(this.bots[this.bots.length - 1].id);
      while (this.bots.length < want) {
        const used = new Set(this.players.map((p) => p.name));
        const b = BOTS.find((x) => !used.has(x.name));
        if (!b) break;
        this.players.push({ id: 'bot-' + token(), name: b.name, avatar: normaliseAvatar(b.avatar), socketId: null, connected: true, wins: 0, isBot: true });
      }
    }
    return { ok: true };
  }

  /** Bot CATCH! respects the same server deadline and first-valid-tap rules as humans. */
  scheduleCatchBots() {
    const g = this.game;
    const offender = g && g.pendingShoutId;
    const key = offender && g.catchDeadline > Date.now() ? `${offender}:${g.catchDeadline}` : null;
    if (!key || g.phase !== 'playing') {
      if (this.catchBotTimer) clearTimeout(this.catchBotTimer);
      this.catchBotTimer = null; this.catchBotKey = null;
      return;
    }
    if (this.catchBotKey === key) return;
    if (this.catchBotTimer) clearTimeout(this.catchBotTimer);
    this.catchBotKey = key;
    const bots = this.players.filter(p => p.isBot && g.has(p.id) && p.id !== offender);
    if (!bots.length) { this.catchBotKey = null; return; }
    const difficulty = this.botLevel;
    const delay = difficulty === 'hard' ? 1050 : difficulty === 'medium' ? 1900 : 2900;
    this.catchBotTimer = setTimeout(() => {
      this.catchBotTimer = null;
      if (this.game !== g || g.phase !== 'playing' || g.pendingShoutId !== offender || Date.now() >= g.catchDeadline) return;
      const caught = g.catch(bots[0].id);
      if (caught.ok) this.broadcast();
    }, delay);
  }

  /** If it's a computer player's turn, act after a short "thinking" pause. */
  scheduleBot() {
    const g = this.game;
    if (!g || g.phase !== 'playing' || g.rules.frenzy) return this.clearBot();
    const p = this.player(g.currentId);
    if (!p || !p.isBot) return this.clearBot();
    const key = `${g.turnNumber}:${g.pendingDrawnId}`;
    if (this.botTimer && this.botKey === key) return;
    this.clearBot();
    this.botKey = key;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.game !== g || g.phase !== 'playing' || g.currentId !== p.id || `${g.turnNumber}:${g.pendingDrawnId}` !== key) return;
      const move = decide(g, p.id, this.botLevel);
      if (move.action === 'play') {
        if (move.shout) g.shout(p.id);
        g.play(p.id, move.cardId, move.color, move.target);
        if (g.phase === 'finished') this.onRoundEnd();
      } else if (move.action === 'pass') g.pass(p.id);
      else g.draw(p.id);
      this.broadcast();
    }, thinkTime(this.botLevel, g.fuse.lit));
  }

  clearBot() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.botKey = null;
  }

  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const [p] = this.players.splice(idx, 1);
    if (this.game && this.game.has(id)) {
      const wasPlaying = this.game.phase === 'playing';
      this.game.removePlayer(id);
      if (wasPlaying && this.game.phase === 'finished') this.onRoundEnd();
    }
    if (p.socketId) {
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) { s.emit('removed'); s.leave(this.code); }
    }
  }

  /** Everything that happens once when a round finishes. */
  onRoundEnd() {
    if (!this.game || this.game.phase !== 'finished' || this.scoredRound === this.round) return;
    this.scoredRound = this.round;
    this.clearHot();
    this.clearFrenzy();
    this.creditWin();
    this.scoreMatch();
  }

  // ---------- Match Play ----------
  setMatch(type) {
    if (this.phase === 'playing') return { ok: false, error: 'Change the match between rounds.' };
    if (!MATCH_TYPES.some((m) => m.id === type)) return { ok: false, error: 'Unknown match type.' };
    if (type === 'knockout' && getMode(this.mode).teams) return { ok: false, error: "Knockout doesn't work with teams. Try First to 500." };
    this.matchType = type;
    this.resetMatch();
    return { ok: true };
  }

  resetMatch() {
    for (const p of this.players) { p.points = 0; p.out = false; }
    this.matchOver = false;
    this.championId = null;
    this.lastResult = null;
  }

  scoreMatch() {
    const g = this.game;
    const result = { gains: {}, knocked: [] };
    this.lastResult = result;
    if (this.matchType === 'points') {
      // The winner (or winning team) scores the cards left in everyone else's hands.
      const team = g.winnerTeam;
      const winners = team !== null && team !== undefined ? Object.keys(g.teams).filter((id) => g.teams[id] === team) : [g.winnerId];
      const total = g.order.filter((id) => !winners.includes(id)).reduce((n, id) => n + g.handPoints(id), 0);
      for (const id of winners) {
        const p = this.player(id);
        if (p) { p.points = (p.points || 0) + total; result.gains[id] = total; }
      }
      const top = this.players.reduce((best, p) => ((p.points || 0) > ((best && best.points) || 0) ? p : best), null);
      if (top && top.points >= MATCH_TARGET) { this.matchOver = true; this.championId = top.id; }
    } else if (this.matchType === 'knockout') {
      // Whoever is left holding the most cards is out. Ties are settled at random.
      const losers = g.order.filter((id) => id !== g.winnerId);
      if (losers.length) {
        const most = Math.max(...losers.map((id) => g.hands[id].length));
        const worst = losers.filter((id) => g.hands[id].length === most);
        const outId = worst[crypto.randomInt(worst.length)];
        const p = this.player(outId);
        if (p) p.out = true;
        result.knocked.push(outId);
      }
      const alive = this.players.filter((p) => !p.out && p.connected);
      if (alive.length <= 1) { this.matchOver = true; this.championId = g.winnerId; }
    }
  }

  // ---------- Hot Potato clocks ----------
  /** Start a fresh secret fuse whenever a Bomb lights it, and a 5-second clock for every turn while it burns. */
  scheduleHot() {
    const g = this.game;
    if (!g || g.phase !== 'playing' || !g.fuse.lit) return this.clearHot();
    if (this.fuseKey !== g.fuse.seq) {
      clearTimeout(this.fuseTimer);
      const seq = g.fuse.seq;
      this.fuseKey = seq;
      this.fuseLitAt = Date.now();
      const ms = FUSE_MIN_MS + Math.random() * (FUSE_MAX_MS - FUSE_MIN_MS);
      this.fuseTimer = setTimeout(() => {
        this.fuseTimer = null;
        if (this.game !== g || !g.fuse.lit || g.fuse.seq !== seq) return;
        g.explode();
        this.broadcast();
      }, ms);
    }
    const key = `${g.turnNumber}:${g.pendingDrawnId}`;
    if (this.turnKey !== key) {
      clearTimeout(this.turnTimer);
      this.turnKey = key;
      this.turnDeadline = Date.now() + TURN_MS;
      this.turnTimer = setTimeout(() => {
        this.turnTimer = null;
        if (this.game !== g || !g.fuse.lit || g.phase !== 'playing' || `${g.turnNumber}:${g.pendingDrawnId}` !== key) return;
        g.timeout(g.currentId);
        this.broadcast();
      }, TURN_MS);
    }
  }

  clearHot() {
    clearTimeout(this.fuseTimer); clearTimeout(this.turnTimer);
    this.fuseTimer = null; this.turnTimer = null;
    this.fuseKey = null; this.turnKey = null; this.turnDeadline = 0;
  }

  // ---------- Frenzy: real-time computer players and the stall breaker ----------
  scheduleFrenzy() {
    const g = this.game;
    if (!g || g.phase !== 'playing' || !g.rules.frenzy) return this.clearFrenzy();
    const now = Date.now();
    // Stall breaker: restart the countdown every time the top card changes.
    const topId = g.topCard.id;
    if (this.stallKey !== topId) {
      clearTimeout(this.stallTimer);
      this.stallKey = topId;
      this.stallTimer = setTimeout(() => {
        this.stallTimer = null;
        if (this.game !== g || g.phase !== 'playing' || g.topCard.id !== topId) return;
        g.frenzyFlip(Date.now());
        this.broadcast();
      }, STALL_MS);
    }
    // Each computer player reacts to the current top card after its own reaction time.
    for (const id of g.order) {
      const p = this.player(id);
      if (!p || !p.isBot) continue;
      const wait = Math.max(0, (g.frozenUntil[id] || 0) - now, (g.lockUntil[id] || 0) - now);
      const key = `${topId}:${g.hands[id].length}:${wait > 0}`;
      const slot = this.frenzyBots.get(id);
      if (slot && slot.key === key) continue;
      if (slot) clearTimeout(slot.timer);
      const timer = setTimeout(() => {
        this.frenzyBots.delete(id);
        if (this.game !== g || g.phase !== 'playing' || !g.hands[id]) return;
        const t = Date.now();
        const move = decideFrenzy(g, id, this.botLevel);
        let res;
        if (move.action === 'play') {
          if (move.shout) g.shout(id);
          res = g.frenzyPlay(id, move.cardId, move.color, g.topCard.id, t);
          if (g.phase === 'finished') this.onRoundEnd();
        } else {
          res = g.frenzyDraw(id, t);
        }
        if (!res.ok) {
          // Couldn't act yet (cooldown or frozen): try again shortly.
          setTimeout(() => { if (this.game === g) this.broadcast(); }, 400);
          return;
        }
        this.broadcast();
      }, wait + reactTime(this.botLevel));
      this.frenzyBots.set(id, { timer, key });
    }
  }

  clearFrenzy() {
    clearTimeout(this.stallTimer);
    this.stallTimer = null; this.stallKey = null;
    for (const { timer } of this.frenzyBots.values()) clearTimeout(timer);
    this.frenzyBots.clear();
  }

  creditWin() {
    const g = this.game;
    if (!g || !g.winnerId) return;
    const team = g.winnerTeam;
    if (team !== null && team !== undefined) {
      // Tag Team: everyone on the winning team gets the win.
      for (const p of this.players) if (g.teams[p.id] === team) p.wins++;
      return;
    }
    const winner = this.player(g.winnerId);
    if (winner) winner.wins++;
  }

  // ---------- state payloads ----------
  publicState() {
    const g = this.game;
    const seated = g ? g.order.map((id) => this.player(id)).filter(Boolean) : [];
    const waiting = this.players.filter((p) => !seated.includes(p));
    const leaderId = this.leader && this.leader.id;
    const players = [...seated, ...waiting].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      wins: p.wins,
      inRound: !!(g && g.has(p.id)),
      cardCount: g && g.has(p.id) ? g.hands[p.id].length : 0,
      isCurrent: !!(g && g.phase === 'playing' && !g.rules.frenzy && g.currentId === p.id),
      frozen: !!(g && g.rules.frenzy && g.has(p.id) && g.isFrozen(p.id, Date.now())),
      called: !!(g && g.called[p.id]),
      isLeader: p.id === leaderId,
      isBot: !!p.isBot,
      team: g && g.teams && g.has(p.id) ? g.teams[p.id] : null,
      points: p.points || 0,
      out: !!p.out,
    }));
    const mode = getMode(this.mode);
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      joinUrl: this.joinUrl,
      hostLabel: this.hostLabel,
      qrSvg: this.qrSvg,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      players,
      discard: g ? g.discard.slice(-4).map(face) : [],
      activeColor: g ? g.activeColor : null,
      direction: g ? g.direction : 1,
      drawCount: g ? g.deck.length : 0,
      currentId: g && g.phase === 'playing' ? g.currentId : null,
      winnerId: g ? g.winnerId : null,
      log: g ? g.log.slice(-4) : [],
      flash: g ? g.flash : null,
      events: g ? g.events : [],
      mode: mode.id,
      modes: MODES,
      botLevel: this.botLevel,
      botCount: this.bots.length,
      maxBots: this.maxBots(),
      humanCount: this.humans.length,
      tvless: this.tvless,
      rules: g ? g.rules : { stack: false, seven: false, zero: false },
      stack: g && g.pendingDraw ? { total: g.pendingDraw, type: g.stackType } : null,
      teams: g && g.teams ? TEAMS.slice(0, g.teamNames.length) : null,
      winnerTeam: g ? g.winnerTeam : null,
      teamSize: this.teamSize,
      teamProblem: mode.teams ? this.teamProblem(this.players.filter((p) => p.connected).length) : null,
      side: g ? g.side : 'day',
      palette: g ? g.palette() : COLORS,
      fuse: g && g.phase === 'playing' && g.fuse.lit
        ? { seq: g.fuse.seq, elapsed: Date.now() - this.fuseLitAt, turnLeft: Math.max(0, this.turnDeadline - Date.now()), turnMs: TURN_MS }
        : null,
      match: {
        type: this.matchType,
        types: MATCH_TYPES,
        target: MATCH_TARGET,
        over: this.matchOver,
        championId: this.championId,
        gains: this.lastResult ? this.lastResult.gains : {},
        knocked: this.lastResult ? this.lastResult.knocked : [],
        alive: this.players.filter((p) => !p.out).length,
      },
    };
  }

  privateState(p, pub) {
    const g = this.game;
    const inRound = !!(g && g.has(p.id));
    const hand = inRound ? g.hands[p.id] : [];
    const isMyTurn = !!(inRound && g.phase === 'playing' && !g.rules.frenzy && g.currentId === p.id);
    const now = Date.now();
    const frenzy = !!(inRound && g.rules.frenzy && g.phase === 'playing');
    const playable = inRound ? g.playableIds(p.id) : [];
    const current = pub.players.find((x) => x.isCurrent);
    const winner = pub.players.find((x) => x.id === pub.winnerId);
    return {
      code: this.code,
      phase: pub.phase,
      round: pub.round,
      me: { id: p.id, name: p.name, avatar: p.avatar, wins: p.wins, points: p.points || 0, out: !!p.out, isLeader: pub.players.some((x) => x.id === p.id && x.isLeader) },
      inRound,
      hand: hand.map(face),
      playableIds: playable,
      isMyTurn,
      pendingDrawnId: isMyTurn ? g.pendingDrawnId : null,
      canDraw: frenzy ? now >= (g.drawUntil[p.id] || 0) && !g.isFrozen(p.id, now) : isMyTurn && !g.pendingDrawnId && (playable.length === 0 || g.pendingDraw > 0),
      frenzy: frenzy ? {
        frozenFor: Math.max(0, (g.frozenUntil[p.id] || 0) - now),
        lockedFor: Math.max(0, (g.lockUntil[p.id] || 0) - now),
        drawWait: Math.max(0, (g.drawUntil[p.id] || 0) - now),
      } : null,
      canPass: isMyTurn && !!g.pendingDrawnId,
      mustTake: isMyTurn && g.pendingDraw > 0 ? g.pendingDraw : 0,
      called: inRound ? g.called[p.id] : false,
      topCard: pub.discard[pub.discard.length - 1] || null,
      activeColor: pub.activeColor,
      direction: pub.direction,
      currentName: current ? current.name : null,
      seats: pub.players.filter((x) => x.inRound).map((x) => ({ id: x.id, name: x.name, avatar: x.avatar, cardCount: x.cardCount, isCurrent: x.isCurrent, isBot: x.isBot, called: x.called, isMe: x.id === p.id, team: x.team, frozen: x.frozen })),
      myTeam: inRound && g.teams ? g.teams[p.id] : null,
      rules: pub.rules,
      stack: pub.stack,
      teams: pub.teams,
      winnerTeam: pub.winnerTeam,
      teamSize: pub.teamSize,
      teamProblem: pub.teamProblem,
      fuse: pub.fuse,
      match: pub.match,
      side: pub.side,
      palette: pub.palette,
      lobby: pub.players.map((x) => ({ id: x.id, name: x.name, avatar: x.avatar, connected: x.connected, isLeader: x.isLeader, wins: x.wins, isBot: x.isBot, points: x.points, out: x.out })),
      canStart: pub.phase !== 'playing' && pub.players.filter((x) => x.connected).length >= MIN_PLAYERS,
      canShout: inRound ? g.canShout(p.id) : false,
      canCatch: !!(inRound && g.pendingShoutId && g.pendingShoutId !== p.id && !g.called[g.pendingShoutId] && Date.now() < g.catchDeadline),
      catchExpiresAt: inRound && g.pendingShoutId ? g.catchDeadline : 0,
      catchRemainingMs: inRound && g.pendingShoutId ? Math.max(0, g.catchDeadline - Date.now()) : 0,
      log: pub.log[pub.log.length - 1] || '',
      mode: pub.mode,
      modes: pub.modes,
      botLevel: pub.botLevel,
      botCount: pub.botCount,
      maxBots: pub.maxBots,
      humanCount: pub.humanCount,
      tvless: pub.tvless,
      winner: winner ? { name: winner.name, avatar: winner.avatar, isMe: winner.id === p.id } : null,
      flash: pub.flash,
    };
  }

  broadcast() {
    this.touched = Date.now();
    this.scheduleHot(); // before building state, so the fuse clock is current
    const pub = this.publicState();
    this.io.to(this.tvChannel).emit('update-tv', pub);
    for (const p of this.players) {
      if (!p.isBot && p.connected && p.socketId) this.io.to(p.socketId).emit('update-player', this.privateState(p, pub));
    }
    this.scheduleAwaySkip();
    this.scheduleBot();
    this.scheduleCatchBots();
    this.scheduleFrenzy();
    saveRooms();
  }

  /** If it's a disconnected player's turn, skip it after a short wait so the table never stalls. */
  scheduleAwaySkip() {
    const g = this.game;
    if (!g || g.phase !== 'playing' || g.rules.frenzy) return this.clearAway();
    const current = this.player(g.currentId);
    if (current && current.connected) return this.clearAway();
    if (this.awayTimer && this.awayTurn === g.turnNumber) return;
    this.clearAway();
    this.awayTurn = g.turnNumber;
    this.awayTimer = setTimeout(() => {
      this.awayTimer = null;
      const now = this.player(g.currentId);
      if (this.game === g && g.turnNumber === this.awayTurn && (!now || !now.connected)) {
        g.autoSkip(g.currentId);
        this.broadcast();
      }
    }, AWAY_TIMEOUT_MS);
  }

  clearAway() {
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.awayTimer = null;
  }
}

// ---------- http ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });
const PUBLIC = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/healthz', (_req, res) => {
  if (roomStore && !roomStore.status().healthy) return res.status(503).type('text').send('snapshot write failed');
  res.type('text').send('ok');
});
app.get('/j/:code', (_req, res) => res.sendFile(path.join(PUBLIC, 'phone.html')));
app.get('/join', (_req, res) => res.sendFile(path.join(PUBLIC, 'phone.html')));

// ---------- sockets ----------
io.on('connection', (socket) => {
  let room = null; // the room this socket belongs to
  let playerId = null; // set for phones
  let isTv = false;

  const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
  const findRoom = (code) => rooms.get(String(code || '').toUpperCase().trim());

  // ----- TV -----
  socket.on('tv:create', async (_data, ack) => {
    room = await new Room(io, publicBase(socket.handshake)).init();
    rooms.set(room.code, room);
    isTv = true;
    socket.join(room.tvChannel);
    reply(ack, { ok: true, code: room.code, hostToken: room.hostToken });
    room.broadcast();
  });

  socket.on('tv:resume', ({ code, hostToken } = {}, ack) => {
    const r = findRoom(code);
    if (!r || r.hostToken !== hostToken) return reply(ack, { ok: false });
    room = r;
    isTv = true;
    socket.join(room.tvChannel);
    reply(ack, { ok: true, code: room.code, hostToken: room.hostToken });
    room.broadcast();
  });

  socket.on('tv:start', (_d, ack) => {
    if (!isTv || !room) return;
    if (room.phase === 'playing') return reply(ack, { ok: false, error: 'A round is already being played.' });
    const res = room.startRound();
    reply(ack, res);
    if (res.ok) room.broadcast();
  });

  socket.on('tv:remove', ({ id } = {}) => {
    if (!isTv || !room) return;
    room.removePlayer(id);
    room.broadcast();
  });

  // TV asks for a fresh picture (e.g. when a Frenzy freeze wears off).
  socket.on('tv:ping', () => { if (isTv && room) room.broadcast(); });

  socket.on('tv:lobby', () => {
    if (!isTv || !room || room.phase === 'playing') return;
    room.game = null;
    room.broadcast();
  });

  socket.on('tv:mode', ({ id } = {}, ack) => {
    if (!isTv || !room) return;
    const res = room.setMode(String(id));
    reply(ack, res);
    if (res.ok) room.broadcast();
  });

  socket.on('tv:match', ({ type } = {}, ack) => {
    if (!isTv || !room) return;
    const res = room.setMatch(String(type));
    reply(ack, res);
    if (res.ok) room.broadcast();
  });

  socket.on('tv:teamsize', ({ size } = {}, ack) => {
    if (!isTv || !room) return;
    const res = room.setTeamSize(size);
    reply(ack, res);
    if (res.ok) room.broadcast();
  });

  socket.on('tv:bots', ({ count, level } = {}, ack) => {
    if (!isTv || !room) return;
    const res = room.setBots(count, level);
    reply(ack, res);
    if (res.ok) room.broadcast();
  });

  // ----- phone-only Solo: no TV, the phone is the whole table -----
  socket.on('solo:create', async ({ name, avatar, bots, level } = {}, ack) => {
    const n = cleanName(name);
    if (!n) return reply(ack, { ok: false, error: 'Type your name first.' });
    const r = await new Room(io, publicBase(socket.handshake)).init();
    rooms.set(r.code, r);
    r.tvless = true;
    const p = { id: token(), name: n, avatar: normaliseAvatar(avatar), socketId: socket.id, connected: true, wins: 0, resumeToken: token() };
    r.players.push(p);
    r.setMode('solo');
    r.setBots(bots === undefined ? 3 : bots, BOT_LEVELS.includes(level) ? level : 'medium');
    const res = r.startRound();
    if (!res.ok) { rooms.delete(r.code); return reply(ack, res); }
    room = r;
    playerId = p.id;
    socket.join(r.code);
    reply(ack, { ok: true, playerId: p.id, resumeToken: p.resumeToken, code: r.code });
    r.broadcast();
  });

  // ----- phones -----
  socket.on('player:join', ({ code, name, avatar, playerId: resumeId, resumeToken } = {}, ack) => {
    const r = findRoom(code);
    if (!r) return reply(ack, { ok: false, error: 'No game with that code. Check the code on the TV.' });
    // One socket must not control seats in multiple rooms, nor claim a second seat.
    // A normal reconnection uses a new socket and its private resume token.
    if (room && (room !== r || (playerId && playerId !== resumeId))) {
      return reply(ack, { ok: false, error: 'Leave your current table before joining another.' });
    }

    let p = resumeId && r.player(resumeId);
    if (p && p.resumeToken && resumeToken !== p.resumeToken) return reply(ack, { ok: false, error: 'Session credentials expired. Rejoin the table.' });
    if (p) {
      // Reconnecting phone: take over the seat.
      if (p.socketId && p.socketId !== socket.id) {
        const old = io.sockets.sockets.get(p.socketId);
        if (old) old.disconnect(true);
      }
    } else {
      const n = cleanName(name);
      if (!n) return reply(ack, { ok: false, error: 'Type your name first.' });
      if (r.tvless) return reply(ack, { ok: false, error: 'That is a private Solo game.' });
      if (getMode(r.mode).solo && r.humans.length >= 1) return reply(ack, { ok: false, error: 'This table is set up for Solo. Ask the host to switch to Classic.' });
      if (r.players.length >= MAX_PLAYERS) return reply(ack, { ok: false, error: `This table is full (${MAX_PLAYERS} players).` });
      if (r.players.some((x) => x.name.toLowerCase() === n.toLowerCase())) return reply(ack, { ok: false, error: `Someone is already called ${n}. Pick another name.` });
      p = { id: token(), name: n, avatar: normaliseAvatar(avatar), socketId: null, connected: false, wins: 0, resumeToken: token() };
      r.players.push(p);
    }
    p.socketId = socket.id;
    p.connected = true;
    room = r;
    playerId = p.id;
    socket.join(r.code);
    reply(ack, { ok: true, playerId: p.id, resumeToken: p.resumeToken, code: r.code, waiting: r.phase === 'playing' && !(r.game && r.game.has(p.id)) });
    r.broadcast();
  });

  const me = () => (room && playerId ? room.player(playerId) : null);
  const act = (fn, ack) => {
    const p = me();
    if (!p || !room) return reply(ack, { ok: false, error: 'You are not in a game.' });
    const res = fn(p) || { ok: false };
    reply(ack, res);
    if (res.ok) room.broadcast();
  };

  socket.on('player:start', (_d, ack) => act((p) => {
    if (room.leader !== p) return { ok: false, error: 'Only the first player can start the game.' };
    if (room.phase === 'playing') return { ok: false, error: 'A round is already being played.' };
    return room.startRound();
  }, ack));

  const leaderOnly = (fn) => (p) => (room.leader !== p ? { ok: false, error: 'Only the first player can change the game.' } : fn(p));
  socket.on('player:mode', ({ id } = {}, ack) => act(leaderOnly(() => room.setMode(String(id))), ack));
  socket.on('player:bots', ({ count, level } = {}, ack) => act(leaderOnly(() => room.setBots(count, level)), ack));
  socket.on('player:match', ({ type } = {}, ack) => act(leaderOnly(() => room.setMatch(String(type))), ack));
  socket.on('player:teamsize', ({ size } = {}, ack) => act(leaderOnly(() => room.setTeamSize(size)), ack));

  // Tag Team: a quick private signal to your partners. The TV only shows that a signal was sent.
  let lastSignal = 0;
  socket.on('player:signal', ({ kind, color } = {}, ack) => {
    const p = me();
    const g = room && room.game;
    if (!p || !g || g.phase !== 'playing' || !g.teams || !g.has(p.id)) return reply(ack, { ok: false, error: 'Signals are for Tag Team.' });
    if (!SIGNALS[kind] || (kind === 'have' && !COLORS.includes(color))) return reply(ack, { ok: false });
    const now = Date.now();
    if (now - lastSignal < 2500) return reply(ack, { ok: false, error: 'Give your partner a moment.' });
    lastSignal = now;
    const text = SIGNALS[kind].replace('{color}', kind === 'have' ? color[0].toUpperCase() + color.slice(1) : '');
    for (const mateId of g.teammates(p.id)) {
      const mate = room.player(mateId);
      if (mate && mate.socketId) io.to(mate.socketId).emit('signal', { from: p.name, avatar: p.avatar, kind, color: kind === 'have' ? color : null, text });
    }
    io.to(room.tvChannel).emit('signal-sent', { by: p.id });
    reply(ack, { ok: true });
  });

  socket.on('player:play', ({ cardId, color, target, seenTopId } = {}, ack) => act((p) => {
    if (!room.game) return { ok: false, error: 'The game has not started.' };
    if (room.game.rules.frenzy) {
      // Frenzy: arrival order decides the race. seenTopId lets a narrowly-beaten card count as "late", not wrong.
      const r = room.game.frenzyPlay(p.id, String(cardId), ALL_COLORS.includes(color) ? color : null, seenTopId ? String(seenTopId) : null, Date.now());
      if (r.ok && room.game.phase === 'finished') room.onRoundEnd();
      return r;
    }
    const res = room.game.play(p.id, String(cardId), ALL_COLORS.includes(color) ? color : null, target ? String(target) : null);
    if (res.ok && room.game.phase === 'finished') room.onRoundEnd();
    return res;
  }, ack));

  socket.on('player:draw', (_d, ack) => act((p) => {
    const g = room.game;
    if (!g) return { ok: false };
    return g.rules.frenzy ? g.frenzyDraw(p.id, Date.now()) : g.draw(p.id);
  }, ack));
  socket.on('player:pass', (_d, ack) => act((p) => (room.game ? room.game.pass(p.id) : { ok: false }), ack));
  socket.on('player:shout', (_d, ack) => act((p) => (room.game ? room.game.shout(p.id) : { ok: false }), ack));
  socket.on('player:catch', (_d, ack) => act((p) => (room.game ? room.game.catch(p.id) : { ok: false }), ack));

  // Phase 4: server-controlled, fixed-vocabulary reactions. No player-provided text reaches clients.
  let lastReactionAt = 0;
  const REACTIONS = new Set(['😂', '😱', '🔥', '👏', '😈', '🙏']);
  socket.on('player:reaction', ({ emoji } = {}, ack) => {
    const p = me();
    if (!room || !p || !room.game || room.phase !== 'playing') return reply(ack, { ok: false, error: 'Reactions are available during a round.' });
    if (!REACTIONS.has(emoji)) return reply(ack, { ok: false, error: 'Unknown reaction.' });
    const now = Date.now();
    if (now - lastReactionAt < 2000) return reply(ack, { ok: false, error: 'Reaction cooling down.' });
    lastReactionAt = now;
    io.to(room.tvChannel).emit('player-reaction', { playerId: p.id, emoji });
    reply(ack, { ok: true });
  });

  socket.on('player:leave', (_d, ack) => {
    const p = me();
    if (!p || !room) return reply(ack, { ok: true });
    room.removePlayer(p.id);
    reply(ack, { ok: true });
    if (room.tvless) { room.clearBot(); room.clearHot(); room.clearFrenzy(); room.clearAway(); rooms.delete(room.code); }
    else room.broadcast();
    room = null;
    playerId = null;
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const p = me();
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
      room.broadcast();
    }
  });
});

// Tidy up abandoned rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const tvConnected = (io.sockets.adapter.rooms.get(r.tvChannel) || new Set()).size > 0;
    const anyone = tvConnected || r.humans.some((p) => p.connected);
    if (!anyone && now - r.touched > (r.tvless ? 5 * 60 * 1000 : ROOM_IDLE_MS)) {
      r.clearAway();
      r.clearBot();
      r.clearHot();
      r.clearFrenzy();
      rooms.delete(code);
      saveRooms();
    } else if (anyone) {
      r.touched = now;
    }
  }
}, 60 * 1000).unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Is Last Card already running in another window?\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

const HOSTED = !!(process.env.RENDER || process.env.PUBLIC_URL || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);

// Restore only validated room state. All sockets/timers belong to the old process.
if (roomStore) {
  for (const data of roomStore.load()) {
    try {
      const r = new Room(io, null);
      Object.assign(r, data);
      r.players = data.players.map((p) => ({ ...p, avatar: normaliseAvatar(p.avatar), connected: !!p.isBot, socketId: null }));
      if (data.game) {
        const g = Object.create(LastCardGame.prototype);
        Object.assign(g, data.game);
        r.game = g;
      }
      // A lit fuse cannot safely resume its secret deadline across process restarts.
      if (r.game?.fuse?.lit) r.game.fuse.seq += 1;
      r.qrSvg = '';
      r.touched = Date.now(); // Give reconnecting clients the normal idle grace period.
      rooms.set(r.code, r);
    } catch (err) { console.error('[persistence] skipped room:', err.message); }
  }
  for (const r of rooms.values()) r.init().catch((err) => console.error('[persistence] QR restoration failed:', err.message));
  console.log(`[persistence] Restored ${rooms.size} room(s)`);
}
process.on('SIGTERM', () => { roomStore?.flush(); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { roomStore?.flush(); server.close(() => process.exit(0)); });
server.listen(PORT, '0.0.0.0', () => {
  if (HOSTED) {
    console.log(`Last Card is running online on port ${PORT}. Open your website address + /tv.html on the TV.`);
    return;
  }
  const ip = lanAddress();
  const tvUrl = `http://localhost:${PORT}/tv.html`;
  console.log('\n  LAST CARD is running.\n');
  console.log(`  TV screen:   ${tvUrl}`);
  console.log(ip ? `  Phones join: http://${ip}:${PORT}  (or scan the QR code on the TV)` : '  Warning: this computer is not on a network, so phones cannot join.');
  console.log('\n  Keep this window open while you play. Close it to stop the game.\n');
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${tvUrl}"` : process.platform === 'darwin' ? `open "${tvUrl}"` : `xdg-open "${tvUrl}"`;
    exec(cmd, () => {});
  }
});

module.exports = { server, rooms };
