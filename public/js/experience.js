/* Shared presentation layer. Never reads private hands or changes gameplay state. */
(() => {
  'use strict';
  const KEY = 'lastcard:prefs:v1';
  const defaults = { contrast: false, size: 'normal', sound: false };
  let prefs;
  try { prefs = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { prefs = { ...defaults }; }
  let audio;
  function apply() {
    document.body.classList.toggle('lc-high-contrast', !!prefs.contrast);
    document.documentElement.classList.toggle('lc-large-text', prefs.size === 'large');
    document.documentElement.classList.toggle('lc-xlarge-text', prefs.size === 'xlarge');
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {}
  }
  function tone(type) {
    if (!prefs.sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const count = type === 'win' ? 3 : type === 'shuffle' ? 4 : 1;
      for (let i = 0; i < count; i++) {
        const osc = audio.createOscillator(), gain = audio.createGain();
        const start = audio.currentTime + i * (type === 'win' ? .12 : .045);
        osc.type = type === 'draw' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(type === 'win' ? 392 * Math.pow(1.26,i) : type === 'draw' ? 340 : 270 + i * 85, start);
        gain.gain.setValueAtTime(.0001,start); gain.gain.exponentialRampToValueAtTime(.032,start+.008);
        gain.gain.exponentialRampToValueAtTime(.0001,start+.12);
        osc.connect(gain).connect(audio.destination); osc.start(start); osc.stop(start+.13);
      }
    } catch (_) { /* disabled / unsupported audio */ }
  }
  window.LastCardExperience = { sound: tone };
  const AvatarLib = window.LastCardAvatars || { ids: [], isValid: () => false, normalize: (v) => v, name: (v) => v, art: () => 'none' };
  let scheduled = false;
  function decorateAvatarNode(el, id) {
    const avatarId = AvatarLib.normalize(id);
    const label = AvatarLib.name(avatarId);
    if (el.classList.contains('ph-avatar')) {
      if (el.dataset.lcAvatarRendered === avatarId) return;
      el.dataset.lcAvatarRendered = avatarId;
      el.dataset.avatarId = avatarId;
      el.title = label;
      el.innerHTML = `<span class="lc-avatar-badge" aria-hidden="true" style="background-image:${AvatarLib.art(avatarId)}"></span><span class="lc-avatar-name">${label}</span>`;
      return;
    }
    if (el.dataset.lcAvatarText === avatarId) return;
    el.dataset.lcAvatarText = avatarId;
    el.dataset.avatarId = avatarId;
    el.classList.add('lc-avatar-art');
    el.style.backgroundImage = AvatarLib.art(avatarId);
    el.title = label;
    if (!el.getAttribute('aria-label') && !el.closest('[aria-hidden="true"]')) el.setAttribute('aria-label', label);
  }
  function clearAvatarNode(el) {
    delete el.dataset.lcAvatarText;
    delete el.dataset.lcAvatarRendered;
    delete el.dataset.lcAvatarGroup;
    el.classList.remove('lc-avatar-art');
    el.style.removeProperty('background-image');
  }
  function decorateAvatarGroup(el, ids) {
    const key = ids.join(' ');
    if (el.dataset.lcAvatarGroup === key) return;
    el.dataset.lcAvatarGroup = key;
    delete el.dataset.lcAvatarText;
    delete el.dataset.lcAvatarRendered;
    el.classList.remove('lc-avatar-art');
    el.style.removeProperty('background-image');
    el.classList.add('lc-avatar-group');
    el.innerHTML = ids.map((avatarId) => `<span class="lc-avatar-mini" aria-hidden="true" title="${AvatarLib.name(avatarId)}" style="background-image:${AvatarLib.art(avatarId)}"></span>`).join('');
  }
  function decorate() {
    scheduled = false;
    const selectors = '.av, .me, .big-av, #w-avatar, #p-avatar, #e-avatar, .disc .em';
    document.querySelectorAll(selectors).forEach((el) => {
      const source = (((el.classList.contains('lc-avatar-group') && el.children.length) ? el.dataset.lcAvatarGroup : '') || (el.classList.contains('ph-avatar') ? el.dataset.avatar : '') || el.textContent || '').trim();
      if (!AvatarLib.isValid(source)) {
        const group = source.split(/\s+/).filter((id) => AvatarLib.isValid(id));
        if (group.length > 1 && group.join(' ') === source && (el.id === 'w-avatar' || el.id === 'e-avatar')) { decorateAvatarGroup(el, group); return; }
        clearAvatarNode(el);
        el.classList.remove('lc-avatar-group');
        return;
      }
      el.classList.remove('lc-avatar-group');
      decorateAvatarNode(el, source);
    });
  }
  function queueDecorate() { if (!scheduled) { scheduled = true; queueMicrotask(decorate); } }
  const steps = [
    ['Join the table','Open Last Card on the TV, scan the QR code with your phone or enter the four-letter room code. Choose your avatar, then join.'],
    ['Get rid of your hand','On your turn, play a card matching the top discard by colour, number or symbol. Wild cards let you choose the next colour. If you cannot play, draw a card.'],
    ['Use your action cards','Skip makes the next player miss a turn. Reverse changes direction. Draw cards force an opponent to pick up cards. Some modes add Bomb, Eclipse, 7 swaps and 0 hand rotations.'],
    ['Call Last Card!','When you are down to your final card, press Last Card! promptly or you risk a penalty. Be first to empty your hand to win the round.'],
    ['Choose a match format','Single Rounds count wins. First to 500 awards the winner points from opponents’ remaining cards: number cards face value, actions 20, wilds 50. Knockout removes the player with the most cards each round.'],
    ['Try a different mode','Pile-Up stacks draw penalties; Tag Team shares wins; Hot Potato has a hidden fuse; Eclipse flips cards; Frenzy removes turns. The TV lobby describes each mode.']
  ];
  function modal(kind) {
    const node = document.createElement('div'); node.className='lc-experience'; node.hidden=true;
    node.setAttribute('role','dialog'); node.setAttribute('aria-modal','true'); node.setAttribute('aria-labelledby','lc-dialog-title');
    const content = kind === 'help' ? `<ol class="lc-steps">${steps.map(([h,t])=>`<li><strong>${h}</strong><p>${t}</p></li>`).join('')}</ol>` :
      `<p>These preferences stay on this browser only.</p><label class="lc-setting"><span>High-contrast text</span><input id="lc-contrast" type="checkbox"></label><label class="lc-setting"><span>Text size</span><select id="lc-font"><option value="normal">Standard</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label><label class="lc-setting"><span>Sound effects</span><input id="lc-sound" type="checkbox"></label><p>Sounds play only after you interact with the page. Reduced-motion settings on your device are respected.</p>`;
    node.innerHTML=`<div class="lc-panel" tabindex="-1"><div class="lc-modal-actions"><button type="button" class="lc-tool" data-close aria-label="Close dialog">✕ Close</button></div><h2 id="lc-dialog-title">${kind==='help'?'How to Play':'Display & Sound'}</h2>${content}</div>`;
    document.body.append(node);
    let previous;
    function close() {node.hidden=true;document.removeEventListener('keydown',onKey);previous?.focus?.();}
    function onKey(e) {if(e.key==='Escape') close(); if(e.key==='Tab') {const focusable=[...node.querySelectorAll('button,input,select')]; const i=focusable.indexOf(document.activeElement); if(e.shiftKey&&i===0) {e.preventDefault();focusable.at(-1).focus();} else if(!e.shiftKey&&i===focusable.length-1){e.preventDefault();focusable[0].focus();}}}
    node.addEventListener('click',e=>{if(e.target===node||e.target.closest('[data-close]'))close();});
    return {open(){previous=document.activeElement;node.hidden=false; if(kind==='settings'){node.querySelector('#lc-contrast').checked=!!prefs.contrast;node.querySelector('#lc-font').value=prefs.size;node.querySelector('#lc-sound').checked=!!prefs.sound;}node.querySelector('[data-close]').focus();document.addEventListener('keydown',onKey);},node};
  }
  function init() {
    apply();
    const help=modal('help'), settings=modal('settings');
    const tools=document.createElement('nav');tools.className='lc-top-tools';tools.setAttribute('aria-label','Help and settings');
    tools.innerHTML='<button type="button" class="lc-tool" id="lc-help">? How to Play</button><button type="button" class="lc-tool" id="lc-settings" aria-label="Display and sound settings">⚙ Settings</button>';
    document.body.append(tools);
    tools.querySelector('#lc-help').onclick=()=>help.open();tools.querySelector('#lc-settings').onclick=()=>settings.open();
    settings.node.querySelector('#lc-contrast').onchange=e=>{prefs.contrast=e.target.checked;apply();};
    settings.node.querySelector('#lc-font').onchange=e=>{prefs.size=e.target.value;apply();};
    settings.node.querySelector('#lc-sound').onchange=e=>{prefs.sound=e.target.checked;apply();tone('draw');};
    new MutationObserver(queueDecorate).observe(document.body,{childList:true,characterData:true,subtree:true});
    decorate();
    // UI sound hooks; game actions themselves remain server-authoritative.
    document.addEventListener('click', e=>{if(e.target.closest('#btn-draw'))tone('draw');if(e.target.closest('#btn-start,#btn-solo-go'))tone('shuffle');});
    window.addEventListener('lastcard:win',()=>tone('win'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
