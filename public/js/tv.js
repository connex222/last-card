/* Last Card — TV (host) screen. Shows the public table only; never sees anyone's hand. */
(function () {
  'use strict';
  const { renderCard, renderBack, tiltFor, escapeHtml, COLOR_HEX, COLOR_SOFT, COLOR_NAME, COLOR_MARK } = window.LC;
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'lastcard:tv';

  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;
  let lastTopId = null;
  let lastFlashId = null;
  let lastWinnerShown = null;
  let flashTimer = null;

  // ---------- connection ----------
  function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } }

  function createRoom() {
    socket.emit('tv:create', {}, (res) => { if (res && res.ok) saveSession({ code: res.code, hostToken: res.hostToken }); });
  }

  socket.on('connect', () => {
    const s = loadSession();
    if (s) {
      socket.emit('tv:resume', s, (res) => { if (!res || !res.ok) createRoom(); });
    } else {
      createRoom();
    }
  });

  socket.on('update-tv', (s) => {
    const firstState = !state;
    state = s;
    if (firstState) lastFlashId = s.flash ? s.flash.id : null; // don't replay old news after a reload
    render();
  });

  // ---------- rendering ----------
  function show(screen) {
    for (const id of ['screen-connecting', 'screen-lobby', 'screen-table']) $(id).hidden = id !== screen;
  }

  function render() {
    if (state.phase === 'lobby') { show('screen-lobby'); renderLobby(); hideWinner(); return; }
    show('screen-table');
    renderTable();
    if (state.phase === 'finished') showWinner(); else hideWinner();
  }

  function renderLobby() {
    $('lobby-code').textContent = state.code;
    $('qr').innerHTML = state.qrSvg;
    $('lobby-net-warning').hidden = !!state.hostLabel;
    $('lobby-url').textContent = state.hostLabel ? `No camera? Open ${state.hostLabel} on your phone and type the code.` : '';
    const players = state.players;
    $('lobby-count').textContent = `${players.length} of ${state.maxPlayers}`;
    $('lobby-empty').hidden = players.length > 0;
    $('lobby-players').innerHTML = players.map((p) => `
      <li>
        <button class="tv-player ${p.connected ? '' : 'is-away'}" data-remove="${p.id}" title="Click to remove ${escapeHtml(p.name)}">
          <span class="tv-avatar">${p.avatar}</span>
          <span class="text-left">
            <span class="tv-pname block">${escapeHtml(p.name)}</span>
            <span class="tv-pmeta block">${p.connected ? (p.isLeader ? 'Can start the game' : 'Ready') : 'Phone asleep'}${p.wins ? ` · ${p.wins} win${p.wins > 1 ? 's' : ''}` : ''}</span>
          </span>
        </button>
      </li>`).join('');
    const ready = players.filter((p) => p.connected).length;
    $('btn-start').disabled = ready < state.minPlayers;
    $('lobby-hint').textContent = ready < state.minPlayers
      ? `You need at least ${state.minPlayers} players.`
      : 'Press start here, or the first player can start from their phone.';
  }

  function setGlow(color) {
    const root = document.documentElement.style;
    root.setProperty('--glow', COLOR_HEX[color] || 'transparent');
    root.setProperty('--glow-soft', COLOR_SOFT[color] || 'transparent');
  }

  function renderTable() {
    $('t-round').textContent = state.round;
    $('t-code').textContent = state.code;
    $('t-deck-count').textContent = state.drawCount;
    $('t-deck').innerHTML = state.drawCount > 0 ? renderBack() : '<div class="lc-card" style="opacity:.2"></div>';

    // Discard pile: last few cards, newest on top with a landing animation.
    const pile = state.discard;
    const top = pile[pile.length - 1];
    const isNew = top && top.id !== lastTopId;
    $('t-discard').innerHTML = pile.map((c, i) => {
      const newest = i === pile.length - 1;
      return renderCard(c, { extraClass: newest && isNew ? 'lc-landing' : '', attrs: `style="--tilt:${tiltFor(c.id)}deg;transform:rotate(${tiltFor(c.id)}deg)"` });
    }).join('');
    lastTopId = top ? top.id : null;

    // Active colour
    setGlow(state.activeColor);
    const chip = $('t-color');
    chip.textContent = state.activeColor ? `${COLOR_MARK[state.activeColor]} ${COLOR_NAME[state.activeColor]}` : '';
    chip.classList.toggle('is-yellow', state.activeColor === 'yellow');

    // Direction ring
    const ring = $('t-ring');
    const cw = state.direction === 1;
    ring.classList.toggle('cw', cw);
    ring.classList.toggle('ccw', !cw);
    for (const arc of ['ring-arc-1', 'ring-arc-2']) {
      const el = $(arc);
      if (cw) { el.setAttribute('marker-end', 'url(#arrowhead)'); el.removeAttribute('marker-start'); }
      else { el.setAttribute('marker-start', 'url(#arrowhead)'); el.removeAttribute('marker-end'); }
    }
    $('t-direction').textContent = cw ? 'Play moves left to right ›' : '‹ Play moves right to left';

    // Players in seat order, arrows between them showing direction
    const seated = state.players.filter((p) => p.inRound);
    const waiting = state.players.filter((p) => !p.inRound);
    const sep = `<li class="text-[1.8em] font-black text-zinc-300" aria-hidden="true">${cw ? '›' : '‹'}</li>`;
    $('t-players').innerHTML = seated.map((p) => {
      const last = p.cardCount === 1;
      const badge = last
        ? `<span class="tv-badge ${p.called ? 'tone-success' : 'tone-warn'}">${p.called ? 'Last card!' : '1 card'}</span>`
        : '';
      return `<li>
        <button class="tv-player ${p.isCurrent ? 'is-current' : ''} ${last && state.phase === 'playing' ? 'is-last' : ''} ${p.connected ? '' : 'is-away'}" data-remove="${p.id}" title="Click to remove ${escapeHtml(p.name)}">
          <span class="tv-avatar">${p.avatar}</span>
          <span class="text-left">
            <span class="tv-pname block">${escapeHtml(p.name)}</span>
            <span class="tv-pmeta flex items-center gap-[.4em]">${p.cardCount} card${p.cardCount === 1 ? '' : 's'} ${badge}${p.connected ? '' : ' · away'}</span>
          </span>
        </button>
      </li>`;
    }).join(sep) + (waiting.length
      ? `<li class="tv-pmeta ml-[1em]">Next round: ${waiting.map((p) => `${p.avatar} ${escapeHtml(p.name)}`).join(', ')}</li>`
      : '');

    const current = seated.find((p) => p.isCurrent);
    const latest = state.log[state.log.length - 1] || '';
    $('t-log').textContent = state.phase === 'playing' && current
      ? `${latest}${latest ? '. ' : ''}${current.name} to play.`
      : latest;

    // Big announcement (shouts, penalties, draw twos)
    if (state.flash && state.flash.id !== lastFlashId) {
      lastFlashId = state.flash.id;
      if (state.phase === 'playing') showFlash(state.flash);
    }
  }

  function showFlash(f) {
    const wrap = $('t-flash-wrap');
    wrap.innerHTML = `<p class="tv-flash tone-${f.tone}">${escapeHtml(f.text)}</p>`;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { wrap.innerHTML = ''; }, 2200);
  }

  // ---------- winner ----------
  function showWinner() {
    const winner = state.players.find((p) => p.id === state.winnerId);
    $('screen-winner').hidden = false;
    $('w-avatar').textContent = winner ? winner.avatar : '🏆';
    $('w-title').textContent = winner ? `${winner.name} wins!` : 'Round over';
    const ranked = [...state.players].sort((a, b) => b.wins - a.wins);
    $('w-scores').innerHTML = ranked.map((p) => `
      <li class="tv-player"><span class="tv-avatar">${p.avatar}</span>
        <span class="text-left"><span class="tv-pname block">${escapeHtml(p.name)}</span>
        <span class="tv-pmeta block">${p.wins} win${p.wins === 1 ? '' : 's'}${p.inRound && p.id !== state.winnerId ? ` · ${p.cardCount} left` : ''}</span></span>
      </li>`).join('');
    const key = `${state.round}:${state.winnerId}`;
    if (lastWinnerShown !== key) {
      lastWinnerShown = key;
      Confetti.start();
    }
  }

  function hideWinner() {
    $('screen-winner').hidden = true;
    Confetti.stop();
  }

  const Confetti = (() => {
    const canvas = $('confetti');
    const ctx = canvas.getContext('2d');
    const colours = Object.values(COLOR_HEX).concat('#ffffff');
    let parts = [];
    let raf = null;
    let until = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; }
    function spawn(n) {
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.3,
          vx: (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 5,
          w: 10 + Math.random() * 14, h: 6 + Math.random() * 8,
          r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
          c: colours[(Math.random() * colours.length) | 0],
        });
      }
    }
    function frame(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (t < until && parts.length < 260) spawn(6);
      parts = parts.filter((p) => p.y < canvas.height + 40);
      for (const p of parts) {
        p.x += p.vx * devicePixelRatio; p.y += p.vy * devicePixelRatio; p.r += p.vr; p.vy += 0.03;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      raf = parts.length || t < until ? requestAnimationFrame(frame) : null;
    }
    return {
      start() {
        if (reduce) return;
        resize(); parts = []; until = performance.now() + 4500;
        cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
      },
      stop() { cancelAnimationFrame(raf); raf = null; parts = []; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    };
  })();
  addEventListener('resize', () => { const c = $('confetti'); c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; });

  // ---------- host controls ----------
  $('btn-start').addEventListener('click', () => socket.emit('tv:start', {}, (r) => { if (r && !r.ok && r.error) alert(r.error); }));
  $('btn-again').addEventListener('click', () => socket.emit('tv:start', {}, (r) => { if (r && !r.ok && r.error) alert(r.error); }));
  $('btn-lobby').addEventListener('click', () => socket.emit('tv:lobby'));
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn || !state) return;
    const p = state.players.find((x) => x.id === btn.dataset.remove);
    if (p && confirm(`Remove ${p.name} from the game?${state.phase === 'playing' ? ' Their cards go back in the deck.' : ''}`)) {
      socket.emit('tv:remove', { id: p.id });
    }
  });
})();
