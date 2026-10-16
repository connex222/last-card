/* Last Card — phone controller. Shows only this player's private hand. */
(function () {
  'use strict';
  const { renderCard, sortHand, escapeHtml, COLOR_NAME, COLOR_MARK, COLOR_HEX } = window.LC;
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'lastcard:player';
  const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦉', '🐯', '🐨', '🐵', '🦄', '🐲', '🐧', '🐝', '🦖', '🐢', '🦋'];

  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;
  let session = loadSession();
  let chosenAvatar = (session && session.avatar) || AVATARS[(Math.random() * AVATARS.length) | 0];
  let busy = false;
  let wildCardId = null;
  let knownIds = new Set();
  let wasMyTurn = false;
  let lastFlashId = null;
  let toastTimer = null;
  let handKey = '';

  // ---------- session (survives phone sleep and page reloads) ----------
  function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } }
  function saveSession(s) { session = s; try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} }
  function clearSession() { session = session ? { name: session.name, avatar: session.avatar } : null; try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {} }

  function codeFromUrl() {
    const m = location.pathname.match(/\/j\/([A-Za-z]{4})/);
    if (m) return m[1].toUpperCase();
    const q = new URLSearchParams(location.search).get('room');
    return q ? q.toUpperCase().slice(0, 4) : '';
  }

  // ---------- screens ----------
  const SCREENS = ['screen-join', 'screen-wait', 'screen-play'];
  function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; }

  function showJoin(error) {
    show('screen-join');
    const code = codeFromUrl() || (session && session.code) || '';
    if (!$('in-code').value) $('in-code').value = code;
    if (!$('in-name').value && session && session.name) $('in-name').value = session.name;
    $('join-error').textContent = error || '';
    renderAvatars();
    $('modal-end').hidden = true;
    $('modal-wild').hidden = true;
  }

  function renderAvatars() {
    $('avatars').innerHTML = AVATARS.map((a) => `<button type="button" class="ph-avatar" data-avatar="${a}" aria-pressed="${a === chosenAvatar}" aria-label="Avatar ${a}">${a}</button>`).join('');
  }

  // ---------- connection ----------
  function join(payload) {
    $('btn-join').disabled = true;
    socket.emit('player:join', payload, (res) => {
      $('btn-join').disabled = false;
      if (!res || !res.ok) {
        if (payload.playerId) clearSession();
        showJoin(res && res.error);
        return;
      }
      saveSession({ code: res.code, playerId: res.playerId, name: payload.name || (session && session.name), avatar: payload.avatar || chosenAvatar });
      // Strip the code from the address bar so a refresh rejoins rather than re-prefills.
      if (location.pathname !== '/join') history.replaceState(null, '', '/join');
    });
  }

  socket.on('connect', () => {
    const urlCode = codeFromUrl();
    if (session && session.playerId && session.code && (!urlCode || urlCode === session.code)) {
      join({ code: session.code, playerId: session.playerId });
    } else if (!state) {
      showJoin();
    }
  });

  socket.on('disconnect', () => toast('Reconnecting…', 'info', 60000));
  socket.on('removed', () => { clearSession(); state = null; showJoin('You were removed from the game.'); });

  socket.on('update-player', (s) => {
    const first = !state;
    state = s;
    if (first) { lastFlashId = s.flash ? s.flash.id : null; knownIds = new Set(s.hand.map((c) => c.id)); hideToast(); }
    render();
  });

  // ---------- rendering ----------
  function render() {
    busy = false;
    if (state.phase === 'lobby' || !state.inRound) { renderWait(); return; }
    renderPlay();
  }

  function renderWait() {
    show('screen-wait');
    handKey = '';
    if (state.phase === 'finished' && state.winner) renderEnd();
    else $('modal-end').hidden = true;
    $('w-avatar').textContent = state.me.avatar;
    $('w-name').textContent = state.me.name;
    $('w-code').textContent = state.code;
    const leader = state.lobby.find((p) => p.isLeader);
    let msg;
    if (state.phase === 'playing') msg = "A round is being played. You'll be dealt in next round.";
    else if (state.me.isLeader) msg = state.canStart ? "Everyone in? Deal when you're ready." : 'Waiting for at least one more player…';
    else msg = `You're in. Watch the TV — ${leader ? escapeHtml(leader.name) : 'the host'} will start the game.`;
    $('w-message').innerHTML = msg;
    $('btn-start').hidden = !(state.me.isLeader && state.phase !== 'playing');
    $('btn-start').disabled = !state.canStart;
    $('w-players').innerHTML = state.lobby.map((p) => `
      <li class="flex items-center gap-3 bg-zinc-900 rounded-2xl px-4 py-3 ${p.connected ? '' : 'opacity-50'}">
        <span class="text-3xl">${p.avatar}</span>
        <span class="font-bold text-lg flex-1">${escapeHtml(p.name)}</span>
        <span class="text-zinc-400 font-semibold">${p.wins ? `${p.wins} win${p.wins > 1 ? 's' : ''}` : ''}</span>
      </li>`).join('');
  }

  function renderPlay() {
    show('screen-play');
    $('p-avatar').textContent = state.me.avatar;
    $('p-name').textContent = state.me.name;
    $('p-count').textContent = `${state.hand.length} card${state.hand.length === 1 ? '' : 's'}`;

    // Turn banner + haptic nudge when it becomes your turn
    const turn = $('p-turn');
    if (state.phase === 'finished') {
      turn.className = 'ph-turn is-theirs';
      turn.textContent = 'Round over';
    } else if (state.isMyTurn) {
      turn.className = 'ph-turn is-mine';
      turn.textContent = state.canPass ? 'Play the card you drew, or keep it' : state.canDraw ? 'Your turn — no match, draw a card' : 'Your turn — tap a card';
      if (!wasMyTurn && navigator.vibrate) navigator.vibrate([60, 40, 60]);
    } else {
      turn.className = 'ph-turn is-theirs';
      turn.textContent = state.currentName ? `${state.currentName} is playing…` : '';
    }
    wasMyTurn = state.isMyTurn;

    // Table summary
    $('p-top').innerHTML = state.topCard ? renderCard(state.topCard) : '';
    const c = state.activeColor;
    $('p-color').innerHTML = c ? `<span style="color:${COLOR_HEX[c]}">${COLOR_MARK[c]}</span> ${COLOR_NAME[c]}` : '';
    $('p-others').innerHTML = state.others.map((o) => `<li class="${o.isCurrent ? 'text-amber-300' : ''}">${o.avatar} ${escapeHtml(o.name)} ${o.cardCount}</li>`).join('');

    // Action buttons
    const draw = $('btn-draw');
    if (state.canPass) {
      draw.textContent = 'Keep card';
      draw.className = 'ph-draw btn-warn';
      draw.disabled = false;
    } else {
      draw.textContent = 'Draw card';
      draw.className = 'ph-draw btn-accent';
      draw.disabled = !state.canDraw;
    }
    const shout = $('btn-shout');
    shout.classList.toggle('is-called', !!state.called);
    shout.textContent = state.called ? 'Called ✓' : 'LAST CARD!';

    // Hand
    const hand = sortHand(state.hand);
    const playable = new Set(state.playableIds);
    const handEl = $('p-hand');
    handEl.classList.toggle('is-turn', state.isMyTurn);
    // Only rebuild the hand when it actually changed, so taps aren't lost mid-render.
    const key = [hand.map((c) => c.id).join(','), state.playableIds.join(','), state.pendingDrawnId, state.isMyTurn].join('|');
    if (key !== handKey) {
    handKey = key;
    handEl.innerHTML = hand.map((card) => {
      const cls = [
        playable.has(card.id) ? 'is-playable' : '',
        card.id === state.pendingDrawnId ? 'is-drawn' : '',
        knownIds.has(card.id) ? '' : 'lc-new',
      ].join(' ');
      return renderCard(card, { tag: 'button', extraClass: cls, attrs: 'type="button"' });
    }).join('');
    const fresh = hand.find((c) => !knownIds.has(c.id));
    knownIds = new Set(hand.map((x) => x.id));
    if (fresh) {
      const el = handEl.querySelector(`[data-id="${fresh.id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    }

    if (state.phase === 'finished') renderEnd(); else $('modal-end').hidden = true;

    if (state.flash && state.flash.id !== lastFlashId) {
      lastFlashId = state.flash.id;
      const f = state.flash;
      if (state.phase === 'playing') toast(f.who === state.me.id && f.you ? f.you : f.text, f.tone);
    }
  }

  function renderEnd() {
    const w = state.winner;
    $('modal-end').hidden = false;
    $('modal-wild').hidden = true;
    $('e-avatar').textContent = w ? w.avatar : '🏁';
    $('e-title').textContent = w ? (w.isMe ? 'You win!' : `${w.name} wins!`) : 'Round over';
    $('e-sub').textContent = state.me.isLeader ? 'Deal again when everyone is ready.' : 'Waiting for the next round…';
    $('btn-again').hidden = !state.me.isLeader;
    $('btn-again').disabled = !state.canStart;
    if (w && w.isMe && navigator.vibrate) navigator.vibrate([100, 60, 100, 60, 200]);
  }

  // ---------- feedback ----------
  function toast(text, tone = 'info', ms = 2200) {
    clearTimeout(toastTimer);
    $('toast-wrap').innerHTML = `<p class="ph-toast tone-${tone}">${escapeHtml(text)}</p>`;
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast-wrap').innerHTML = ''; }

  function shake(el) {
    if (!el) return;
    el.classList.remove('lc-shake');
    void el.offsetWidth; // restart the animation
    el.classList.add('lc-shake');
    if (navigator.vibrate) navigator.vibrate(30);
  }

  function send(event, payload, failEl) {
    if (busy) return;
    busy = true;
    socket.emit(event, payload || {}, (res) => {
      if (!res || !res.ok) {
        busy = false;
        if (failEl) failEl.classList.remove('lc-flying');
        shake(failEl);
        if (res && res.error) toast(res.error, 'danger');
      }
      // On success the server broadcasts a fresh state, which re-renders and clears busy.
    });
    setTimeout(() => { busy = false; }, 3000); // safety net on a flaky connection
  }

  function playCard(el, cardId, color) {
    el.classList.add('lc-flying');
    setTimeout(() => send('player:play', { cardId, color }, el), 170);
  }

  // ---------- input ----------
  $('avatars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (!b) return;
    chosenAvatar = b.dataset.avatar;
    renderAvatars();
  });

  $('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  function submitJoin() {
    const code = $('in-code').value.trim().toUpperCase();
    const name = $('in-name').value.trim();
    if (code.length !== 4) { $('join-error').textContent = 'The room code is 4 letters — look at the TV.'; shake($('in-code')); return; }
    if (!name) { $('join-error').textContent = 'Type your name first.'; shake($('in-name')); return; }
    saveSession({ name, avatar: chosenAvatar });
    join({ code, name, avatar: chosenAvatar });
  }
  $('btn-join').addEventListener('click', submitJoin);
  $('in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });

  $('btn-start').addEventListener('click', (e) => send('player:start', {}, e.currentTarget));
  $('btn-again').addEventListener('click', (e) => send('player:start', {}, e.currentTarget));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-leave]')) return;
    if (!confirm('Leave this game? Your cards go back in the deck.')) return;
    socket.emit('player:leave', {}, () => { clearSession(); state = null; showJoin(); });
  });

  $('p-hand').addEventListener('click', (e) => {
    const el = e.target.closest('.lc-card');
    if (!el || !state || busy) return;
    const id = el.dataset.id;
    if (!state.isMyTurn || !state.playableIds.includes(id)) {
      shake(el);
      if (!state.isMyTurn) toast("It's not your turn yet.", 'info', 1200);
      return;
    }
    const card = state.hand.find((c) => c.id === id);
    if (card.color === 'wild') {
      wildCardId = id;
      $('modal-wild').hidden = false;
      $('modal-wild').querySelector('[data-color]').focus();
      return;
    }
    playCard(el, id);
  });

  $('modal-wild').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || !wildCardId) return;
    $('modal-wild').hidden = true;
    const el = $('p-hand').querySelector(`[data-id="${wildCardId}"]`);
    const id = wildCardId;
    wildCardId = null;
    if (el) playCard(el, id, b.dataset.color);
    else send('player:play', { cardId: id, color: b.dataset.color });
  });
  $('btn-wild-cancel').addEventListener('click', () => { wildCardId = null; $('modal-wild').hidden = true; });

  $('btn-draw').addEventListener('click', (e) => {
    if (!state) return;
    if (state.canPass) send('player:pass', {}, e.currentTarget);
    else if (state.canDraw) send('player:draw', {}, e.currentTarget);
    else shake(e.currentTarget);
  });

  $('btn-shout').addEventListener('click', (e) => {
    if (!state || state.called) return;
    socket.emit('player:shout', {}, (res) => { if (!res || !res.ok) shake(e.currentTarget); });
  });

  // First paint before the socket connects
  if (!(session && session.playerId)) showJoin();
})();
