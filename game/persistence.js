'use strict';
/** Atomic, versioned single-process room snapshots. Never place STATE_DIR in public/. */
const fs = require('fs');
const path = require('path');
const VERSION = 1;
function safeDirectory(dir) {
  if (!dir) return null;
  const absolute = path.resolve(dir);
  if (absolute === path.resolve(__dirname, '..', 'public') || absolute.startsWith(path.resolve(__dirname, '..', 'public') + path.sep)) {
    throw new Error('STATE_DIR must not be inside the public web directory');
  }
  return absolute;
}
function createStore(directory) {
  const dir = safeDirectory(directory);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'rooms-v1.json');
  let pending = null;
  let timer = null;
  let lastFailure = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    const json = pending;
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, json, { mode: 0o600 });
      fs.renameSync(tmp, file);
      pending = null;
      lastFailure = null;
    } catch (err) {
      lastFailure = err;
      console.error('[persistence] snapshot failed:', err.message);
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }
  function save(rooms) {
    const snapshot = Array.from(rooms.values()).map((room) => ({
      code: room.code, hostToken: room.hostToken, players: room.players.map((p) => ({ ...p, connected: false, socketId: null })),
      game: room.game ? JSON.parse(JSON.stringify(room.game)) : null,
      round: room.round, touched: room.touched, hostLabel: room.hostLabel, joinUrl: room.joinUrl,
      mode: room.mode, botLevel: room.botLevel, tvless: room.tvless, teamSize: room.teamSize,
      matchType: room.matchType, matchOver: room.matchOver, championId: room.championId,
      lastResult: room.lastResult, scoredRound: room.scoredRound,
      // Timers are process-local and restarted safely when the next client reconnects.
    }));
    pending = JSON.stringify({ version: VERSION, savedAt: Date.now(), rooms: snapshot });
    if (!timer) { timer = setTimeout(flush, 150); timer.unref?.(); }
  }
  function load() {
    if (!fs.existsSync(file)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== VERSION || !Array.isArray(data.rooms)) throw new Error('Unsupported snapshot format');
      return data.rooms.filter((r) => r && /^[A-HJ-NP-Z]{4}$/.test(r.code) && Array.isArray(r.players) && r.players.length <= 10);
    } catch (err) {
      console.error('[persistence] Cannot restore rooms:', err.message);
      return [];
    }
  }
  function status() { return { enabled: true, healthy: !lastFailure }; }
  return { save, load, flush, status, file };
}
module.exports = { createStore };
