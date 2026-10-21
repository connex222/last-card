// UI asset and server allowlist regression checks (no browser/dependencies required).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/avatars.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const avatars = context.window.LastCardAvatars;
assert.equal(avatars.ids.length, 16);
assert.equal(new Set(avatars.ids).size, 16);
for (const id of avatars.ids) {
  assert.equal(avatars.isValid(id), true);
  assert.ok(avatars.art(id).startsWith('url("data:image/svg+xml,'));
  assert.ok(avatars.name(id));
}
const server = fs.readFileSync('server.js', 'utf8');
for (const id of avatars.ids) assert.ok(server.includes(`'${id}'`), `${id} missing server allowlist`);
for (const file of ['public/index.html','public/phone.html','public/tv.html']) {
  const html = fs.readFileSync(file,'utf8');
  assert.ok(html.includes('/js/avatars.js'), `${file} missing avatar script`);
  assert.ok(html.indexOf('/js/avatars.js') < html.indexOf('/js/experience.js'));
}
const exp = fs.readFileSync('public/js/experience.js','utf8');
assert.ok(exp.includes('lcAvatarGroup = key'), 'team avatars retain identity');
console.log('Avatar & display regression checks passed (16 avatars, three entry points).');

// Reliability regression guards: these changes must survive later UI revisions.
const phone = fs.readFileSync('public/js/phone.js', 'utf8');
assert.ok(phone.includes('new ResizeObserver('), 'mobile hand needs responsive relayout');
assert.ok(phone.includes("e.key === 'ArrowRight'"), 'keyboard card navigation missing');
assert.ok(server.includes('One socket must not control seats in multiple rooms'), 'cross-room seat guard missing');
assert.ok(server.includes('p.socketId === socket.id'), 'stale disconnect guard missing');
console.log('Responsive hand and reconnect ownership checks passed.');
