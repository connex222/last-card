'use strict';
/**
 * Last Card — game modes.
 * One list shared by the server (rules + limits) and both screens (picker tiles).
 * `ready: false` modes show on the picker as "Coming soon" and can't be chosen yet.
 *
 * accent = the mode's colour inside the Midnight Lounge look.
 */
const MODES = [
  {
    id: 'classic',
    name: 'Classic',
    tagline: 'The original. Match the colour or the number.',
    rules: ['Match colour, number or symbol', 'Wilds change the colour', 'Call Last Card on your final card'],
    players: '2–10 players',
    accent: '#d9b45a',
    icon: '♠',
    ready: true,
  },
  {
    id: 'solo',
    name: 'Solo',
    tagline: 'You against the house. Classic rules, computer opponents.',
    rules: ['One player, 1–5 computer players', 'Easy, Medium or Hard', 'Play on the TV or just your phone'],
    players: '1 player',
    accent: '#b9c7e6',
    icon: '♟',
    ready: true,
    solo: true,
  },
  {
    id: 'pileup',
    name: 'Pile-Up',
    tagline: 'Stack the +2s and +4s. Swap hands on a 7.',
    rules: ['+2 on +2, +4 on +4', '7 swaps hands, 0 passes them all on', 'The stack lands on whoever can’t answer'],
    players: '2–10 players',
    accent: '#ff7a3d',
    icon: '♨',
    ready: true,
  },
  {
    id: 'tagteam',
    name: 'Tag Team',
    tagline: 'Partners sit apart and win together.',
    rules: ['Teams of 2 or 3, seated alternately', 'Send your partner quick signals', 'Either partner going out wins it'],
    players: '4–10 players',
    accent: '#5ec8c0',
    icon: '♣',
    ready: true,
    teams: true,
    minPlayers: 4,
  },
  {
    id: 'hotpotato',
    name: 'Hot Potato',
    tagline: 'A Bomb lights a secret fuse. Don’t be holding the turn when it blows.',
    rules: ['Bomb cards light a hidden fuse', '5 seconds a turn while it burns', 'Caught when it blows: draw 4'],
    players: '2–10 players',
    accent: '#ff4d4d',
    icon: '✹',
    ready: true,
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    tagline: 'Every card has a Day side and a Night side.',
    rules: ['Eclipse cards flip the whole game', 'Night side hits much harder', 'The table turns from day to night'],
    players: '2–10 players',
    accent: '#a98bff',
    icon: '☾',
    ready: true,
  },
  {
    id: 'frenzy',
    name: 'Frenzy',
    tagline: 'No turns. Fastest matching card wins the play.',
    rules: ['Anyone can play at any moment', 'Fastest matching card wins the race', 'Wrong card: pick up 2', 'Skip freezes everyone else'],
    players: '2–10 players',
    accent: '#7dff8a',
    icon: '⚡',
    ready: true,
  },
];

const BOT_LEVELS = ['easy', 'medium', 'hard'];

/** Tag Team: team names and colours, in the order teams are dealt. */
const TEAMS = [
  { name: 'Gold', color: '#e6bf5c' },
  { name: 'Teal', color: '#4fd1c5' },
  { name: 'Rose', color: '#ff8fa3' },
  { name: 'Violet', color: '#a98bff' },
  { name: 'Silver', color: '#c8d2e6' },
];

/** Match Play: how rounds add up. */
const MATCH_TYPES = [
  { id: 'single', name: 'Single rounds', short: 'Single' },
  { id: 'points', name: 'First to 500', short: 'First to 500' },
  { id: 'knockout', name: 'Knockout', short: 'Knockout' },
];
const MATCH_TARGET = 500;

/** Partner signals in Tag Team. 'have' carries a colour. */
const SIGNALS = {
  have: 'I’ve got {color}',
  hold: 'Hold back, I’m nearly out',
  help: 'Help, I’m stuck',
};

const getMode = (id) => MODES.find((m) => m.id === id) || MODES[0];

module.exports = { MODES, BOT_LEVELS, TEAMS, SIGNALS, MATCH_TYPES, MATCH_TARGET, getMode };
