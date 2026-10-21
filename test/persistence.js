'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../game/persistence');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-card-state-'));
try {
  assert.strictEqual(createStore(null), null);
  assert.throws(() => createStore(path.join(__dirname, '../public/secrets')), /public web directory/);
  const store = createStore(dir);
  const room = {
    code: 'ABCD', hostToken: 'private', players: [{ id: 'p1', socketId: 'socket-id', connected: true, resumeToken: 'secret' }],
    game: { mode: 'classic', hands: { p1: [{ id: 'c1' }] } }, round: 2, touched: Date.now(),
    hostLabel: 'example.com', joinUrl: 'https://example.com/j/ABCD', mode: 'classic', botLevel: 'medium', tvless: false,
    teamSize: 2, matchType: 'single', matchOver: false, championId: null, lastResult: null, scoredRound: 1,
  };
  store.save(new Map([[room.code, room]])); store.flush();
  const saved = store.load();
  assert.equal(saved.length, 1); assert.equal(saved[0].players[0].socketId, null);
  assert.equal(saved[0].players[0].connected, false);
  assert.equal(saved[0].players[0].resumeToken, 'secret');
  assert.deepStrictEqual(saved[0].game.hands.p1, [{ id: 'c1' }]);
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  assert.equal(store.status().healthy, true);
  fs.writeFileSync(store.file, '{corrupted'); assert.deepStrictEqual(store.load(), []);
  console.log('persistence: atomic snapshot, seat secrets, permissions, corruption fallback checked');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
