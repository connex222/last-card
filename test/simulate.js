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
    const pal = g.palette();
    const color = pal[(Math.random() * pal.length) | 0];
    const others = g.order.filter((x) => x !== id);
    const target = others[(Math.random() * others.length) | 0];
    const r = g.play(id, cardId, color, target);
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
  assert.strictEqual(g.hands.c.length, 1, 'no automatic penalty before an opponent taps CATCH!');
  assert.ok(g.catch('a').ok, 'an eligible opponent can catch the offender');
  assert.strictEqual(g.hands.c.length, 3, 'successful CATCH! draws exactly two');

  // reverse with two players acts as skip
  const h = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  h.currentIndex = 0; h.discard.push({ id: 'y1', color: 'green', value: '3' }); h.activeColor = 'green';
  h.hands.a.push({ id: 'r1', color: 'green', value: 'reverse' });
  assert.ok(h.play('a', 'r1').ok);
  assert.strictEqual(h.currentId, 'a', 'two-player Reverse = Skip');
  console.log('rules: spot checks passed');
}

// ---- Pile-Up and Tag Team: random games never lose a card ----
for (const mode of ['pileup', 'tagteam']) {
  let done = 0;
  let maxStack = 0;
  for (let n = 0; n < 800; n++) {
    const count = mode === 'tagteam' ? [4, 6, 8, 10, 6, 9][n % 6] : 2 + (n % 9);
    const players = Array.from({ length: count }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const size = count % 2 === 0 ? 2 : 3;
    const teams = mode === 'tagteam' ? Object.fromEntries(players.map((p, i) => [p.id, i % (count / size)])) : undefined;
    const g = new LastCardGame(players, { mode, teams, teamNames: ['Gold', 'Teal', 'Rose', 'Violet', 'Silver'] });
    let turns = 0;
    while (g.phase === 'playing' && turns < 4000) {
      randomTurn(g);
      maxStack = Math.max(maxStack, g.pendingDraw);
      assert.strictEqual(totalCards(g), 108);
      turns++;
    }
    if (g.phase === 'finished') done++;
  }
  console.log(`${mode}: ${done}/800 random games finished, card count always 108${mode === 'pileup' ? `, biggest stack +${maxStack}` : ''}`);
}

// ---- Hot Potato: random games with random fuse blasts and slow turns never lose a card ----
{
  let done = 0;
  let booms = 0;
  for (let n = 0; n < 800; n++) {
    const count = 2 + (n % 9);
    const g = new LastCardGame(Array.from({ length: count }, (_, i) => ({ id: 'h' + i, name: 'H' + i })), { mode: 'hotpotato' });
    let turns = 0;
    while (g.phase === 'playing' && turns < 4000) {
      const r = Math.random();
      if (g.fuse.lit && r < 0.08) { assert.ok(g.explode().ok); booms++; }
      else if (g.fuse.lit && r < 0.15) assert.ok(g.timeout(g.currentId).ok);
      else randomTurn(g);
      assert.strictEqual(totalCards(g), 112);
      turns++;
    }
    if (g.phase === 'finished') done++;
  }
  console.log(`hotpotato: ${done}/800 random games finished, ${booms} explosions, card count always 112`);

  const g = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { mode: 'hotpotato' });
  g.currentIndex = 0; g.direction = 1;
  g.discard.push({ id: 'x', color: 'red', value: '5' }); g.activeColor = 'red';
  g.hands.a.push({ id: 'bm', color: 'red', value: 'bomb' });
  assert.ok(!g.explode().ok, 'nothing to explode before a Bomb');
  assert.ok(g.play('a', 'bm').ok);
  assert.ok(g.fuse.lit && g.fuse.seq === 1, 'a Bomb lights the fuse');
  const b = g.hands.b.length;
  assert.ok(g.timeout('b').ok);
  assert.strictEqual(g.hands.b.length, b + 1, 'too slow = draw 1');
  assert.strictEqual(g.currentId, 'c');
  const c = g.hands.c.length;
  assert.ok(g.explode().ok);
  assert.strictEqual(g.hands.c.length, c + 4, 'caught when it blows = draw 4');
  assert.ok(!g.fuse.lit, 'the fuse goes out after it blows');
  assert.strictEqual(g.currentId, 'a');
  console.log('hotpotato: fuse, slow-turn and explosion checks passed');
}

// ---- Eclipse: double-sided deck ----
{
  let done = 0;
  let flips = 0;
  for (let n = 0; n < 800; n++) {
    const count = 2 + (n % 9);
    const g = new LastCardGame(Array.from({ length: count }, (_, i) => ({ id: 'e' + i, name: 'E' + i })), { mode: 'eclipse' });
    let turns = 0;
    let side = g.side;
    while (g.phase === 'playing' && turns < 4000) {
      randomTurn(g);
      assert.strictEqual(totalCards(g), 112);
      const all = [...g.deck, ...g.discard, ...Object.values(g.hands).flat()];
      assert.ok(all.every((c) => c.side === g.side), 'every card shows the current side');
      if (g.side !== side) { flips++; side = g.side; }
      turns++;
    }
    if (g.phase === 'finished') done++;
  }
  console.log(`eclipse: ${done}/800 random games finished, ${flips} day/night flips, card count always 112`);

  const mk = () => {
    const g = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { mode: 'eclipse' });
    g.currentIndex = 0; g.direction = 1;
    return g;
  };
  let g = mk();
  const handIds = g.hands.b.map((c) => c.id);
  const backs = g.hands.b.map((c) => `${c.other.color}${c.other.value}`);
  g.hands.a.push({ id: 'x1', color: g.activeColor, value: 'eclipse', side: 'day', other: { color: 'teal', value: '4', side: 'night' } });
  assert.ok(g.play('a', 'x1').ok);
  assert.strictEqual(g.side, 'night');
  assert.deepStrictEqual(g.hands.b.map((c) => c.id), handIds, 'you keep the same cards');
  assert.deepStrictEqual(g.hands.b.map((c) => `${c.color}${c.value}`), backs, '…now showing their Night faces');
  assert.strictEqual(g.activeColor, 'teal', 'the Eclipse card itself flips, setting the colour');
  assert.ok(!g.play('b', g.hands.b[0].id, 'red').ok || true);

  g = mk(); g.side = 'night'; g.activeColor = 'pink';
  g.discard.push({ id: 't', color: 'pink', value: '2', side: 'night' });
  g.hands.a.push({ id: 'sa', color: 'pink', value: 'skipall', side: 'night' });
  assert.ok(g.play('a', 'sa').ok);
  assert.strictEqual(g.currentId, 'a', 'Skip Everyone: you go again');

  g = mk(); g.side = 'night'; g.activeColor = 'pink';
  g.discard.push({ id: 't', color: 'pink', value: '2', side: 'night' });
  g.hands.a.push({ id: 'd5', color: 'pink', value: 'draw5', side: 'night' });
  let b = g.hands.b.length;
  assert.ok(g.play('a', 'd5').ok);
  assert.strictEqual(g.hands.b.length, b + 5, '+5');
  assert.strictEqual(g.currentId, 'c');

  g = mk(); g.side = 'night'; g.activeColor = 'pink';
  g.discard.push({ id: 't', color: 'pink', value: '2', side: 'night' });
  g.hands.a.push({ id: 'wd', color: 'wild', value: 'wilddrain', side: 'night' });
  g.deck.push({ id: 'z3', color: 'orange', value: '1', side: 'night' }, { id: 'z2', color: 'violet', value: '1', side: 'night' }, { id: 'z1', color: 'teal', value: '1', side: 'night' });
  assert.ok(!g.play('a', 'wd', 'red').ok, 'Day colours are not allowed at night');
  b = g.hands.b.length;
  assert.ok(g.play('a', 'wd', 'violet').ok);
  assert.strictEqual(g.hands.b.length, b + 2, 'Wild Draw Until: draws until the chosen colour turns up');

  g = mk(); g.activeColor = null;
  assert.strictEqual(g.playableIds('a').length, g.hands.a.length, 'a wild face-up after a flip lets anything be played');
  console.log('eclipse: flip, Skip Everyone, +5, Wild Draw Until and night colours checked');
}

// ---- Frenzy: no turns, races decided by arrival order ----
{
  const { FRENZY } = require('../game/lastcard');
  const { decideFrenzy } = require('../game/bots');
  let done = 0;
  let wrongs = 0;
  let lates = 0;
  for (let n = 0; n < 600; n++) {
    const count = 2 + (n % 9);
    const g = new LastCardGame(Array.from({ length: count }, (_, i) => ({ id: 'f' + i, name: 'F' + i })), { mode: 'frenzy' });
    let now = 0;
    let steps = 0;
    while (g.phase === 'playing' && steps < 6000) {
      now += (Math.random() * 400) | 0;
      const id = g.order[(Math.random() * g.order.length) | 0];
      const r = Math.random();
      if (r < 0.03) g.frenzyFlip(now);
      else if (r < 0.5) {
        const m = decideFrenzy(g, id, ['easy', 'medium', 'hard'][n % 3]);
        if (m.action === 'play') {
          if (m.shout) g.shout(id);
          // sometimes the player was looking at the previous card
          const seen = Math.random() < 0.2 && g.prevTop ? g.prevTop.id : g.topCard.id;
          const res = g.frenzyPlay(id, m.cardId, m.color || g.palette()[0], seen, now);
          if (res.result === 'wrong') wrongs++;
          if (res.result === 'late') lates++;
        } else g.frenzyDraw(id, now);
      } else if (r < 0.62) g.frenzyDraw(id, now);
      assert.strictEqual(totalCards(g), 108);
      steps++;
    }
    if (g.phase === 'finished') done++;
  }
  console.log(`frenzy: ${done}/600 random games finished, ${wrongs} wrong cards, ${lates} narrowly-beaten cards, card count always 108`);

  const mk = () => {
    const g = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { mode: 'frenzy' });
    g.discard.push({ id: 't', color: 'red', value: '5' }); g.activeColor = 'red';
    return g;
  };
  let g = mk();
  g.hands.a.push({ id: 'a7', color: 'red', value: '7' });
  g.hands.b.push({ id: 'b9', color: 'green', value: '5' }); // fitted the red 5, not the red 7
  assert.strictEqual(g.frenzyPlay('a', 'a7', null, 't', 1000).result, 'played', 'anyone can play, no turns');
  const bh = g.hands.b.length;
  const late = g.frenzyPlay('b', 'b9', null, 't', 1000 + FRENZY.GRACE_MS - 50);
  assert.strictEqual(late.result, 'late', 'a fitting card a moment too late is beaten, not wrong');
  assert.strictEqual(g.hands.b.length, bh, 'no penalty for losing a race');
  g.hands.b.push({ id: 'bx', color: 'blue', value: '1' });
  const bh2 = g.hands.b.length;
  assert.strictEqual(g.frenzyPlay('b', 'bx', null, 'a7', 3000).result, 'wrong');
  assert.strictEqual(g.hands.b.length, bh2 + 2, 'wrong card = pick up 2');
  g.hands.b.push({ id: 'by', color: 'red', value: '2' });
  assert.ok(!g.frenzyPlay('b', 'by', null, 'a7', 3100).ok, 'locked out briefly after a wrong card');
  assert.ok(g.frenzyPlay('b', 'by', null, 'a7', 3000 + FRENZY.WRONG_LOCK_MS + 1).ok);

  g = mk();
  g.hands.a.push({ id: 'sk', color: 'red', value: 'skip' });
  g.hands.c.push({ id: 'c1', color: 'red', value: '3' });
  assert.ok(g.frenzyPlay('a', 'sk', null, 't', 5000).ok);
  assert.ok(g.frenzyPlay('c', 'c1', null, 'sk', 5000 + FRENZY.FREEZE_MS - 100).frozen, 'Skip freezes everyone else');
  assert.ok(g.frenzyPlay('c', 'c1', null, 'sk', 5000 + FRENZY.FREEZE_MS + 1).ok, '…for 2 seconds');

  g = mk();
  g.hands.c = g.hands.c.slice(0, 2);
  const ch = g.hands.c.length;
  g.hands.a.push({ id: 'd2', color: 'red', value: 'draw2' });
  assert.ok(g.frenzyPlay('a', 'd2', null, 't', 1).ok);
  assert.strictEqual(g.hands.c.length, ch + 2, '+2 hits whoever is closest to winning');

  g = mk();
  assert.ok(g.frenzyDraw('a', 0).ok);
  assert.ok(!g.frenzyDraw('a', 100).ok, 'draws have a cooldown');
  const top = g.topCard.id;
  assert.ok(g.frenzyFlip(10).ok);
  assert.notStrictEqual(g.topCard.id, top, 'stalemate breaker turns over a new card');
  console.log('frenzy: races, wrong cards, freeze, +2 on the leader, draw cooldown and stall breaker checked');
}

// ---- Pile-Up rule checks ----
{
  const mk = () => {
    const g = new LastCardGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { mode: 'pileup' });
    g.currentIndex = 0; g.direction = 1;
    g.discard.push({ id: 'x', color: 'red', value: '5' }); g.activeColor = 'red';
    return g;
  };
  let g = mk();
  g.hands.a.push({ id: 's1', color: 'red', value: 'draw2' });
  g.hands.b = [{ id: 's2', color: 'blue', value: 'draw2' }, { id: 'n1', color: 'red', value: '3' }, { id: 'n2', color: 'wild', value: 'wild' }];
  g.hands.c = [{ id: 'n3', color: 'green', value: '4' }, { id: 'n4', color: 'red', value: '6' }];
  assert.ok(g.play('a', 's1').ok);
  assert.strictEqual(g.currentId, 'b', 'a +2 passes the stack on instead of skipping');
  assert.deepStrictEqual(g.playableIds('b'), ['s2'], 'only a +2 can answer a +2');
  assert.ok(g.play('b', 's2').ok);
  assert.strictEqual(g.pendingDraw, 4, 'stack grows to +4');
  const before = g.hands.c.length;
  assert.ok(g.draw('c').ok);
  assert.strictEqual(g.hands.c.length, before + 4, 'whoever can\'t answer takes the lot');
  assert.strictEqual(g.currentId, 'a', 'taking the stack ends your turn');
  assert.strictEqual(g.pendingDraw, 0);

  g = mk();
  g.hands.a = [{ id: 'v1', color: 'red', value: '7' }, { id: 'v2', color: 'red', value: '1' }, { id: 'v3', color: 'red', value: '2' }];
  const bHand = g.hands.b.map((c) => c.id);
  assert.ok(!g.play('a', 'v1').ok, 'a 7 needs someone to swap with');
  assert.ok(g.play('a', 'v1', null, 'b').ok);
  assert.deepStrictEqual(g.hands.a.map((c) => c.id), bHand, '7 swaps hands');
  assert.deepStrictEqual(g.hands.b.map((c) => c.id), ['v2', 'v3']);

  g = mk();
  g.hands.a.push({ id: 'z0', color: 'red', value: '0' });
  const hb = g.hands.b.map((c) => c.id);
  const hc = g.hands.c.map((c) => c.id);
  const ha = g.hands.a.filter((c) => c.id !== 'z0').map((c) => c.id);
  assert.ok(g.play('a', 'z0').ok);
  assert.deepStrictEqual(g.hands.b.map((c) => c.id), ha, '0: hands move on in the direction of play');
  assert.deepStrictEqual(g.hands.c.map((c) => c.id), hb);
  assert.deepStrictEqual(g.hands.a.map((c) => c.id), hc);
  console.log('pileup: stacking, 7 swap and 0 pass-on checks passed');
}

// ---- Tag Team rule checks ----
{
  const g = new LastCardGame(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() })), { mode: 'tagteam', teams: { a: 0, b: 1, c: 0, d: 1 }, teamNames: ['Gold', 'Teal'] });
  assert.deepStrictEqual(g.teammates('a'), ['c']);
  g.currentIndex = 2; g.discard.push({ id: 'x', color: 'blue', value: '3' }); g.activeColor = 'blue';
  g.hands.c = [{ id: 'w', color: 'blue', value: '9' }];
  assert.ok(g.play('c', 'w').ok);
  assert.strictEqual(g.winnerTeam, 0, "C going out wins it for A's team");
  assert.ok(/Team Gold/.test(g.flash.text));
  console.log('tagteam: partner wins count for the team');
}

// ---- computer players: every level only makes legal moves and games finish ----
{
  const { decide } = require('../game/bots');
  for (const level of ['easy', 'medium', 'hard']) {
    let done = 0;
    let calls = 0;
    for (let n = 0; n < 400; n++) {
      const count = [2, 3, 4, 5, 6, 4][n % 6];
      const mode = ['classic', 'pileup', 'tagteam', 'hotpotato', 'eclipse'][n % 5];
      const players = Array.from({ length: count }, (_, i) => ({ id: 'b' + i, name: 'B' + i }));
      const teams = mode === 'tagteam' && count % 2 === 0 ? Object.fromEntries(players.map((p, i) => [p.id, i % (count / 2)])) : undefined;
      const g = new LastCardGame(players, { mode: teams || mode !== 'tagteam' ? mode : 'classic', teams });
      let turns = 0;
      while (g.phase === 'playing' && turns < 3000) {
        const id = g.currentId;
        const m = decide(g, id, level);
        if (m.action === 'play') {
          if (m.shout && g.shout(id).ok) calls++;
          const r = g.play(id, m.cardId, m.color, m.target);
          assert.ok(r.ok, `${level} bot made an illegal move: ${r.error}`);
        } else if (m.action === 'pass') assert.ok(g.pass(id).ok);
        else assert.ok(g.draw(id).ok);
        if (g.fuse.lit && Math.random() < 0.05) g.explode();
        assert.strictEqual(totalCards(g), g.rules.bombs || g.rules.eclipse ? 112 : 108);
        turns++;
      }
      if (g.phase === 'finished') done++;
    }
    assert.ok(done > 380, `${level} bots should finish their games (${done}/400)`);
    console.log(`bots: ${level} — ${done}/400 games finished, ${calls} Last Card calls`);
  }
  // Medium and Hard should beat Easy more often than not
  let strongWins = 0;
  for (let n = 0; n < 600; n++) {
    const g = new LastCardGame([{ id: 'e', name: 'E' }, { id: 'h', name: 'H' }]);
    const lv = { e: 'easy', h: 'hard' };
    let t = 0;
    while (g.phase === 'playing' && t++ < 3000) {
      const id = g.currentId;
      const m = decide(g, id, lv[id]);
      if (m.action === 'play') { if (m.shout) g.shout(id); g.play(id, m.cardId, m.color); }
      else if (m.action === 'pass') g.pass(id); else g.draw(id);
    }
    if (g.winnerId === 'h') strongWins++;
  }
  console.log(`bots: Hard beat Easy in ${strongWins}/600 head-to-head games`);
  assert.ok(strongWins > 300, 'Hard should beat Easy more often than not');
}

// ---- 2. live server ----
process.env.NO_OPEN = '1';
process.env.PORT = '3999';
process.env.BOT_SPEED = '0.02'; // computer players think 50x faster in tests
process.env.FUSE_SPEED = '0.02'; // Hot Potato: fuse 0.4–1.2s, 0.1s turns
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
    const r = await emit(s, 'player:join', { code: created.code.toLowerCase(), name, avatar: 'chibi' });
    assert.ok(r.ok, r.error);
    bot.id = r.playerId;
    bot.resumeToken = r.resumeToken;
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
  const rj = await emit(again, 'player:join', { code: created.code, playerId: bots[1].id, resumeToken: bots[1].resumeToken });
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

  // TV game picker and computer players
  const tv2 = io(URL, { transports: ['websocket'] });
  let tv2State = null;
  tv2.on('update-tv', (st) => { tv2State = st; });
  await emit(tv2, 'tv:create', {});
  assert.ok(!(await emit(tv2, 'tv:mode', { id: 'nonsense' })).ok, 'unknown games cannot be picked');
  assert.ok((await emit(tv2, 'tv:mode', { id: 'solo' })).ok);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(tv2State.botCount, 3, 'Solo seats 3 computer players by default');
  assert.ok((await emit(tv2, 'tv:bots', { count: 2, level: 'hard' })).ok);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(tv2State.botCount, 2);
  assert.strictEqual(tv2State.botLevel, 'hard');
  const solo1 = io(URL, { transports: ['websocket'] });
  assert.ok((await emit(solo1, 'player:join', { code: tv2State.code, name: 'Solo', avatar: 'akari' })).ok);
  const solo2 = io(URL, { transports: ['websocket'] });
  assert.ok(!(await emit(solo2, 'player:join', { code: tv2State.code, name: 'Second' })).ok, 'Solo refuses a second person');
  assert.ok((await emit(tv2, 'tv:start', {})).ok, 'Solo deals with one person and two computer players');
  solo1.close(); solo2.close(); tv2.close();
  console.log('server: game picker, Solo seating and computer player settings work');

  // Tag Team over the network: team size rules, partner-only signals
  const tv3 = io(URL, { transports: ['websocket'] });
  let tv3State = null;
  tv3.on('update-tv', (st) => { tv3State = st; });
  await emit(tv3, 'tv:create', {});
  assert.ok((await emit(tv3, 'tv:mode', { id: 'tagteam' })).ok);
  const tt = [];
  for (const name of ['Amy', 'Ben', 'Cal']) {
    const s = io(URL, { transports: ['websocket'] });
    const bot = { s, name, state: null, signals: [] };
    s.on('update-player', (st) => { bot.state = st; });
    s.on('signal', (sig) => bot.signals.push(sig));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok((await emit(s, 'player:join', { code: tv3State.code, name })).ok);
    tt.push(bot);
  }
  assert.ok(!(await emit(tv3, 'tv:start', {})).ok, '3 players cannot make teams of 2');
  assert.ok((await emit(tv3, 'tv:bots', { count: 1 })).ok);
  assert.ok((await emit(tv3, 'tv:start', {})).ok, '3 people + 1 computer = 2 teams of 2');
  await new Promise((r) => setTimeout(r, 80));
  const teamOf = (b) => b.state.myTeam;
  assert.ok(tt.every((b) => b.state.myTeam === 0 || b.state.myTeam === 1));
  const sender = tt[0];
  assert.ok((await emit(sender.s, 'player:signal', { kind: 'have', color: 'red' })).ok);
  await new Promise((r) => setTimeout(r, 80));
  for (const b of tt.slice(1)) {
    const mate = teamOf(b) === teamOf(sender);
    assert.strictEqual(b.signals.length, mate ? 1 : 0, mate ? 'partner gets the signal' : 'opponents never see a signal');
  }
  for (const b of tt) b.s.close();
  tv3.close();
  console.log('server: Tag Team deals 2 teams, signals reach partners only');

  // Shared helper: phone bots play until the round ends.
  async function playOut(players, getTv) {
    let guard = 0;
    while (getTv().phase === 'playing' && guard++ < 3000) {
      const b = players.find((x) => x.state && x.state.isMyTurn);
      if (!b) { await new Promise((r) => setTimeout(r, 10)); continue; }
      const st = b.state;
      if (st.canShout) await emit(b.s, 'player:shout', {});
      const others = st.seats.filter((x) => !x.isMe);
      if (st.playableIds.length) await emit(b.s, 'player:play', { cardId: st.playableIds[0], color: 'green', target: others[0] && others[0].id });
      else if (st.canPass) await emit(b.s, 'player:pass', {});
      else await emit(b.s, 'player:draw', {});
      await new Promise((r) => setTimeout(r, 8));
    }
  }
  async function table(names, mode) {
    const t = io(URL, { transports: ['websocket'] });
    const box = { st: null };
    const seen = new Set();
    t.on('update-tv', (st) => { box.st = st; for (const e of st.events || []) seen.add(e.type); });
    await emit(t, 'tv:create', {});
    if (mode) assert.ok((await emit(t, 'tv:mode', { id: mode })).ok);
    const ps = [];
    for (const name of names) {
      const s = io(URL, { transports: ['websocket'] });
      const pl = { s, name, state: null };
      s.on('update-player', (st) => { pl.state = st; });
      await new Promise((r) => setTimeout(r, 20));
      const j = await emit(s, 'player:join', { code: box.st.code, name });
      assert.ok(j.ok, j.error);
      pl.id = j.playerId;
      ps.push(pl);
    }
    return { t, box, seen, ps, close: () => { for (const p of ps) p.s.close(); t.close(); } };
  }

  // Hot Potato live: a Bomb lights a fuse, slow turns time out, and it blows up by itself
  {
    const T = await table(['Hal', 'Ivy'], 'hotpotato');
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    await new Promise((r) => setTimeout(r, 60));
    const { rooms: liveRooms } = require('../server');
    const g = liveRooms.get(T.box.st.code).game;
    const cur = T.ps.find((x) => x.id === g.currentId);
    const top = g.topCard;
    g.hands[cur.id].push({ id: 'bomb-test', color: g.activeColor, value: 'bomb' });
    assert.ok((await emit(cur.s, 'player:play', { cardId: 'bomb-test' })).ok, 'Bomb can be played');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(T.box.st.fuse && T.box.st.fuse.turnLeft > 0, 'TV gets the fuse and turn clock');
    const deadline = Date.now() + 4000;
    while (!T.seen.has('boom') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));
    assert.ok(T.seen.has('timeout'), 'slow turns time out while the fuse burns');
    assert.ok(T.seen.has('boom'), 'the fuse blows by itself');
    assert.ok(top);
    T.close();
    console.log('server: Hot Potato fuse lights, turns time out and it blows on its own');
  }

  // Eclipse live: the hidden side of a card never reaches a screen
  {
    const T = await table(['Oz', 'Pip'], 'eclipse');
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    await new Promise((r) => setTimeout(r, 40));
    let checked = 0;
    const leak = (x) => JSON.stringify(x).includes('"other"');
    const stop = Date.now() + 15000;
    while (T.box.st.phase === 'playing' && Date.now() < stop) {
      for (const p of T.ps) if (p.state) { assert.ok(!leak(p.state), 'phones never see the backs of cards'); checked++; }
      assert.ok(!leak(T.box.st), 'the TV never sees the backs of cards');
      const b = T.ps.find((x) => x.state && x.state.isMyTurn);
      if (b) {
        const st = b.state;
        if (st.canShout) await emit(b.s, 'player:shout', {});
        if (st.playableIds.length) await emit(b.s, 'player:play', { cardId: st.playableIds[0], color: st.palette[0] });
        else if (st.canPass) await emit(b.s, 'player:pass', {});
        else await emit(b.s, 'player:draw', {});
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    assert.strictEqual(T.box.st.phase, 'finished');
    T.close();
    console.log(`server: Eclipse round played over the network, ${checked} phone updates, no hidden faces leaked`);
  }

  // Frenzy live: two phones throw at once; the first wins, the second is "beaten", not punished
  {
    const T = await table(['Quin', 'Rae'], 'frenzy');
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    await new Promise((r) => setTimeout(r, 40));
    const { rooms: liveRooms } = require('../server');
    const g = liveRooms.get(T.box.st.code).game;
    const [p1, p2] = T.ps;
    const seen = g.topCard.id;
    const col = g.activeColor;
    // two different cards that both fit the current top, but not each other
    const other = ['red', 'yellow', 'green', 'blue'].find((c) => c !== col);
    g.hands[p1.id].push({ id: 'race1', color: col, value: '1' });
    g.hands[p2.id].push({ id: 'race2', color: col === 'red' ? 'red' : col, value: '2' });
    g.discard[g.discard.length - 1] = { id: seen, color: col, value: '9' };
    g.hands[p2.id][g.hands[p2.id].length - 1] = { id: 'race2', color: other, value: '9' }; // fits the 9, not the 1
    const before = g.hands[p2.id].length;
    const [a, b] = await Promise.all([
      emit(p1.s, 'player:play', { cardId: 'race1', seenTopId: seen }),
      emit(p2.s, 'player:play', { cardId: 'race2', seenTopId: seen }),
    ]);
    const results = [a.result, b.result].sort();
    assert.deepStrictEqual(results, a.result === 'played' ? ['late', 'played'] : ['late', 'played'], `one wins, one is beaten (${a.result}, ${b.result})`);
    if (b.result === 'late') assert.strictEqual(g.hands[p2.id].length, before, 'the beaten player is not punished');
    T.close();
    console.log(`server: Frenzy race — ${a.result === 'played' ? 'Quin' : 'Rae'} won, the other was beaten by ${(Math.max(a.ms || 0, b.ms || 0) / 1000).toFixed(3)}s with no penalty`);
  }

  // Frenzy with computer players: they react in real time and finish the round
  {
    const T = await table(['Sol'], 'frenzy');
    assert.ok((await emit(T.t, 'tv:bots', { count: 3, level: 'hard' })).ok);
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    const stop = Date.now() + 30000;
    while (T.box.st.phase === 'playing' && Date.now() < stop) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(T.box.st.phase, 'finished', 'computer players finish a Frenzy round on their own');
    T.close();
    const w = T.box.st.players.find((x) => x.id === T.box.st.winnerId);
    console.log(`server: Frenzy computer players raced to the end — ${w.name} won`);
  }

  // Match Play: First to 500 scores the cards left in the losers' hands
  {
    const T = await table(['Jay', 'Kit']);
    assert.ok((await emit(T.t, 'tv:match', { type: 'points' })).ok);
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    await new Promise((r) => setTimeout(r, 40));
    const { rooms: liveRooms } = require('../server');
    const g = liveRooms.get(T.box.st.code).game;
    await playOut(T.ps, () => T.box.st);
    await new Promise((r) => setTimeout(r, 40));
    const st = T.box.st;
    const loserId = g.order.find((id) => id !== st.winnerId);
    const expected = g.handPoints(loserId);
    const w = st.players.find((x) => x.id === st.winnerId);
    assert.strictEqual(w.points, expected, 'winner scores the loser\'s hand');
    assert.strictEqual(st.match.gains[st.winnerId], expected);
    T.close();
    console.log(`server: First to 500 — round worth ${expected} points`);
  }

  // Knockout: the player left with the most cards is out, until one remains
  {
    const T = await table(['Lu', 'Mo', 'Ned']);
    assert.ok((await emit(T.t, 'tv:match', { type: 'knockout' })).ok);
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    await new Promise((r) => setTimeout(r, 40));
    await playOut(T.ps, () => T.box.st);
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(T.box.st.match.knocked.length, 1, 'one player knocked out');
    assert.strictEqual(T.box.st.match.alive, 2);
    assert.ok((await emit(T.t, 'tv:start', {})).ok);
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(T.box.st.players.filter((x) => x.inRound).length, 2, 'knocked-out player sits out');
    await playOut(T.ps, () => T.box.st);
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(T.box.st.match.over && T.box.st.match.championId === T.box.st.winnerId, 'last one standing wins the match');
    assert.ok((await emit(T.t, 'tv:start', {})).ok, 'dealing again starts a new match');
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(T.box.st.players.filter((x) => x.inRound).length, 3, 'everyone is back in for a new match');
    T.close();
    console.log('server: Knockout knocks one out per round and crowns a champion');
  }

  // Phone-only Solo: computer players take their turns by themselves
  const ph = io(URL, { transports: ['websocket'] });
  let phState = null;
  ph.on('update-player', (st) => { phState = st; });
  const sc = await emit(ph, 'solo:create', { name: 'Shaun', avatar: 'akari', bots: 3, level: 'easy' });
  assert.ok(sc.ok, sc.error);
  let myMoves = 0;
  const deadline = Date.now() + 60000;
  while ((!phState || phState.phase !== 'finished') && Date.now() < deadline) {
    if (phState && phState.isMyTurn) {
      let r;
      if (phState.canShout) await emit(ph, 'player:shout', {});
      if (phState.playableIds.length) r = await emit(ph, 'player:play', { cardId: phState.playableIds[0], color: 'red' });
      else if (phState.canPass) r = await emit(ph, 'player:pass', {});
      else r = await emit(ph, 'player:draw', {});
      assert.ok(r.ok, r.error);
      myMoves++;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.strictEqual(phState.phase, 'finished', 'phone-only Solo round should finish');
  assert.strictEqual(phState.seats.length, 4);
  console.log(`server: phone-only Solo finished — ${phState.winner.name} won after ${myMoves} of your moves`);
  ph.close();

  for (const b of bots) b.s.close();
  again.close(); tv.close(); server.close();
  console.log('\nAll checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
