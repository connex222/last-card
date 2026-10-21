'use strict';
/**
 * Last Card — computer players.
 * Bots only see what a real player could see: their own hand, the table, everyone's card counts,
 * and which colours other players have been seen drawing on.
 *
 *   easy   — plays any legal card at random, picks wild colours at random, forgets Last Card 1 time in 3
 *   medium — keeps wilds for when it's stuck, attacks a player who is close to winning, picks its strongest colour
 *   hard   — medium, plus picks colours the next player is known to be missing and never forgets to call
 */

const BOTS = [
  { name: 'Croupier', avatar: '🎩' },
  { name: 'Duchess', avatar: '👑' },
  { name: 'High Roller', avatar: '🎲' },
  { name: 'Maestro', avatar: '🎷' },
  { name: 'Velvet', avatar: '🍸' },
  { name: 'Ace', avatar: '🃏' },
  { name: 'Baron', avatar: '🦚' },
  { name: 'Countess', avatar: '💎' },
  { name: 'Dealer Dan', avatar: '🎰' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ATTACKS = ['skip', 'draw2', 'wild4', 'draw1', 'wild2', 'draw5', 'wilddrain'];
const isAction = (c) => ATTACKS.includes(c.value) || c.value === 'reverse';

function colourCounts(hand, palette) {
  const n = Object.fromEntries(palette.map((c) => [c, 0]));
  for (const c of hand) if (n[c.color] !== undefined) n[c.color]++;
  return n;
}

function chooseColour(game, id, level, without) {
  const COLORS = game.palette();
  if (level === 'easy') return pick(COLORS);
  const hand = game.hands[id].filter((c) => c.id !== without);
  const counts = colourCounts(hand, COLORS);
  const score = { ...counts };
  if (level === 'hard') {
    const nextId = game.order[game.nextIndex(1)];
    for (const c of game.lacks[nextId] || []) score[c] += 1.5; // make them draw
  }
  const best = Math.max(...COLORS.map((c) => score[c]));
  return pick(COLORS.filter((c) => score[c] === best));
}

const opponents = (game, id) => game.order.filter((x) => x !== id && !game.teammates(id).includes(x));

/** Pile-Up 7: swap with the opponent holding the fewest cards. */
function swapTarget(game, id) {
  const opp = opponents(game, id);
  const pool = opp.length ? opp : game.order.filter((x) => x !== id);
  return pool.reduce((best, x) => (game.hands[x].length < game.hands[best].length ? x : best), pool[0]);
}

function rank(game, id, level, card) {
  const hand = game.hands[id];
  const counts = colourCounts(hand, game.palette());
  const nextId = game.order[game.nextIndex(1)];
  const nextCount = game.hands[nextId] ? game.hands[nextId].length : 7;
  const nextIsPartner = game.teammates(id).includes(nextId);
  let s = 0;
  if (card.color === 'wild') s -= card.value === 'wild' ? 20 : 30; // save wilds for when you're stuck
  else s += counts[card.color] * 2; // stay in your strongest colour
  if (isAction(card)) s += nextCount <= 2 ? 25 : level === 'hard' ? -4 : 2; // attack a near-winner, otherwise hold
  if (/^[0-9]$/.test(card.value)) s += Number(card.value) / 10; // shed high numbers first
  if (level === 'hard' && card.color !== 'wild' && (game.lacks[nextId] || []).includes(card.color)) s += 6;
  if (hand.length === 2 && card.color === 'wild') s += 40; // go out with a wild in hand to finish on
  if (nextIsPartner && ATTACKS.includes(card.value)) s -= 35; // don't hit your partner
  if (card.value === 'skipall') s += hand.length > 2 ? 10 : 2; // a free extra turn
  if (card.value === 'eclipse') s += level === 'hard' ? (nextCount <= 2 ? 20 : -6) : 0; // flip to scramble a near-winner
  if (card.value === 'bomb') s += level === 'easy' ? 0 : 4; // get rid of bombs: chaos favours whoever has fewer cards
  if (game.rules.seven && card.value === '7' && hand.length > 1) {
    const t = swapTarget(game, id);
    s += (hand.length - 1 - game.hands[t].length) * 3; // only worth it for a smaller hand
  }
  if (game.rules.zero && card.value === '0') {
    const prev = game.order[((game.currentIndex - game.direction) % game.order.length + game.order.length) % game.order.length];
    s += (hand.length - 1 - game.hands[prev].length) * 2; // you receive the hand of the player before you
  }
  return s;
}

/**
 * Decide the bot's next action.
 * @returns {{action:'play', cardId:string, color:string|null, shout:boolean} | {action:'draw'} | {action:'pass'}}
 */
function decide(game, id, level = 'medium') {
  const playable = game.playableIds(id);
  const hand = game.hands[id];
  if (!playable.length) return game.pendingDrawnId ? { action: 'pass' } : { action: 'draw' }; // 'draw' also takes a Pile-Up stack

  let cardId;
  if (level === 'easy') cardId = pick(playable);
  else {
    const cards = playable.map((pid) => hand.find((c) => c.id === pid));
    cards.sort((a, b) => rank(game, id, level, b) - rank(game, id, level, a));
    cardId = cards[0].id;
  }
  const card = hand.find((c) => c.id === cardId);
  const forgets = level === 'easy' ? Math.random() < 0.33 : level === 'medium' ? Math.random() < 0.08 : false;
  return {
    action: 'play',
    cardId,
    color: card.color === 'wild' ? chooseColour(game, id, level, cardId) : null,
    target: game.rules.seven && card.value === '7' ? (level === 'easy' ? pick(game.order.filter((x) => x !== id)) : swapTarget(game, id)) : null,
    shout: hand.length === 2 && !forgets,
  };
}

/**
 * Frenzy: no turns, so a bot simply reacts to whatever is on top.
 * Easy bots now and then slap down a card that doesn't fit.
 */
function decideFrenzy(game, id, level = 'medium') {
  const hand = game.hands[id];
  const playable = game.playableIds(id);
  if (level === 'easy' && Math.random() < 0.06 && hand.length > playable.length) {
    const wrong = pick(hand.filter((c) => !playable.includes(c.id)));
    return { action: 'play', cardId: wrong.id, color: wrong.color === 'wild' ? pick(game.palette()) : null, shout: false };
  }
  if (!playable.length) return { action: 'draw' };
  let cardId = pick(playable);
  if (level !== 'easy') {
    const cards = playable.map((pid) => hand.find((c) => c.id === pid));
    const counts = colourCounts(hand, game.palette());
    const score = (c) => (c.color === 'wild' ? -10 : counts[c.color] * 2) + (c.value === 'skip' ? 6 : 0) + (['draw2', 'wild4'].includes(c.value) ? 4 : 0);
    cards.sort((x, y) => score(y) - score(x));
    cardId = cards[0].id;
  }
  const card = hand.find((c) => c.id === cardId);
  const forgets = level === 'easy' ? Math.random() < 0.33 : level === 'medium' ? Math.random() < 0.08 : false;
  return { action: 'play', cardId, color: card.color === 'wild' ? chooseColour(game, id, level, cardId) : null, shout: hand.length === 2 && !forgets };
}

/** Frenzy reaction time, in ms. */
function reactTime(level) {
  const speed = Number(process.env.BOT_SPEED) || 1;
  const [lo, hi] = level === 'easy' ? [1800, 3600] : level === 'hard' ? [650, 1400] : [1100, 2300];
  return Math.round((lo + Math.random() * (hi - lo)) * speed);
}

/** How long the bot "thinks" before acting, in ms. */
function thinkTime(level, hurry = false) {
  const speed = Number(process.env.BOT_SPEED) || 1; // tests set this low
  if (hurry) {
    // Hot Potato: 5 seconds a turn. Easy bots sometimes dither too long.
    const [lo, hi] = level === 'easy' ? [1500, 5600] : level === 'hard' ? [700, 1800] : [1000, 3200];
    return Math.round((lo + Math.random() * (hi - lo)) * speed);
  }
  const base = level === 'easy' ? 1100 : level === 'hard' ? 1500 : 1300;
  return Math.round((base + Math.floor(Math.random() * 700)) * speed);
}

module.exports = { BOTS, decide, thinkTime, decideFrenzy, reactTime };
