'use strict';
/* Asset and protocol contract checks; does not require npm dependencies. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/avatars.js'), 'utf8');
const scope = { window: {} };
vm.runInNewContext(src, scope, { filename: 'avatars.js' });
const lib = scope.window.LastCardAvatars;
assert.strictEqual(lib.ids.length, 16, 'There must be exactly 16 portraits');
assert.strictEqual(new Set(lib.ids).size, 16, 'Avatar ids must be unique');
for (const id of lib.ids) {
  const def = lib.find(id);
  assert(def.name && def.name.length > 2);
  const encoded = lib.art(id).match(/^url\("data:image\/svg\+xml,([^\"]+)"\)$/);
  assert(encoded, `${id} must have a self-contained SVG background`);
  const svg = decodeURIComponent(encoded[1]);
  assert(svg.includes('<svg') && svg.includes('</svg>'), `${id} SVG incomplete`);
  assert(svg.includes('<ellipse cx="41"'), `${id} must have anime portrait eyes`);
}
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const match = server.match(/const AVATARS = \[([^\]]+)\];/);
assert(match, 'Server avatar allowlist missing');
const onServer = match[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
assert.deepStrictEqual([...lib.ids].sort(), onServer.sort(), 'Browser and server avatar ids differ');
const phone = fs.readFileSync(path.join(__dirname, '..', 'public/phone.html'), 'utf8');
const tv = fs.readFileSync(path.join(__dirname, '..', 'public/tv.html'), 'utf8');
assert(phone.indexOf('/js/avatars.js') < phone.indexOf('/js/experience.js'));
assert(tv.indexOf('/js/avatars.js') < tv.indexOf('/js/experience.js'));
console.log('avatars: 16 unique self-contained portraits, server allowlist, phone and TV integration checked');
