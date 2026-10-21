/* Last Card — shared card component (TV + phone). Exposes window.LC. */
(function () {
  'use strict';

  // Day colours, then Eclipse's Night colours.
  const COLOR_HEX = {
    red: '#e0283f', yellow: '#f4c430', green: '#12a876', blue: '#2e6ff0',
    violet: '#a874ff', teal: '#22d3c5', pink: '#ff4f9a', orange: '#ff8c1a',
  };
  const COLOR_SOFT = {
    red: 'rgba(224,40,63,.42)', yellow: 'rgba(244,196,48,.36)', green: 'rgba(18,168,118,.45)', blue: 'rgba(46,111,240,.45)',
    violet: 'rgba(168,116,255,.45)', teal: 'rgba(34,211,197,.4)', pink: 'rgba(255,79,154,.42)', orange: 'rgba(255,140,26,.42)',
  };
  const COLOR_NAME = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', violet: 'Violet', teal: 'Teal', pink: 'Pink', orange: 'Orange' };
  // Shape markers so colour-blind players can tell colours apart.
  const COLOR_MARK = { red: '●', yellow: '★', green: '▲', blue: '■', violet: '◆', teal: '✚', pink: '♥', orange: '✦' };
  const LIGHT = new Set(['yellow', 'teal', 'orange']); // colours that need dark text on top
  const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, violet: 4, teal: 5, pink: 6, orange: 7, wild: 8 };
  const VALUE_ORDER = { draw1: 10, skip: 11, skipall: 11.5, reverse: 12, draw2: 13, draw5: 13.5, bomb: 14, eclipse: 15, wild: 16, wild2: 17, wild4: 18, wilddrain: 19 };
  const NAMES = {
    skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four', bomb: 'Bomb',
    draw1: 'Draw One', draw5: 'Draw Five', skipall: 'Skip Everyone', eclipse: 'Eclipse', wild2: 'Wild Draw Two', wilddrain: 'Wild Draw Until',
  };

  const ICON = {
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 18.4 5.6"/></svg>',
    skipall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5"/><path d="M4.5 19.5 19.5 4.5"/></svg>',
    bomb: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="10" cy="14" r="7.2"/><path d="M14.6 8.4 17 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M17.5 5.2c.9-1.7 2.6-2 3.6-1.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7.6" cy="11.6" r="1.6" fill="#fff" opacity=".55"/></svg>',
    reverse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13l-4-4"/><path d="M20 15H7l4 4"/></svg>',
    // a sun with the moon sliding across it
    eclipse: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></g><circle cx="12" cy="12" r="6.2" fill="currentColor"/><circle cx="14.6" cy="10.4" r="5.4" style="fill:var(--oval,#fbf6e8)"/></svg>',
    drain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 3v11"/><path d="m7 9.5 5 5 5-5"/><path d="M5 20h14"/></svg>',
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function faceFor(card) {
    switch (card.value) {
      case 'skip': return { face: ICON.skip, corner: ICON.skip, cls: '' };
      case 'skipall': return { face: ICON.skipall, corner: ICON.skipall, cls: '' };
      case 'reverse': return { face: ICON.reverse, corner: ICON.reverse, cls: '' };
      case 'bomb': return { face: ICON.bomb, corner: ICON.bomb, cls: '' };
      case 'eclipse': return { face: ICON.eclipse, corner: ICON.eclipse, cls: '' };
      case 'draw1': return { face: '+1', corner: '+1', cls: 'lc-small' };
      case 'draw2': return { face: '+2', corner: '+2', cls: 'lc-small' };
      case 'draw5': return { face: '+5', corner: '+5', cls: 'lc-small' };
      case 'wild': return { face: '', corner: 'W', cls: '' };
      case 'wild2': return { face: '+2', corner: '+2', cls: '' };
      case 'wild4': return { face: '+4', corner: '+4', cls: '' };
      case 'wilddrain': return { face: ICON.drain, corner: ICON.drain, cls: '' };
      default: return { face: `<span>${card.value}</span>`, corner: card.value, cls: card.value === '6' || card.value === '9' ? 'lc-underline' : '' };
    }
  }

  function label(card) {
    if (card.color === 'wild') return NAMES[card.value];
    return `${COLOR_NAME[card.color]} ${NAMES[card.value] || card.value}`;
  }

  /** Returns card HTML. opts: { tag, extraClass, attrs } */
  function renderCard(card, opts = {}) {
    const tag = opts.tag || 'div';
    const f = faceFor(card);
    const night = card.side === 'night' ? 'lc-n' : '';
    const mark = card.color !== 'wild' ? `<span class="lc-mark">${COLOR_MARK[card.color]}</span>` : '';
    return `<${tag} class="lc-card lc-${card.color} ${night} ${opts.extraClass || ''}" data-id="${card.id}" aria-label="${label(card)}" ${opts.attrs || ''}>
      <span class="lc-oval"></span>
      <span class="lc-face ${f.cls}">${f.face}</span>
      <span class="lc-corner lc-tl ${f.cls === 'lc-underline' ? 'lc-underline' : ''}"><span class="lc-num">${f.corner}</span>${mark}</span>
      <span class="lc-corner lc-br ${f.cls === 'lc-underline' ? 'lc-underline' : ''}"><span class="lc-num">${f.corner}</span></span>
    </${tag}>`;
  }

  /** Card back. side 'night' gives Eclipse's moonlit back. */
  function renderBack(extraClass = '', side = 'day') {
    return `<div class="lc-card lc-back ${side === 'night' ? 'lc-back-n' : ''} ${extraClass}" aria-hidden="true">
      <span class="lc-oval"></span>
      <span class="lc-face">Last<br>Card</span>
    </div>`;
  }

  /** Stable small tilt per card so the discard pile looks hand-thrown. */
  function tiltFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return ((Math.abs(h) % 25) - 12);
  }

  function sortHand(hand) {
    const v = (c) => (c.value in VALUE_ORDER ? VALUE_ORDER[c.value] : Number(c.value));
    return [...hand].sort((a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || v(a) - v(b));
  }

  const isLight = (color) => LIGHT.has(color);

  window.LC = { COLOR_HEX, COLOR_SOFT, COLOR_NAME, COLOR_MARK, renderCard, renderBack, tiltFor, sortHand, label, escapeHtml, isLight };
})();
