'use strict';
/**
 * Last Card — rules engine.
 * Pure game logic with no networking. The server owns one instance per round.
 *
 * Card shape: { id: 'c12', color: 'red'|'yellow'|'green'|'blue'|'wild', value: '0'..'9'|'skip'|'reverse'|'draw2'|'wild'|'wild4' }
 */
const crypto = require('crypto');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const HAND_SIZE = 7;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck() {
  const deck = [];
  let n = 0;
  const add = (color, value) => deck.push({ id: 'c' + n++, color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (let v = 1; v <= 9; v++) { add(color, String(v)); add(color, String(v)); }
    for (const action of ['skip', 'reverse', 'draw2']) { add(color, action); add(color, action); }
  }
  for (let i = 0; i < 4; i++) { add('wild', 'wild'); add('wild', 'wild4'); }
  return shuffle(deck); // 108 cards
}

const isNumber = (card) => /^[0-9]$/.test(card.value);

const VALUE_NAMES = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
const COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
function cardName(card) {
  if (card.color === 'wild') return VALUE_NAMES[card.value];
  return `${COLOR_NAMES[card.color]} ${VALUE_NAMES[card.value] || card.value}`;
}

class LastCardGame {
  /**
   * @param {Array<{id:string,name:string}>} players in seating order
   */
  constructor(players) {
    if (players.length < 2) throw new Error('Need at least 2 players');
    this.order = players.map((p) => p.id);
    this.names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    this.hands = Object.fromEntries(players.map((p) => [p.id, []]));
    this.called = Object.fromEntries(players.map((p) => [p.id, false]));
    this.deck = buildDeck();
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
    this.addLog(`${this.currentName()} goes first`);
  }

  // ---------- helpers ----------
  get phase() { return this.winnerId ? 'finished' : 'playing'; }
  get topCard() { return this.discard[this.discard.length - 1]; }
  get currentId() { return this.order[this.currentIndex]; }
  currentName() { return this.names[this.currentId]; }
  has(playerId) { return this.order.includes(playerId); }

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
    if (drawn.length) this.called[playerId] = false;
    return drawn;
  }

  canPlay(card, hand) {
    const top = this.topCard;
    if (card.value === 'wild') return true;
    if (card.value === 'wild4') return !hand.some((c) => c.color === this.activeColor);
    return card.color === this.activeColor || card.value === top.value;
  }

  playableIds(playerId) {
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
    const msg = `${this.names[target]} forgot to call Last Card — draws 2`;
    this.addLog(msg);
    this.setFlash(msg, 'danger', target, "You forgot to call Last Card — draw 2");
  }

  // ---------- actions (each returns { ok, error? }) ----------
  play(playerId, cardId, chosenColor) {
    if (this.phase !== 'playing') return { ok: false, error: 'The round is over.' };
    if (playerId !== this.currentId) return { ok: false, error: "It's not your turn." };
    const hand = this.hands[playerId];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: "That card isn't in your hand." };
    if (!this.playableIds(playerId).includes(cardId)) return { ok: false, error: "That card can't be played now." };
    const card = hand[idx];
    if (card.color === 'wild' && !COLORS.includes(chosenColor)) return { ok: false, error: 'Pick a colour for the wild card.' };

    this.checkShoutPenalty(playerId);
    hand.splice(idx, 1);
    this.discard.push(card);
    this.activeColor = card.color === 'wild' ? chosenColor : card.color;
    const name = this.names[playerId];
    let text = `${name} played ${cardName(card)}`;
    if (card.color === 'wild') text += ` — colour is now ${COLOR_NAMES[chosenColor]}`;

    if (hand.length === 0) {
      this.winnerId = playerId;
      this.pendingShoutId = null;
      this.addLog(text);
      this.addLog(`${name} wins the round!`);
      this.setFlash(`${name} wins!`, 'success');
      return { ok: true };
    }
    if (hand.length === 1 && !this.called[playerId]) this.pendingShoutId = playerId;

    const two = this.order.length === 2;
    switch (card.value) {
      case 'skip': {
        const skipped = this.names[this.order[this.nextIndex(1)]];
        text += ` — ${skipped} is skipped`;
        this.advance(2);
        break;
      }
      case 'reverse':
        if (two) { text += ` — ${this.names[this.order[this.nextIndex(1)]]} is skipped`; this.advance(2); }
        else { this.direction *= -1; text += ' — direction reversed'; this.advance(1); }
        break;
      case 'draw2':
      case 'wild4': {
        const n = card.value === 'draw2' ? 2 : 4;
        const victim = this.order[this.nextIndex(1)];
        this.drawCards(victim, n);
        text += ` — ${this.names[victim]} draws ${n} and is skipped`;
        this.setFlash(`${this.names[victim]} draws ${n}!`, 'warn', victim, `You draw ${n} and miss your turn`);
        this.advance(2);
        break;
      }
      default:
        this.advance(1);
    }
    this.addLog(text);
    return { ok: true };
  }

  draw(playerId) {
    if (this.phase !== 'playing') return { ok: false, error: 'The round is over.' };
    if (playerId !== this.currentId) return { ok: false, error: "It's not your turn." };
    if (this.pendingDrawnId) return { ok: false, error: 'Play the card you drew or keep it.' };
    if (this.playableIds(playerId).length) return { ok: false, error: 'You have a card you can play.' };

    this.checkShoutPenalty(playerId);
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
    const preCall = count === 2 && playerId === this.currentId && this.playableIds(playerId).length > 0;
    if (!(count === 1 || preCall) || this.called[playerId]) return { ok: false };
    this.called[playerId] = true;
    if (this.pendingShoutId === playerId) this.pendingShoutId = null;
    const msg = `${this.names[playerId]}: Last card!`;
    this.addLog(msg);
    this.setFlash(msg, 'warn', playerId, 'You called Last Card!');
    return { ok: true };
  }

  /** Used when the current player is disconnected: draw one card and move on. */
  autoSkip(playerId) {
    if (this.phase !== 'playing' || playerId !== this.currentId) return { ok: false };
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
    this.order.splice(idx, 1);
    if (this.pendingShoutId === playerId) this.pendingShoutId = null;
    this.addLog(`${name} left the game`);

    if (this.phase !== 'playing') return;
    if (this.order.length === 1) {
      this.winnerId = this.order[0];
      this.currentIndex = 0;
      this.addLog(`${this.names[this.winnerId]} wins — everyone else left`);
      this.setFlash(`${this.names[this.winnerId]} wins!`, 'success');
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

module.exports = { LastCardGame, COLORS, cardName, buildDeck };
