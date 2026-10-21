/* Shared Last Card avatar library.
 * 16 polished cartoon/anime-inspired portrait avatars used by phone, TV and lobby views.
 */
(() => {
  'use strict';

  const defs = [
    { id: 'akari', name: 'Ace', image: '/assets/avatars/ace.webp' },
    { id: 'blaze', name: 'Blaze', image: '/assets/avatars/blaze.webp' },
    { id: 'chibi', name: 'Sunny', image: '/assets/avatars/sunny.webp' },
    { id: 'dusk', name: 'Atlas', image: '/assets/avatars/atlas.webp' },
    { id: 'ember', name: 'Velvet', image: '/assets/avatars/velvet.webp' },
    { id: 'frost', name: 'Cipher', image: '/assets/avatars/cipher.webp' },
    { id: 'glimmer', name: 'Zara', image: '/assets/avatars/zara.webp' },
    { id: 'halo', name: 'Bingo', image: '/assets/avatars/bingo.webp' },
    { id: 'iris', name: 'Willow', image: '/assets/avatars/willow.webp' },
    { id: 'jinx', name: 'Jinx', image: '/assets/avatars/jinx.webp' },
    { id: 'kitsu', name: 'Riff', image: '/assets/avatars/riff.webp' },
    { id: 'luna', name: 'Luna', image: '/assets/avatars/luna.webp' },
    { id: 'nova', name: 'Dash', image: '/assets/avatars/dash.webp' },
    { id: 'onyx', name: 'Mirage', image: '/assets/avatars/mirage.webp' },
    { id: 'pixel', name: 'Pixel', image: '/assets/avatars/pixel.webp' },
    { id: 'sora', name: 'Maple', image: '/assets/avatars/maple.webp' },
  ];

  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
  const ids = defs.map((d) => d.id);
  const valid = new Set(ids);

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function hairPath(style, color) {
    const fill = `fill="${color}"`;
    const common = {
      bob: `<path ${fill} d="M24 43c-2-20 9-30 24-30 18 0 26 10 24 31-4-6-11-11-24-11-9 0-18 4-24 10Z"/><path ${fill} d="M28 30c-4 8-5 18-3 28l7-10-1-18Zm40 0c4 8 5 19 3 28l-8-10 1-18Z"/>`,
      long: `<path ${fill} d="M22 46c-3-24 12-33 28-33 18 0 28 10 24 34-4-8-15-12-25-12-10 0-21 4-27 11Z"/><path ${fill} d="M24 44c-2 18 2 28 9 34h-9c-4-8-5-21 0-34Zm48 0c2 17-2 28-8 34h10c4-8 5-21-2-34Z"/>`,
      twin: `<path ${fill} d="M23 45c-2-22 9-32 25-32 17 0 27 9 24 32-5-8-15-12-24-12-10 0-19 4-25 12Z"/><circle cx="16" cy="36" r="9" ${fill}/><circle cx="80" cy="36" r="9" ${fill}/>`,
      bun: `<circle cx="28" cy="20" r="9" ${fill}/><circle cx="68" cy="20" r="9" ${fill}/><path ${fill} d="M24 46c-2-20 10-31 24-31s26 10 24 31c-6-7-15-11-24-11-10 0-18 4-24 11Z"/>`,
      short: `<path ${fill} d="M26 44c0-18 11-30 25-30 16 0 24 9 23 28-6-5-14-8-23-8-9 0-17 3-25 10Z"/>`,
      wavy: `<path ${fill} d="M23 46c0-20 11-32 25-32 18 0 26 9 25 31-5-7-12-11-24-11-12 0-20 5-26 12Z"/><path ${fill} d="M26 47c-1 11 2 22 8 31-8-2-12-10-12-18 0-5 1-9 4-13Zm44 0c2 4 4 8 4 13 0 9-5 16-12 18 6-9 9-20 8-31Z"/>`,
      pixie: `<path ${fill} d="M25 43c2-18 14-28 27-28 13 0 22 7 22 25-7-4-13-6-22-6-10 0-18 3-27 9Z"/><path ${fill} d="M53 15c8 0 15 4 18 12l-7-1 3 8c-4-4-9-7-14-8Z"/>`,
      ponytail: `<path ${fill} d="M26 44c0-19 12-30 26-30 17 0 24 9 22 29-4-6-13-9-23-9-9 0-17 3-25 10Z"/><path ${fill} d="M74 29c8 3 12 10 9 19-2 8-8 12-15 14 3-7 3-15 0-24Z"/>`,
      sharp: `<path ${fill} d="M22 45c1-18 13-31 29-31 18 0 25 10 23 29-6-5-14-8-24-8-11 0-19 3-28 10Z"/><path ${fill} d="M44 13 34 28l13-5 3 10 8-14-10 3Z"/>`,
      messy: `<path ${fill} d="M23 45c1-20 11-31 25-31 16 0 26 10 25 30-6-7-14-11-25-11-10 0-18 4-25 12Z"/><path ${fill} d="M26 24 36 18l-2 10 11-7 3 10 9-9 5 10 9-6-6-8c-4-4-10-6-18-6-10 0-17 4-21 12Z"/>`,
      braid: `<path ${fill} d="M24 45c0-20 12-31 25-31 17 0 26 9 23 30-5-7-14-11-24-11-10 0-18 4-24 12Z"/><path ${fill} d="M29 46c-1 12 1 24 6 32l7-1-3-6 5-2-3-6 4-2-4-7-2-8Z"/>`,
      round: `<path ${fill} d="M24 45c0-21 11-31 24-31 19 0 28 9 25 31-7-7-14-11-25-11-11 0-17 3-24 11Z"/><circle cx="28" cy="42" r="5" ${fill}/><circle cx="69" cy="42" r="5" ${fill}/>` ,
      spike2: `<path ${fill} d="M23 45c0-19 11-31 25-31 18 0 26 10 24 29-7-6-15-9-24-9-10 0-18 3-25 11Z"/><path ${fill} d="M31 17 39 28l1-12 9 11 4-12 6 11 6-9 2 13 7-7c-4-6-13-10-24-10-11 0-18 3-25 16Z"/>`,
      sidecut: `<path ${fill} d="M23 46c0-20 12-31 26-31 17 0 25 10 23 29-5-6-13-9-23-9-8 0-16 2-26 11Z"/><path ${fill} d="M29 20c3 3 5 8 5 14 0 5-1 9-4 12-6-4-9-10-9-16 0-5 3-9 8-10Z"/>`,
      soft: `<path ${fill} d="M24 45c0-18 11-31 25-31 18 0 28 12 25 31-7-8-16-11-24-11-11 0-18 3-26 11Z"/><path ${fill} d="M27 43c-3 8-4 17-1 26l7-6-2-18Z"/><path ${fill} d="M69 43c3 8 4 17 1 26l-7-6 2-18Z"/>`,
      spike: `<path ${fill} d="M22 44c1-19 12-30 27-30 15 0 24 8 23 28-7-4-14-7-24-7-9 0-17 2-26 9Z"/><path ${fill} d="M26 24 36 12l1 13 9-11 4 13 8-12 4 13 8-8-2-5c-4-4-11-7-19-7-12 0-20 5-23 11Z"/>`
    };
    return common[style] || common.bob;
  }

  function accessoryPath(kind, primary) {
    const fill = `fill="${primary}"`;
    const stroke = `stroke="rgba(255,255,255,.92)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
    const map = {
      star: `<path ${fill} d="M73 22l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1Z"/>`,
      scarf: `<path fill="#ffe1ea" d="M31 70c5-4 11-6 17-6s12 2 17 6l-5 6H36Z"/><path ${fill} d="M46 67h8l4 13h-8Z"/>`,
      clip: `<rect x="66" y="22" width="10" height="5" rx="2.5" fill="#fff" opacity=".95"/><circle cx="71" cy="24.5" r="1.6" ${fill}/>` ,
      moon: `<path fill="#fff4c7" d="M72 22c-4 0-7 4-7 8 0 5 4 8 8 8 1 0 3 0 4-1-2 3-5 5-9 5-6 0-11-5-11-11 0-7 5-12 12-12 1 0 2 0 3 .5Z"/>`,
      flower: `<circle cx="72" cy="24" r="4" fill="#ffdbe8"/><circle cx="68" cy="24" r="4" fill="#ffdbe8"/><circle cx="70" cy="20" r="4" fill="#ffdbe8"/><circle cx="70" cy="28" r="4" fill="#ffdbe8"/><circle cx="70" cy="24" r="2" ${fill}/>` ,
      snow: `<path ${stroke} d="M72 18v16M64 26h16M66 20l12 12M78 20 66 32"/>`,
      crown: `<path ${fill} d="M61 18 66 26l6-7 5 8v7H58v-7Z"/><circle cx="61" cy="18" r="2" fill="#fff"/><circle cx="72" cy="19" r="2" fill="#fff"/><circle cx="77" cy="27" r="2" fill="#fff"/>`,
      halo: `<ellipse cx="48" cy="12" rx="16" ry="5" fill="none" stroke="#fff7bf" stroke-width="4" opacity=".95"/>`,
      gem: `<path d="M71 19l5 5-5 8-6-8 6-5Z" fill="#f6f0ff" stroke="#fff" stroke-width="1.5"/>`,
      headset: `<path d="M29 38c0-11 8-18 19-18s19 7 19 18" fill="none" stroke="#0ee2ff" stroke-width="4" stroke-linecap="round"/><rect x="24" y="36" width="6" height="12" rx="3" fill="#0ee2ff"/><rect x="66" y="36" width="6" height="12" rx="3" fill="#0ee2ff"/>`,
      ears: `<path d="M28 18l7 10-10 1 3-11Zm40 0 8 11-10-1 2-10Z" fill="#fff3e2" stroke="#7c3a1e" stroke-width="2" stroke-linejoin="round"/>`,
      spark: `<path ${fill} d="M74 17l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>`,
      visor: `<path d="M26 38c6-8 14-12 22-12 9 0 16 4 22 12-7 3-15 4-22 4s-16-1-22-4Z" fill="#ffffffad" stroke="#fff" stroke-width="2"/>`,
      badge: `<circle cx="72" cy="24" r="6" fill="#d0b278" stroke="#fff3d4" stroke-width="2"/><path d="M72 20v8M68 24h8" stroke="#fff3d4" stroke-width="2" stroke-linecap="round"/>`,
      clip2: `<rect x="63" y="20" width="12" height="6" rx="3" fill="#1c2647"/><path d="M63 23h12" stroke="#a3ffef" stroke-width="2" stroke-linecap="round"/>`,
      ribbon: `<path d="M64 20h14l-4 7 4 7H64l-4-7 4-7Z" fill="#ff9bb9" stroke="#fff" stroke-width="2"/>`
    };
    return map[kind] || '';
  }

  function mouthPath(kind) {
    if (kind === 'grin') return '<path d="M40 56c3 4 9 6 15 0" fill="none" stroke="#874c46" stroke-width="2.6" stroke-linecap="round"/>';
    if (kind === 'calm') return '<path d="M42 57c4 1 8 1 12 0" fill="none" stroke="#874c46" stroke-width="2.3" stroke-linecap="round"/>';
    return '<path d="M41 56c2.5 3 8.5 3 11 0" fill="none" stroke="#874c46" stroke-width="2.4" stroke-linecap="round"/>';
  }

  function svg(def) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${esc(def.name)} avatar"><defs><linearGradient id="g-${def.id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${def.bg1}"/><stop offset="1" stop-color="${def.bg2}"/></linearGradient><linearGradient id="s-${def.id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffffff" stop-opacity=".28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs><rect width="96" height="96" rx="28" fill="url(#g-${def.id})"/><rect x="3" y="3" width="90" height="90" rx="25" fill="none" stroke="#ffffff" stroke-opacity=".26"/><path d="M17 89c5-16 18-25 31-25s26 9 31 25Z" fill="${def.shirt}"/><path d="M42 59h12v10c0 3-3 5-6 5s-6-2-6-5Z" fill="${def.skin}" opacity=".96"/>${hairPath(def.style, def.hair)}<circle cx="48" cy="42" r="18" fill="${def.skin}"/><ellipse cx="48" cy="73" rx="14" ry="8" fill="#000" opacity=".08"/>${hairPath(def.style, def.hair).replace(/\/>$/, ' opacity=".07"/>')}<path d="M31 44c2-15 10-24 23-24 11 0 20 7 23 24-4-5-13-9-23-9-10 0-18 3-23 9Z" fill="${def.hair}" opacity=".88"/><ellipse cx="41" cy="45" rx="3.2" ry="4" fill="${def.eye}"/><ellipse cx="55" cy="45" rx="3.2" ry="4" fill="${def.eye}"/><circle cx="42" cy="44" r="1" fill="#fff" opacity=".95"/><circle cx="56" cy="44" r="1" fill="#fff" opacity=".95"/><ellipse cx="37" cy="51" rx="4.2" ry="2.3" fill="#ff97a8" opacity=".35"/><ellipse cx="59" cy="51" rx="4.2" ry="2.3" fill="#ff97a8" opacity=".35"/><path d="M48 46v6" stroke="#d4968b" stroke-width="1.7" stroke-linecap="round"/>${mouthPath(def.mouth)}${accessoryPath(def.accessory, def.shirt)}<path d="M8 14c5-6 13-9 20-8-7 2-12 5-15 11Z" fill="url(#s-${def.id})" opacity=".85"/><circle cx="76" cy="18" r="9" fill="#fff" opacity=".12"/></svg>`;
  }

  // Portraits live in the repository; no generated SVG or embedded CSS data URIs.
  defs.forEach((def) => { def.dataUri = `url("${def.image}")`; });

  const api = {
    ids,
    defs,
    isValid(value) { return valid.has(value); },
    normalize(value) { return valid.has(value) ? value : ids[0]; },
    name(value) { const id = api.normalize(value); return byId[id].name; },
    art(value) { const id = api.normalize(value); return byId[id].dataUri; },
    find(value) { const id = api.normalize(value); return byId[id]; },
  };

  window.LastCardAvatars = api;
})();
