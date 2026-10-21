'use strict';
/**
 * Last Card — rules engine.
 * Pure game logic with no networking. The server owns one instance per round.
 *
 * Card shape: { id: 'c12', color: 'red'|'yellow'|'green'|'blue'|'wild', value: '0'..'9'|'skip'|'reverse'|'draw2'|'wild'|'wild4' }
 * Eclipse cards also carry side: 'day'|'night' and other: { color, value, side } — the face on the back.
 */
const crypto = require('crypto');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NIGHT_COLORS = ['violet', 'teal', 'pink', 'orange']; // Eclipse: the Night side has its own four colours
const ALL_COLORS = [...COLORS, ...NIGHT_COLORS];
const HAND_SIZE = 7;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Standard 108-card deck. Hot Potato adds one Bomb in each colour (112). */
function buildDeck(withBombs = false) {
  const deck = [];
  let n = 0;
  const add = (color, value) => deck.push({ id: 'c' + n++, color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (let v = 1; v <= 9; v++) { add(color, String(v)); add(color, String(v)); }
    for (const action of ['skip', 'reverse', 'draw2']) { add(color, action); add(color, action); }
  }
  for (let i = 0; i < 4; i++) { add('wild', 'wild'); add('wild', 'wild4'); }
  if (withBombs) for (const color of COLORS) add(color, 'bomb');
  return shuffle(deck);
}

/**
 * Eclipse: 112 double-sided cards. Every card has a Day face and a Night face, paired at random.
 *   Day:   1–9, +1, Skip, Reverse, Eclipse in red/yellow/green/blue; Wild; Wild +2
 *   Night: 1–9, +5, Skip Everyone, Reverse, Eclipse in violet/teal/pink/orange; Wild; Wild Draw Until
 */
function buildEclipseDeck() {
  const faces = (colors, actions, wilds, side) => {
    const out = [];
    for (const color of colors) {
      for (let v = 1; v <= 9; v++) { out.push({ color, value: String(v), side }); out.push({ color, value: String(v), side }); }
      for (const a of actions) { out.push({ color, value: a, side }); out.push({ color, value: a, side }); }
    }
    for (const w of wilds) for (let i = 0; i < 4; i++) out.push({ color: 'wild', value: w, side });
    return out;
  };
  const day = faces(COLORS, ['draw1', 'skip', 'reverse', 'eclipse'], ['wild', 'wild2'], 'day');
  const night = shuffle(faces(NIGHT_COLORS, ['draw5', 'skipall', 'reverse', 'eclipse'], ['wild', 'wilddrain'], 'night'));
  return shuffle(day.map((d, i) => ({ id: 'e' + i, ...d, other: night[i] })));
}

/** Eclipse: turn a card over, in place. */
function flipCard(card) {
  const { color, value, side } = card;
  Object.assign(card, card.other);
  card.other = { color, value, side };
}

/** The face everyone can see. Never send the hidden other side to a screen. */
const face = (c) => (c ? { id: c.id, color: c.color, value: c.value, ...(c.side ? { side: c.side } : {}) } : c);

const isNumber = (card) => /^[0-9]$/.test(card.value);
const DRAW_HITS = { draw1: 1, draw2: 2, wild2: 2, wild4: 4, draw5: 5 }; // cards the next player picks up
const WILD_DRAIN_MAX = 10; // Wild Draw Until: never more than this many

// Frenzy timings (ms). The server passes in the clock so the rules stay testable.
const FRENZY = {
  FREEZE_MS: 2000, //  Skip: everyone else is frozen this long
  WRONG_LOCK_MS: 1500, // after a wrong slap you can't play for this long
  DRAW_COOLDOWN_MS: 1500, // time between draws
  GRACE_MS: 600, // a valid card that arrives this soon after someone else's is "beaten", not wrong
};

const VALUE_NAMES = {
  skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four', bomb: 'Bomb',
  draw1: 'Draw One', draw5: 'Draw Five', skipall: 'Skip Everyone', eclipse: 'Eclipse', wild2: 'Wild Draw Two', wilddrain: 'Wild Draw Until',
};
const BOOM_DRAW = 4; // Hot Potato: cards for whoever is caught when the fuse blows

/** Points for the cards left in a hand (Match Play). */
function cardPoints(card) {
  if (/^[0-9]$/.test(card.value)) return Number(card.value);
  if (card.value === 'wild' || card.value === 'wild4' || card.value === 'wild2') return 50;
  if (card.value === 'wilddrain') return 60;
  if (card.value === 'draw1') return 10;
  if (card.value === 'skipall') return 30;
  return 20; // skip, reverse, draw two, bomb, draw five, eclipse
}
const COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', violet: 'Violet', teal: 'Teal', pink: 'Pink', orange: 'Orange' };
function cardName(card) {
  if (card.color === 'wild') return VALUE_NAMES[card.value];
  return `${COLOR_NAMES[card.color]} ${VALUE_NAMES[card.value] || card.value}`;
}

class LastCardGame {
  /**
   * @param {Array<{id:string,name:string}>} players in seating order
   * @param {{mode?:string, teams?:Object<string,number>, teamNames?:string[]}} [options]
   *   mode: game mode id (see game/modes.js).
   *   teams: Tag Team only — player id -> team number. Players on a team win together.
   */
  constructor(players, options = {}) {
    this.mode = options.mode || 'classic';
    // Rule switches for each game mode.
    this.rules = {
      stack: this.mode === 'pileup', // +2 on +2, +4 on +4; the total lands on whoever can't answer
      seven: this.mode === 'pileup', // a 7 swaps hands with a chosen player
      zero: this.mode === 'pileup', //  a 0 passes every hand on, in the direction of play
      bombs: this.mode === 'hotpotato', // Bomb cards light a hidden fuse; the server times it
      eclipse: this.mode === 'eclipse', // double-sided deck; Eclipse cards flip the whole game
      frenzy: this.mode === 'frenzy', // no turns: anyone can play a matching card at any moment
    };
    // Frenzy state: per-player clocks, and the card that was on top just before the latest play.
    this.frozenUntil = {};
    this.lockUntil = {};
    this.drawUntil = {};
    this.prevTop = null; // { id, color, value } of the card that was just covered
    this.topChangedAt = 0;
    this.lastPlayerId = null;
    this.side = 'day';
    // Hot Potato fuse. The engine only knows lit or not; the server owns the clock.
    // seq changes every time a Bomb lights (or re-lights) it, so the server can start a fresh secret fuse.
    this.fuse = { lit: false, seq: 0 };
    this.teams = options.teams || null;
    this.teamNames = options.teamNames || [];
    this.pendingDraw = 0; // Pile-Up: cards stacked up for the current player
    this.stackType = null; // 'draw2' | 'wild4' while a stack is building
    if (players.length < 2) throw new Error('Need at least 2 players');
    this.order = players.map((p) => p.id);
    this.names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    this.hands = Object.fromEntries(players.map((p) => [p.id, []]));
    this.called = Object.fromEntries(players.map((p) => [p.id, false]));
    this.deck = this.rules.eclipse ? buildEclipseDeck() : buildDeck(this.rules.bombs);
    this.discard = [];
    this.direction = 1;
    this.activeColor = null;
    this.pendingDrawnId = null; // card just drawn that the player may play
    this.pendingShoutId = null; // player on 1 card who has not called yet
    this.winnerId = null;
    this.turnNumber = 0;
    this.log = [];
    this.flash = null; // { id, text, tone }
    this.flashSeq = 0;
    // Animation feed for the screens: { seq, type, by, ... }. Clients replay anything newer than they've seen.
    this.events = [];
    this.eventSeq = 0;
    // Colours a player was seen to be missing (they had to draw on them). Public knowledge, used by Hard bots.
    this.lacks = Object.fromEntries(players.map((p) => [p.id, []]));

    for (let i = 0; i < HAND_SIZE; i++) {
      for (const id of this.order) this.hands[id].push(this.deck.pop());
    }
    // Start on a number card. Action cards go back into the deck at random.
    let first = this.deck.pop();
    while (!isNumber(first)) {
      this.deck.splice(crypto.randomInt(this.deck.length + 1), 0, first);
      first = this.deck.pop();
    }
    this.discard.push(first);
    this.activeColor = first.color;
    this.currentIndex = crypto.randomInt(this.order.length);
    this.addLog(this.rules.frenzy ? 'Go! Anyone can play' : `${this.currentName()} goes first`);
  }

  // ---------- helpers ----------
  get phase() { return this.winnerId ? 'finished' : 'playing'; }
  get topCard() { return this.discard[this.discard.length - 1]; }
  get currentId() { return this.order[this.currentIndex]; }
  currentName() { return this.names[this.currentId]; }
  has(playerId) { return this.order.includes(playerId); }

  addEvent(type, data = {}) {
    this.events.push({ seq: ++this.eventSeq, type, ...data });
    if (this.events.length > 12) this.events.shift();
  }

  /** Whether calling Last Card would be accepted right now. */
  canShout(playerId) {
    if (this.phase !== 'playing' || !this.hands[playerId] || this.called[playerId]) return false;
    const count = this.hands[playerId].length;
    const myTurn = this.rules.frenzy || playerId === this.currentId;
    return count === 1 || (count === 2 && myTurn && this.playableIds(playerId).length > 0);
  }

  addLog(text) {
    this.log.push(text);
    if (this.log.length > 6) this.log.shift();
  }

  /** Big on-screen announcement. `who` + `you` give that player a personal version on their phone. */
  setFlash(text, tone = 'info', who = null, you = null) {
    this.flash = { id: ++this.flashSeq, text, tone, who, you };
  }

  nextIndex(steps = 1) {
    const len = this.order.length;
    return (((this.currentIndex + this.direction * steps) % len) + len) % len;
  }

  advance(steps = 1) {
    this.currentIndex = this.nextIndex(steps);
    this.pendingDrawnId = null;
    this.turnNumber++;
  }

  /** Draw n cards for a player, reshuffling the discard pile when the deck runs out. Returns cards drawn. */
  drawCards(playerId, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) {
        if (this.discard.length <= 1) break; // every card is in someone's hand
        const top = this.discard.pop();
        this.deck = shuffle(this.discard);
        this.discard = [top];
        this.addLog('Discard pile reshuffled into the deck');
      }
      const card = this.deck.pop();
      this.hands[playerId].push(card);
      drawn.push(card);
    }
    if (drawn.length) {
      this.called[playerId] = false;
      this.addEvent('draw', { by: playerId, n: drawn.length });
    }
    return drawn;
  }

  /** The four colours in play on the current side. */
  palette() { return this.side === 'night' ? NIGHT_COLORS : COLORS; }

  canPlay(card, hand) {
    if (this.pendingDraw > 0) return card.value === this.stackType; // answer the stack, or take it
    if (!this.activeColor) return true; // Eclipse turned a wild face-up: anything goes
    const top = this.topCard;
    if (card.color === 'wild' && card.value !== 'wild4') return true; // Wild, Wild +2, Wild Draw Until
    if (card.value === 'wild4') return !hand.some((c) => c.color === this.activeColor);
    return card.color === this.activeColor || card.value === top.value;
  }

  playableIds(playerId) {
    if (this.rules.frenzy) {
      if (this.phase !== 'playing' || !this.hands[playerId]) return [];
      return this.hands[playerId].filter((c) => this.frenzyMatch(c)).map((c) => c.id);
    }
    if (this.phase !== 'playing' || playerId !== this.currentId) return [];
    const hand = this.hands[playerId];
    if (this.pendingDrawnId) {
      const card = hand.find((c) => c.id === this.pendingDrawnId);
      return card && this.canPlay(card, hand) ? [card.id] : [];
    }
    return hand.filter((c) => this.canPlay(c, hand)).map((c) => c.id);
  }

  /** Called before any player acts: punishes a player who went down to one card without calling. */
  checkShoutPenalty(actorId) {
    const target = this.pendingShoutId;
    if (!target) return;
    this.pendingShoutId = null;
    if (target === actorId || !this.hands[target] || this.hands[target].length !== 1) return;
    this.drawCards(target, 2);
    this.addEvent('penalty', { by: target });
    const msg = `${this.names[target]} forgot to call Last Card — draws 2`;
    this.addLog(msg);
    this.setFlash(msg, 'danger', target, "You forgot to call Last Card — draw 2");
  }

  // ---------- actions (each returns { ok, error? }) ----------
  /** Tag Team helpers */
  teamOf(id) { return this.teams ? this.teams[id] : undefined; }
  teammates(id) { return this.teams ? this.order.filter((x) => x !== id && this.teams[x] === this.teams[id]) : []; }
  get winnerTeam() { return this.winnerId && this.teams ? this.teams[this.winnerId] : null; }

  /** After hands move between players (7 or 0), nobody is caught out for a hand they were just given. */
  settleCalls(ids) {
    this.pendingShoutId = null;
    for (const id of ids) this.called[id] = this.hands[id].length === 1;
  }

  /** Pile-Up 7: swap hands with another player. */
  swapHands(a, b) {
    [this.hands[a], this.hands[b]] = [this.hands[b], this.hands[a]];
    this.settleCalls([a, b]);
    this.addEvent('swap', { by: a, with: b });
    this.setFlash(`${this.names[a]} swaps hands with ${this.names[b]}!`, 'info', b, `${this.names[a]} took your hand. You've got theirs`);
  }

  /** Pile-Up 0: every hand moves one seat on, in the direction of play. */
  passHands() {
    const ids = this.order;
    const len = ids.length;
    const old = ids.map((id) => this.hands[id]);
    ids.forEach((id, i) => {
      const from = ((i - this.direction) % len + len) % len; // you receive from the player before you
      this.hands[id] = old[from];
    });
    this.settleCalls(ids);
    this.addEvent('rotate', { direction: this.direction });
    this.setFlash('Everyone passes their hand on!', 'info');
  }

  play(playerId, cardId, chosenColor, targetId) {
    if (this.phase !== 'playing') return { ok: false, error: 'The round is over.' };
    if (playerId !== this.currentId) return { ok: false, error: "It's not your turn." };
    const hand = this.hands[playerId];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: "That card isn't in your hand." };
    if (!this.playableIds(playerId).includes(cardId)) return { ok: false, error: "That card can't be played now." };
    const card = hand[idx];
    if (card.color === 'wild' && !this.palette().includes(chosenColor)) return { ok: false, error: 'Pick a colour for the wild card.' };
    const swapping = this.rules.seven && card.value === '7' && hand.length > 1;
    if (swapping && (!this.order.includes(targetId) || targetId === playerId)) return { ok: false, error: 'Choose who to swap hands with.' };

    this.checkShoutPenalty(playerId);
    hand.splice(idx, 1);
    this.discard.push(card);
    this.activeColor = card.color === 'wild' ? chosenColor : card.color;
    this.lacks[playerId] = (this.lacks[playerId] || []).filter((c) => c !== this.activeColor && c !== card.color);
    this.addEvent('play', { by: playerId, card: face(card), color: this.activeColor });
    const name = this.names[playerId];
    let text = `${name} played ${cardName(card)}`;
    if (card.color === 'wild') text += ` — colour is now ${COLOR_NAMES[chosenColor]}`;

    if (hand.length === 0) {
      this.winnerId = playerId;
      this.pendingShoutId = null;
      this.addLog(text);
      this.addLog(`${name} wins the round!`);
      this.addEvent('win', { by: playerId });
      const team = this.winnerTeam;
      this.setFlash(team !== null && team !== undefined ? `Team ${this.teamNames[team] || team + 1} wins!` : `${name} wins!`, 'success');
      return { ok: true };
    }
    if (hand.length === 1 && !this.called[playerId]) this.pendingShoutId = playerId;

    const two = this.order.length === 2;
    switch (card.value) {
      case 'skip': {
        const skipped = this.names[this.order[this.nextIndex(1)]];
        this.addEvent('skip', { by: this.order[this.nextIndex(1)] });
        text += ` — ${skipped} is skipped`;
        this.advance(2);
        break;
      }
      case 'reverse':
        if (two) { text += ` — ${this.names[this.order[this.nextIndex(1)]]} is skipped`; this.advance(2); }
        else { this.direction *= -1; text += ' — direction reversed'; this.addEvent('reverse', { direction: this.direction }); this.advance(1); }
        break;
      case 'skipall':
        text += ` — everyone is skipped, ${name} goes again`;
        this.addEvent('skipall', { by: playerId });
        this.setFlash(`${name} skips everyone!`, 'warn', playerId, 'Everyone skipped. Go again!');
        this.advance(0);
        break;
      case 'eclipse':
        this.flipAll();
        text += this.side === 'night' ? ' — night falls!' : ' — dawn breaks!';
        this.advance(1);
        break;
      case 'wilddrain': {
        const victim = this.order[this.nextIndex(1)];
        let n = 0;
        let hit = false;
        while (!hit && n < WILD_DRAIN_MAX) {
          const [c] = this.drawCards(victim, 1);
          if (!c) break;
          n++;
          hit = c.color === this.activeColor;
        }
        this.addEvent('hit', { by: victim, n });
        text += ` — ${this.names[victim]} draws until ${COLOR_NAMES[this.activeColor]}: ${n} card${n === 1 ? '' : 's'}`;
        this.setFlash(`${this.names[victim]} draws ${n} hunting for ${COLOR_NAMES[this.activeColor]}!`, 'warn', victim, `You drew ${n} looking for ${COLOR_NAMES[this.activeColor]}`);
        this.advance(2);
        break;
      }
      case 'draw1':
      case 'wild2':
      case 'draw5':
      case 'draw2':
      case 'wild4': {
        const n = DRAW_HITS[card.value];
        if (this.rules.stack) {
          // Pile-Up: the next player must answer with the same card or take the whole stack.
          this.pendingDraw += n;
          this.stackType = card.value;
          const victim = this.order[this.nextIndex(1)];
          const total = this.pendingDraw;
          this.addEvent('stack', { by: victim, total });
          text += ` — ${this.names[victim]} must stack or take ${total}`;
          const answer = card.value === 'draw2' ? '+2' : '+4';
          this.setFlash(`+${total} on ${this.names[victim]}!`, 'warn', victim, `+${total} coming at you. Stack a ${answer} or take them`);
          this.advance(1);
          break;
        }
        const victim = this.order[this.nextIndex(1)];
        this.addEvent('hit', { by: victim, n });
        this.drawCards(victim, n);
        text += ` — ${this.names[victim]} draws ${n} and is skipped`;
        this.setFlash(`${this.names[victim]} draws ${n}!`, 'warn', victim, `You draw ${n} and miss your turn`);
        this.advance(2);
        break;
      }
      case '7':
        if (swapping) {
          text += ` — swaps hands with ${this.names[targetId]}`;
          this.swapHands(playerId, targetId);
        }
        this.advance(1);
        break;
      case 'bomb':
        if (this.rules.bombs) {
          const relit = this.fuse.lit;
          this.fuse = { lit: true, seq: this.fuse.seq + 1 };
          text += relit ? ' — the fuse is re-lit!' : ' — the fuse is lit!';
          this.addEvent('fuse', { by: playerId, relit });
          this.setFlash(relit ? 'Fuse re-lit! Nobody knows how long…' : 'Fuse lit! 5 seconds a turn', 'danger');
        }
        this.advance(1);
        break;
      case '0':
        if (this.rules.zero) { text += ' — everyone passes their hand on'; this.passHands(); }
        this.advance(1);
        break;
      default:
        this.advance(1);
    }
    this.addLog(text);
    return { ok: true };
  }

  // ---------- Frenzy: no turns ----------
  /** Does a card fit on the given top card (default: the real top right now)? */
  frenzyMatch(card, top = { color: this.activeColor, value: this.topCard.value }) {
    if (card.color === 'wild') return true;
    return card.color === top.color || card.value === top.value;
  }

  isFrozen(id, now) { return now < (this.frozenUntil[id] || 0); }

  /** The opponent closest to winning (fewest cards). Draw cards in Frenzy hit them. */
  leaderExcept(id) {
    const others = this.order.filter((x) => x !== id);
    return others.reduce((best, x) => (this.hands[x].length < this.hands[best].length ? x : best), others[0]);
  }

  /**
   * Someone throws a card. The server calls these in the order they arrive, so the first valid card wins.
   * @param seenTopId the top card the player was looking at when they threw
   * @returns {{ok, result?: 'played'|'late'|'wrong', error?, ms?, beatenBy?}}
   */
  frenzyPlay(playerId, cardId, chosenColor, seenTopId, now) {
    if (this.phase !== 'playing') return { ok: false, error: 'The round is over.' };
    const hand = this.hands[playerId];
    if (!hand) return { ok: false, error: "You're not in this round." };
    if (this.isFrozen(playerId, now)) return { ok: false, error: "You're frozen!", frozen: true };
    if (now < (this.lockUntil[playerId] || 0)) return { ok: false, error: 'Steady! Wait a moment after a wrong card.' };
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: "That card isn't in your hand." };
    const card = hand[idx];
    if (card.color === 'wild' && !this.palette().includes(chosenColor)) return { ok: false, error: 'Pick a colour for the wild card.' };
    const name = this.names[playerId];

    if (!this.frenzyMatch(card)) {
      // Right card, wrong moment? If it fitted the card they were looking at and someone beat them to it
      // by a whisker, that's a lost race, not a mistake.
      const prev = this.prevTop;
      if (prev && seenTopId === prev.id && now - this.topChangedAt <= FRENZY.GRACE_MS && this.frenzyMatch(card, prev)) {
        const ms = now - this.topChangedAt;
        const winner = this.names[this.lastPlayerId] || 'someone';
        this.addEvent('late', { by: playerId, beatenBy: this.lastPlayerId, ms });
        this.setFlash(`${winner} beat ${name} by ${(ms / 1000).toFixed(2)}s!`, 'info', playerId, `${winner} beat you to it by ${(ms / 1000).toFixed(2)}s`);
        return { ok: true, result: 'late', ms, beatenBy: winner };
      }
      // A card that doesn't fit: pick up 2 and wait.
      this.checkShoutPenalty(playerId);
      this.drawCards(playerId, 2);
      this.lockUntil[playerId] = now + FRENZY.WRONG_LOCK_MS;
      this.addEvent('wrong', { by: playerId });
      this.addLog(`${name} played a card that doesn't fit — picks up 2`);
      this.setFlash(`Wrong card! ${name} picks up 2`, 'danger', playerId, "That doesn't fit! Pick up 2");
      return { ok: true, result: 'wrong' };
    }

    this.checkShoutPenalty(playerId);
    const top = this.topCard;
    this.prevTop = { id: top.id, color: this.activeColor, value: top.value };
    this.topChangedAt = now;
    this.lastPlayerId = playerId;
    hand.splice(idx, 1);
    this.discard.push(card);
    this.activeColor = card.color === 'wild' ? chosenColor : card.color;
    this.addEvent('play', { by: playerId, card: face(card), color: this.activeColor });
    this.turnNumber++;
    let text = `${name} played ${cardName(card)}`;
    if (card.color === 'wild') text += ` — colour is now ${COLOR_NAMES[chosenColor]}`;

    if (hand.length === 0) {
      this.winnerId = playerId;
      this.pendingShoutId = null;
      this.addLog(text);
      this.addLog(`${name} wins the round!`);
      this.addEvent('win', { by: playerId });
      this.setFlash(`${name} wins!`, 'success');
      return { ok: true, result: 'played' };
    }
    if (hand.length === 1 && !this.called[playerId]) this.pendingShoutId = playerId;

    if (card.value === 'skip') {
      for (const id of this.order) if (id !== playerId) this.frozenUntil[id] = now + FRENZY.FREEZE_MS;
      text += ' — everyone else is frozen';
      this.addEvent('freeze', { by: playerId, ms: FRENZY.FREEZE_MS });
      this.setFlash(`${name} freezes everyone!`, 'info', playerId, 'Everyone else is frozen. Go go go!');
    } else if (card.value === 'draw2' || card.value === 'wild4') {
      const n = card.value === 'draw2' ? 2 : 4;
      const victim = this.leaderExcept(playerId);
      this.addEvent('hit', { by: victim, n });
      this.drawCards(victim, n);
      text += ` — ${this.names[victim]}, the closest to winning, draws ${n}`;
      this.setFlash(`${this.names[victim]} draws ${n}!`, 'warn', victim, `You're closest to winning, so you draw ${n}`);
    }
    this.addLog(text);
    return { ok: true, result: 'played' };
  }

  /** Frenzy: take a card, any time you like, but not too often. */
  frenzyDraw(playerId, now) {
    if (this.phase !== 'playing' || !this.hands[playerId]) return { ok: false };
    if (this.isFrozen(playerId, now)) return { ok: false, error: "You're frozen!" };
    if (now < (this.drawUntil[playerId] || 0)) return { ok: false, error: 'Wait a moment before drawing again.' };
    this.checkShoutPenalty(playerId);
    const [card] = this.drawCards(playerId, 1);
    if (!card) return { ok: false, error: 'No cards left to draw.' };
    this.drawUntil[playerId] = now + FRENZY.DRAW_COOLDOWN_MS;
    this.addLog(`${this.names[playerId]} drew a card`);
    return { ok: true, drawnId: card.id };
  }

  /** Frenzy: nobody has played for a while, so a card comes off the deck onto the pile. */
  frenzyFlip(now) {
    if (this.phase !== 'playing') return { ok: false };
    if (!this.deck.length) {
      if (this.discard.length <= 1) return { ok: false };
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = [top];
    }
    const top = this.topCard;
    this.prevTop = { id: top.id, color: this.activeColor, value: top.value };
    this.topChangedAt = now;
    this.lastPlayerId = null;
    const card = this.deck.pop();
    this.discard.push(card);
    const pal = this.palette();
    this.activeColor = card.color === 'wild' ? pal[crypto.randomInt(pal.length)] : card.color;
    this.turnNumber++;
    this.addEvent('flip', { card: face(card) });
    this.addLog(`Nobody could go, so ${cardName(card)} comes off the deck`);
    this.setFlash('All quiet! A new card from the deck', 'info');
    return { ok: true };
  }

  /** Eclipse: every card in the game turns over, and the table switches between Day and Night. */
  flipAll() {
    for (const c of this.deck) flipCard(c);
    for (const c of this.discard) flipCard(c);
    for (const id of Object.keys(this.hands)) for (const c of this.hands[id]) flipCard(c);
    this.side = this.side === 'day' ? 'night' : 'day';
    const top = this.topCard;
    this.activeColor = top.color === 'wild' ? null : top.color;
    for (const id of Object.keys(this.lacks)) this.lacks[id] = [];
    this.pendingDrawnId = null;
    this.addEvent('eclipse', { side: this.side });
    this.setFlash(this.side === 'night' ? 'Eclipse! Night falls' : 'Dawn breaks! Back to Day', 'info');
  }

  /** Hot Potato: the fuse ran out. Whoever's turn it is draws 4 and the fuse goes out. */
  explode() {
    if (this.phase !== 'playing' || !this.fuse.lit) return { ok: false };
    const id = this.currentId;
    this.fuse = { lit: false, seq: this.fuse.seq };
    this.pendingDrawnId = null;
    this.checkShoutPenalty(id);
    this.addEvent('boom', { by: id });
    this.drawCards(id, BOOM_DRAW);
    const msg = `BOOM! ${this.names[id]} draws ${BOOM_DRAW}`;
    this.addLog(msg);
    this.setFlash(msg, 'danger', id, `BOOM! It blew up on you. Draw ${BOOM_DRAW}`);
    this.advance(1);
    return { ok: true };
  }

  /** Hot Potato: the 5-second turn clock ran out. Draw one card (unless you just drew) and move on. */
  timeout(playerId) {
    if (this.phase !== 'playing' || playerId !== this.currentId) return { ok: false };
    this.checkShoutPenalty(playerId);
    const drew = !this.pendingDrawnId;
    if (drew) this.drawCards(playerId, 1);
    this.addEvent('timeout', { by: playerId });
    const msg = `Too slow! ${this.names[playerId]}${drew ? ' draws 1' : ' keeps their card'}`;
    this.addLog(msg);
    this.setFlash(msg, 'warn', playerId, drew ? 'Too slow! Draw 1' : 'Too slow! Turn over');
    this.advance(1);
    return { ok: true };
  }

  /** Points left in everyone's hands, used by Match Play. */
  handPoints(playerId) {
    return (this.hands[playerId] || []).reduce((n, c) => n + cardPoints(c), 0);
  }

  /** Pile-Up: give up on the stack and pick up every card in it. */
  takeStack(playerId) {
    const n = this.pendingDraw;
    this.pendingDraw = 0;
    this.stackType = null;
    this.checkShoutPenalty(playerId);
    this.addEvent('hit', { by: playerId, n });
    this.drawCards(playerId, n);
    const msg = `${this.names[playerId]} takes ${n}`;
    this.addLog(`${msg} and misses a turn`);
    this.setFlash(`${msg}!`, 'danger', playerId, `You take ${n}`);
    this.advance(1);
    return { ok: true };
  }

  draw(playerId) {
    if (this.phase !== 'playing') return { ok: false, error: 'The round is over.' };
    if (playerId !== this.currentId) return { ok: false, error: "It's not your turn." };
    if (this.pendingDraw > 0) return this.takeStack(playerId); // taking the stack is always allowed
    if (this.pendingDrawnId) return { ok: false, error: 'Play the card you drew or keep it.' };
    if (this.playableIds(playerId).length) return { ok: false, error: 'You have a card you can play.' };

    this.checkShoutPenalty(playerId);
    const lacking = this.activeColor;
    if (lacking && !this.lacks[playerId].includes(lacking)) this.lacks[playerId].push(lacking);
    const [card] = this.drawCards(playerId, 1);
    const name = this.names[playerId];
    if (!card) {
      this.addLog(`${name} couldn't draw — no cards left — and passes`);
      this.advance(1);
      return { ok: true };
    }
    if (this.canPlay(card, this.hands[playerId])) {
      this.pendingDrawnId = card.id;
      this.addLog(`${name} drew a card`);
    } else {
      this.addLog(`${name} drew a card and passes`);
      this.advance(1);
    }
    return { ok: true, drawnId: card.id };
  }

  pass(playerId) {
    if (playerId !== this.currentId || !this.pendingDrawnId) return { ok: false, error: 'You can only keep a card you just drew.' };
    this.addLog(`${this.names[playerId]} kept the card and passes`);
    this.advance(1);
    return { ok: true };
  }

  /** Call "Last Card": allowed on 1 card, or on 2 cards during your turn when you can play one. */
  shout(playerId) {
    if (this.phase !== 'playing' || !this.hands[playerId]) return { ok: false };
    const count = this.hands[playerId].length;
    const preCall = count === 2 && (this.rules.frenzy || playerId === this.currentId) && this.playableIds(playerId).length > 0;
    if (!(count === 1 || preCall) || this.called[playerId]) return { ok: false };
    this.called[playerId] = true;
    this.addEvent('shout', { by: playerId });
    if (this.pendingShoutId === playerId) this.pendingShoutId = null;
    const msg = `${this.names[playerId]}: Last card!`;
    this.addLog(msg);
    this.setFlash(msg, 'warn', playerId, 'You called Last Card!');
    return { ok: true };
  }

  /** Used when the current player is disconnected: draw one card and move on. */
  autoSkip(playerId) {
    if (this.phase !== 'playing' || playerId !== this.currentId) return { ok: false };
    if (this.pendingDraw > 0) return this.takeStack(playerId);
    this.checkShoutPenalty(playerId);
    if (!this.pendingDrawnId) this.drawCards(playerId, 1);
    this.addLog(`${this.names[playerId]} is away — draws and passes`);
    this.advance(1);
    return { ok: true };
  }

  /** Remove a player mid-round. Their cards go back into the deck. */
  removePlayer(playerId) {
    const idx = this.order.indexOf(playerId);
    if (idx === -1) return;
    const wasCurrent = idx === this.currentIndex;
    this.deck.push(...this.hands[playerId]);
    shuffle(this.deck);
    const name = this.names[playerId];
    delete this.hands[playerId];
    delete this.lacks[playerId];
    this.order.splice(idx, 1);
    if (this.pendingShoutId === playerId) this.pendingShoutId = null;
    this.addLog(`${name} left the game`);

    if (this.phase !== 'playing') return;
    const oneTeamLeft = this.teams && new Set(this.order.map((id) => this.teams[id])).size === 1;
    if (this.order.length === 1 || oneTeamLeft) {
      this.winnerId = this.order[0];
      this.currentIndex = 0;
      const team = this.winnerTeam;
      const who = team !== null && team !== undefined ? `Team ${this.teamNames[team] || team + 1}` : this.names[this.winnerId];
      this.addLog(`${who} wins — everyone else left`);
      this.setFlash(`${who} wins!`, 'success');
      return;
    }
    if (idx < this.currentIndex) this.currentIndex--;
    if (this.currentIndex >= this.order.length) this.currentIndex = 0;
    if (wasCurrent) {
      // The seat after the leaver is now at the same index going clockwise.
      if (this.direction === -1) this.currentIndex = ((idx - 1) % this.order.length + this.order.length) % this.order.length;
      this.pendingDrawnId = null;
      this.turnNumber++;
    }
  }
}

module.exports = { FRENZY, face, LastCardGame, COLORS, NIGHT_COLORS, ALL_COLORS, COLOR_NAMES, cardName, buildDeck, buildEclipseDeck, isNumber, cardPoints, BOOM_DRAW };
