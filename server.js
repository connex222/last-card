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
const { LastCardGame, COLORS } = require('./game/lastcard');

const PORT = Number(process.env.PORT) || 3000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const AWAY_TIMEOUT_MS = 20000; // auto-skip a disconnected player's turn after this
const ROOM_IDLE_MS = 30 * 60 * 1000; // delete rooms nobody has touched for 30 minutes
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦉', '🐯', '🐨', '🐵', '🦄', '🐲', '🐧', '🐝', '🦖', '🐢', '🦋'];
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
  }

  get tvChannel() { return `tv:${this.code}`; }
  get leader() { return this.players.find((p) => p.connected) || this.players[0] || null; }
  get phase() { return this.game ? this.game.phase : 'lobby'; }
  player(id) { return this.players.find((p) => p.id === id); }

  async init() {
    this.qrSvg = await QRCode.toString(this.joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#09090b', light: '#ffffff' } });
    return this;
  }

  startRound() {
    const seats = this.players.filter((p) => p.connected);
    if (seats.length < MIN_PLAYERS) return { ok: false, error: `You need at least ${MIN_PLAYERS} players connected.` };
    this.game = new LastCardGame(seats.map((p) => ({ id: p.id, name: p.name })));
    this.round++;
    return { ok: true };
  }

  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const [p] = this.players.splice(idx, 1);
    if (this.game && this.game.has(id)) {
      const wasPlaying = this.game.phase === 'playing';
      this.game.removePlayer(id);
      if (wasPlaying && this.game.phase === 'finished') this.creditWin();
    }
    if (p.socketId) {
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) { s.emit('removed'); s.leave(this.code); }
    }
  }

  creditWin() {
    const winner = this.game && this.player(this.game.winnerId);
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
      isCurrent: !!(g && g.phase === 'playing' && g.currentId === p.id),
      called: !!(g && g.called[p.id]),
      isLeader: p.id === leaderId,
    }));
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
      discard: g ? g.discard.slice(-4) : [],
      activeColor: g ? g.activeColor : null,
      direction: g ? g.direction : 1,
      drawCount: g ? g.deck.length : 0,
      currentId: g && g.phase === 'playing' ? g.currentId : null,
      winnerId: g ? g.winnerId : null,
      log: g ? g.log.slice(-4) : [],
      flash: g ? g.flash : null,
    };
  }

  privateState(p, pub) {
    const g = this.game;
    const inRound = !!(g && g.has(p.id));
    const hand = inRound ? g.hands[p.id] : [];
    const isMyTurn = !!(inRound && g.phase === 'playing' && g.currentId === p.id);
    const playable = inRound ? g.playableIds(p.id) : [];
    const current = pub.players.find((x) => x.isCurrent);
    const winner = pub.players.find((x) => x.id === pub.winnerId);
    return {
      code: this.code,
      phase: pub.phase,
      round: pub.round,
      me: { id: p.id, name: p.name, avatar: p.avatar, wins: p.wins, isLeader: pub.players.some((x) => x.id === p.id && x.isLeader) },
      inRound,
      hand,
      playableIds: playable,
      isMyTurn,
      pendingDrawnId: isMyTurn ? g.pendingDrawnId : null,
      canDraw: isMyTurn && !g.pendingDrawnId && playable.length === 0,
      canPass: isMyTurn && !!g.pendingDrawnId,
      called: inRound ? g.called[p.id] : false,
      topCard: pub.discard[pub.discard.length - 1] || null,
      activeColor: pub.activeColor,
      direction: pub.direction,
      currentName: current ? current.name : null,
      others: pub.players.filter((x) => x.inRound && x.id !== p.id).map((x) => ({ name: x.name, avatar: x.avatar, cardCount: x.cardCount, isCurrent: x.isCurrent })),
      lobby: pub.players.map((x) => ({ name: x.name, avatar: x.avatar, connected: x.connected, isLeader: x.isLeader, wins: x.wins })),
      canStart: pub.phase !== 'playing' && pub.players.filter((x) => x.connected).length >= MIN_PLAYERS,
      winner: winner ? { name: winner.name, avatar: winner.avatar, isMe: winner.id === p.id } : null,
      flash: pub.flash,
    };
  }

  broadcast() {
    this.touched = Date.now();
    const pub = this.publicState();
    this.io.to(this.tvChannel).emit('update-tv', pub);
    for (const p of this.players) {
      if (p.connected && p.socketId) this.io.to(p.socketId).emit('update-player', this.privateState(p, pub));
    }
    this.scheduleAwaySkip();
  }

  /** If it's a disconnected player's turn, skip it after a short wait so the table never stalls. */
  scheduleAwaySkip() {
    const g = this.game;
    if (!g || g.phase !== 'playing') return this.clearAway();
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
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
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

  socket.on('tv:lobby', () => {
    if (!isTv || !room || room.phase === 'playing') return;
    room.game = null;
    room.broadcast();
  });

  // ----- phones -----
  socket.on('player:join', ({ code, name, avatar, playerId: resumeId } = {}, ack) => {
    const r = findRoom(code);
    if (!r) return reply(ack, { ok: false, error: 'No game with that code. Check the code on the TV.' });

    let p = resumeId && r.player(resumeId);
    if (p) {
      // Reconnecting phone: take over the seat.
      if (p.socketId && p.socketId !== socket.id) {
        const old = io.sockets.sockets.get(p.socketId);
        if (old) old.disconnect(true);
      }
    } else {
      const n = cleanName(name);
      if (!n) return reply(ack, { ok: false, error: 'Type your name first.' });
      if (r.players.length >= MAX_PLAYERS) return reply(ack, { ok: false, error: `This table is full (${MAX_PLAYERS} players).` });
      if (r.players.some((x) => x.name.toLowerCase() === n.toLowerCase())) return reply(ack, { ok: false, error: `Someone is already called ${n}. Pick another name.` });
      p = { id: token(), name: n, avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0], socketId: null, connected: false, wins: 0 };
      r.players.push(p);
    }
    p.socketId = socket.id;
    p.connected = true;
    room = r;
    playerId = p.id;
    socket.join(r.code);
    reply(ack, { ok: true, playerId: p.id, code: r.code, waiting: r.phase === 'playing' && !(r.game && r.game.has(p.id)) });
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

  socket.on('player:play', ({ cardId, color } = {}, ack) => act((p) => {
    if (!room.game) return { ok: false, error: 'The game has not started.' };
    const res = room.game.play(p.id, String(cardId), COLORS.includes(color) ? color : null);
    if (res.ok && room.game.phase === 'finished') room.creditWin();
    return res;
  }, ack));

  socket.on('player:draw', (_d, ack) => act((p) => (room.game ? room.game.draw(p.id) : { ok: false }), ack));
  socket.on('player:pass', (_d, ack) => act((p) => (room.game ? room.game.pass(p.id) : { ok: false }), ack));
  socket.on('player:shout', (_d, ack) => act((p) => (room.game ? room.game.shout(p.id) : { ok: false }), ack));

  socket.on('player:leave', (_d, ack) => {
    const p = me();
    if (!p || !room) return reply(ack, { ok: true });
    room.removePlayer(p.id);
    reply(ack, { ok: true });
    room.broadcast();
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
    const anyone = tvConnected || r.players.some((p) => p.connected);
    if (!anyone && now - r.touched > ROOM_IDLE_MS) {
      r.clearAway();
      rooms.delete(code);
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
