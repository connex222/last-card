/* Last Card — shared card component (TV + phone). Exposes window.LC. */
(function () {
  'use strict';

  const COLOR_HEX = { red: '#dc2626', yellow: '#facc15', green: '#16a34a', blue: '#2563eb' };
  const COLOR_SOFT = { red: 'rgba(220,38,38,.42)', yellow: 'rgba(250,204,21,.36)', green: 'rgba(22,163,74,.45)', blue: 'rgba(37,99,235,.45)' };
  const COLOR_NAME = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
  // Shape markers so colour-blind players can tell colours apart.
  const COLOR_MARK = { red: '●', yellow: '★', green: '▲', blue: '■' };
  const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
  const VALUE_ORDER = { skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14 };

  const ICON = {
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 18.4 5.6"/></svg>',
    reverse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13l-4-4"/><path d="M20 15H7l4 4"/></svg>',
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function faceFor(card) {
    switch (card.value) {
      case 'skip': return { face: ICON.skip, corner: ICON.skip, cls: '' };
      case 'reverse': return { face: ICON.reverse, corner: ICON.reverse, cls: '' };
      case 'draw2': return { face: '+2', corner: '+2', cls: 'lc-small' };
      case 'wild': return { face: '', corner: 'W', cls: '' };
      case 'wild4': return { face: '+4', corner: '+4', cls: '' };
      default: return { face: `<span>${card.value}</span>`, corner: card.value, cls: card.value === '6' || card.value === '9' ? 'lc-underline' : '' };
    }
  }

  function label(card) {
    const names = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
    if (card.color === 'wild') return names[card.value];
    return `${COLOR_NAME[card.color]} ${names[card.value] || card.value}`;
  }

  /** Returns card HTML. opts: { tag, extraClass, attrs } */
  function renderCard(card, opts = {}) {
    const tag = opts.tag || 'div';
    const f = faceFor(card);
    const mark = card.color !== 'wild' ? `<span class="lc-mark">${COLOR_MARK[card.color]}</span>` : '';
    return `<${tag} class="lc-card lc-${card.color} ${opts.extraClass || ''}" data-id="${card.id}" aria-label="${label(card)}" ${opts.attrs || ''}>
      <span class="lc-oval"></span>
      <span class="lc-face ${f.cls}">${f.face}</span>
      <span class="lc-corner lc-tl ${f.cls === 'lc-underline' ? 'lc-underline' : ''}"><span class="lc-num">${f.corner}</span>${mark}</span>
      <span class="lc-corner lc-br ${f.cls === 'lc-underline' ? 'lc-underline' : ''}"><span class="lc-num">${f.corner}</span></span>
    </${tag}>`;
  }

  function renderBack(extraClass = '') {
    return `<div class="lc-card lc-back ${extraClass}" aria-hidden="true">
      <span class="lc-oval"></span>
      <span class="lc-face">LAST<br>CARD</span>
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

  window.LC = { COLOR_HEX, COLOR_SOFT, COLOR_NAME, COLOR_MARK, renderCard, renderBack, tiltFor, sortHand, label, escapeHtml };
})();
