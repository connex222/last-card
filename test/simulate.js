'use strict';
/**
 * Automated checks:
 *  1. 2,000 random games through the rules engine, checking that no card is ever lost or duplicated.
 *  2. A live game over Socket.io: a TV plus 3 phone bots play a full round against the real server.
 * Run: npm test
 */
const assert = require('assert');
const { LastCardGame, COLORS } = require('../game/lastcard');

function totalCards(g) {
  const ids = [...g.deck, ...g.discard, ...Object.values(g.hands).flat()].map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate card');
  return ids.length;
}

function randomTurn(g) {
  const id = g.currentId;
  const playable = g.playableIds(id);
  if (g.hands[id].length === 2 && playable.length && Math.random() < 0.7) g.shout(id);
  if (playable.length) {
    const cardId = playable[(Math.random() * playable.length) | 0];
    const color = COLORS[(Math.random() * 4) | 0];
    const r = g.play(id, cardId, color);
    assert.ok(r.ok, r.error);
  } else if (g.pendingDrawnId) {
    assert.ok(g.pass(id).ok);
  } else {
    assert.ok(g.draw(id).ok);
  }
}

// ---- 1. engine fuzz ----
let finished = 0;
for (let n = 0; n < 2000; n++) {
  const count = 2 + (n % 9);
  const g = new LastCardGame(Array.from({ length: count }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
  assert.ok(/^[0-9]$/.test(g.topCard.value), 'must start on a number');
  for (const id of g.order) assert.strictEqual(g.hands[id].length, 7);
  let turns = 0;
  while (g.phase === 'playing' && turns < 3000) {
    randomTurn(g);
    assert.strictEqual(totalCards(g), 108);
    turns++;
    if (n % 50 === 0 && turns === 40 && g.phase === 'playing' && g.order.length > 2) {
      g.removePlayer(g.order[1]); // exercise mid-round leaving
    }
  }
  if (g.phase === 'finished') { finished++; assert.strictEqual(g.hands[g.winnerId].length, 0); }
}
console.log(`engine: ${finished}/2000 random games finished, card count always 108`);

// ---- rule spot checks ----
{
  const g = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  g.currentIndex = 0; g.direction = 1;
  g.discard.push({ id: 'x1', color: 'red', value: '5' }); g.activeColor = 'red';
  g.hands.a = [{ id: 't1', color: 'red', value: 'draw2' }, { id: 't2', color: 'blue', value: '1' }, { id: 't3', color: 'wild', value: 'wild4' }];
  assert.ok(!g.playableIds('a').includes('t3'), 'Wild Draw Four blocked while holding the active colour');
  const before = g.hands.b.length;
  assert.ok(g.play('a', 't1').ok);
  assert.strictEqual(g.hands.b.length, before + 2, 'Draw Two gives 2');
  assert.strictEqual(g.currentId, 'c', 'Draw Two skips the victim');
  assert.strictEqual(g.pendingShoutId, null);

  // forgetting to call
  g.hands.c = [{ id: 'u1', color: 'red', value: '7' }, { id: 'u2', color: 'red', value: '8' }];
  assert.ok(g.play('c', 'u1').ok);
  assert.strictEqual(g.pendingShoutId, 'c');
  g.hands.a.push({ id: 'u3', color: 'red', value: '9' });
  assert.ok(g.play('a', 'u3').ok);
  assert.strictEqual(g.hands.c.length, 3, 'forgot to call = draw 2');

  // reverse with two players acts as skip
  const h = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  h.currentIndex = 0; h.discard.push({ id: 'y1', color: 'green', value: '3' }); h.activeColor = 'green';
  h.hands.a.push({ id: 'r1', color: 'green', value: 'reverse' });
  assert.ok(h.play('a', 'r1').ok);
  assert.strictEqual(h.currentId, 'a', 'two-player Reverse = Skip');
  console.log('rules: spot checks passed');
}

// ---- 2. live server ----
process.env.NO_OPEN = '1';
process.env.PORT = '3999';
const { server } = require('../server');
const { io } = require('socket.io-client');
const URL = 'http://localhost:3999';
const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));

(async () => {
  await new Promise((r) => server.listening ? r() : server.once('listening', r));
  const tv = io(URL, { transports: ['websocket'] });
  let tvState = null;
  tv.on('update-tv', (s) => { tvState = s; });
  const created = await emit(tv, 'tv:create', {});
  assert.ok(created.ok);

  const bots = [];
  for (const name of ['Ann', 'Bob', 'Cat']) {
    const s = io(URL, { transports: ['websocket'] });
    const bot = { s, name, state: null };
    s.on('update-player', (st) => { bot.state = st; });
    const r = await emit(s, 'player:join', { code: created.code.toLowerCase(), name, avatar: '🐼' });
    assert.ok(r.ok, r.error);
    bot.id = r.playerId;
    bots.push(bot);
  }
  const dup = await emit(io(URL, { transports: ['websocket'] }), 'player:join', { code: created.code, name: 'ann' });
  assert.ok(!dup.ok, 'duplicate names are refused');

  const start = await emit(bots[0].s, 'player:start', {});
  assert.ok(start.ok, start.error);
  await new Promise((r) => setTimeout(r, 100));

  let moves = 0;
  while (tvState.phase === 'playing' && moves < 2000) {
    const bot = bots.find((b) => b.state && b.state.isMyTurn);
    if (!bot) { await new Promise((r) => setTimeout(r, 20)); continue; }
    const st = bot.state;
    assert.ok(!('hand' in tvState) && tvState.players.every((p) => !('hand' in p)), 'TV never receives hands');
    if (st.hand.length === 2 && st.playableIds.length) await emit(bot.s, 'player:shout', {});
    let r;
    if (st.playableIds.length) r = await emit(bot.s, 'player:play', { cardId: st.playableIds[0], color: 'blue' });
    else if (st.canPass) r = await emit(bot.s, 'player:pass', {});
    else r = await emit(bot.s, 'player:draw', {});
    assert.ok(r.ok, r.error);
    await new Promise((res) => setTimeout(res, 15));
    moves++;
  }
  assert.strictEqual(tvState.phase, 'finished');
  const winner = tvState.players.find((p) => p.id === tvState.winnerId);
  assert.strictEqual(winner.wins, 1);
  console.log(`server: live round finished in ${moves} moves — ${winner.name} won`);

  // reconnect keeps the seat
  bots[1].s.disconnect();
  const again = io(URL, { transports: ['websocket'] });
  const rj = await emit(again, 'player:join', { code: created.code, playerId: bots[1].id });
  assert.ok(rj.ok && rj.playerId === bots[1].id, 'rejoin keeps the same seat');
  console.log('server: reconnect keeps the same player');

  // hosted online: the QR code must follow the website address, not the laptop's Wi-Fi
  const hostedTv = io(URL, { transports: ['websocket'], extraHeaders: { 'x-forwarded-host': 'last-card.onrender.com', 'x-forwarded-proto': 'https' } });
  const hostedState = new Promise((r) => hostedTv.once('update-tv', r));
  await emit(hostedTv, 'tv:create', {});
  const hs = await hostedState;
  assert.ok(hs.joinUrl.startsWith('https://last-card.onrender.com/j/'), hs.joinUrl);
  assert.strictEqual(hs.hostLabel, 'last-card.onrender.com');
  assert.ok(tvState.joinUrl.startsWith('http://') && !tvState.joinUrl.includes('localhost') || !tvState.hostLabel, 'laptop QR uses the Wi-Fi address');
  console.log(`server: hosted QR -> ${hs.joinUrl}; laptop QR -> ${tvState.joinUrl}`);
  hostedTv.close();

  for (const b of bots) b.s.close();
  again.close(); tv.close(); server.close();
  console.log('\nAll checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
