/* Last Card — TV (host) screen. Shows the public table only; never sees anyone's hand. */
(function () {
  'use strict';
  const { renderCard, tiltFor, escapeHtml, COLOR_HEX, COLOR_SOFT, COLOR_NAME, COLOR_MARK, isLight } = window.LC;
  const renderBack = (extra = '') => window.LC.renderBack(extra, state && state.side);
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'lastcard:tv';
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LEVEL_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;
  let lastTopId = null;
  let lastFlashId = null;
  let lastWinnerShown = null;
  let lastSeq = 0;
  let flashTimer = null;
  let arrivingId = null; // discard card hidden until its flight lands
  let lastStack = 0;
  let hot = null; // Hot Potato clock, in this screen's own time
  let hotRaf = null;

  // ---------- connection ----------
  function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } }

  function createRoom() {
    socket.emit('tv:create', {}, (res) => { if (res && res.ok) saveSession({ code: res.code, hostToken: res.hostToken }); });
  }

  socket.on('connect', () => {
    const s = loadSession();
    if (s) socket.emit('tv:resume', s, (res) => { if (!res || !res.ok) createRoom(); });
    else createRoom();
  });

  socket.on('update-tv', (s) => {
    const firstState = !state;
    state = s;
    const events = s.events || [];
    if (firstState) {
      // Don't replay old news after a reload.
      lastFlashId = s.flash ? s.flash.id : null;
      lastSeq = events.length ? events[events.length - 1].seq : 0;
    }
    if (!events.length) lastSeq = 0; // new round
    const fresh = events.filter((e) => e.seq > lastSeq);
    if (fresh.length) lastSeq = fresh[fresh.length - 1].seq;
    const lastPlay = [...fresh].reverse().find((e) => e.type === 'play' || e.type === 'flip');
    arrivingId = lastPlay && !REDUCE ? lastPlay.card.id : null;
    syncHot();
    render();
    if (state.phase !== 'lobby') animate(fresh);
  });

  // ---------- helpers ----------
  const mode = () => state.modes.find((m) => m.id === state.mode) || state.modes[0];

  function show(screen) {
    for (const id of ['screen-connecting', 'screen-lobby', 'screen-table']) $(id).hidden = id !== screen;
  }

  function setGlow(color) {
    const root = document.documentElement.style;
    root.setProperty('--glow', COLOR_HEX[color] || '#d9b45a');
    root.setProperty('--glow-soft', COLOR_SOFT[color] || 'rgba(217,180,90,.35)');
  }

  function render() {
    document.documentElement.style.setProperty('--accent', mode().accent);
    // Eclipse: the whole room switches between Day and Night.
    if (state.mode === 'eclipse' && state.phase !== 'lobby') document.body.dataset.side = state.side;
    else delete document.body.dataset.side;
    if (state.phase === 'lobby') { show('screen-lobby'); setGlow(null); renderLobby(); hideWinner(); return; }
    show('screen-table');
    renderTable();
    if (state.phase === 'finished') showWinner(); else hideWinner();
  }

  // ---------- lobby ----------
  function renderLobby() {
    $('lobby-code').textContent = state.code;
    $('qr').innerHTML = state.qrSvg;
    $('lobby-net-warning').hidden = !!state.hostLabel;
    $('lobby-url').textContent = state.hostLabel ? `No camera? Go to ${state.hostLabel} on your phone.` : '';

    // Game picker
    $('picker').innerHTML = state.modes.map((m) => `
      <button class="tv-tile ${m.ready ? '' : 'is-locked'}" style="--a:${m.accent}" data-mode="${m.id}" aria-pressed="${m.id === state.mode}">
        <span class="ic" aria-hidden="true">${m.icon}</span>
        <span class="nm">${escapeHtml(m.name)}</span>
        ${m.ready ? '' : '<span class="soon">Coming soon</span>'}
      </button>`).join('');
    const m = mode();
    $('feat-name').textContent = m.name;
    $('feat-tag').textContent = m.tagline;
    $('feat-rules').innerHTML = m.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + `<li>${escapeHtml(m.players)}</li>`;

    // Computer players
    $('bot-count').textContent = state.botCount;
    $('bot-minus').disabled = state.botCount <= 0;
    $('bot-plus').disabled = state.botCount >= state.maxBots;
    for (const b of $('bot-level').querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === state.botLevel));
    for (const el of document.querySelectorAll('[data-teams-only]')) el.hidden = !m.teams;
    for (const b of $('team-size').querySelectorAll('[data-size]')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === state.teamSize));

    // Match type
    $('match-type').innerHTML = state.match.types.map((t) => {
      const off = t.id === 'knockout' && m.teams;
      return `<button data-match="${t.id}" aria-pressed="${t.id === state.match.type}" ${off ? 'disabled title="Not with teams"' : ''}>${t.name}</button>`;
    }).join('');

    // Who's at the table
    const players = state.players;
    $('lobby-count').textContent = `${players.length} of ${m.solo ? 1 + state.maxBots : state.maxPlayers}`;
    $('lobby-empty').hidden = players.some((p) => !p.isBot);
    $('lobby-players').innerHTML = players.map(chipHtml).join('');

    const ready = players.filter((p) => p.connected).length;
    const humans = players.filter((p) => !p.isBot && p.connected).length;
    let hint = '';
    let ok = ready >= state.minPlayers && humans >= 1;
    if (m.solo) {
      ok = humans === 1 && state.botCount >= 1;
      hint = humans === 0 ? 'Scan the code with one phone to take your seat.' : humans > 1 ? 'Solo is for one player.' : state.botCount ? 'Press Deal, or deal from your phone.' : 'Add at least one computer player.';
    } else if (!humans) hint = 'Scan the code to take a seat.';
    else if (ready < state.minPlayers) hint = 'You need one more player. Add a computer player to play now.';
    else if (m.teams && state.teamProblem) { hint = state.teamProblem; ok = false; }
    else if (m.teams) hint = 'Teams are drawn at random when you deal.';
    else hint = 'Press Deal, or the first player can deal from their phone.';
    $('btn-start').disabled = !ok;
    $('lobby-hint').textContent = hint;
  }

  function chipHtml(p) {
    const meta = p.isBot
      ? `Computer, ${LEVEL_NAME[state.botLevel]}`
      : p.connected ? (p.isLeader ? 'Can deal from their phone' : 'Ready') : 'Phone asleep';
    return `<li><button class="tv-chip ${p.connected ? '' : 'is-away'}" data-remove="${p.id}" title="Remove ${escapeHtml(p.name)}">
      <span class="av">${p.avatar}</span>
      <span class="text-left"><span class="nm block">${escapeHtml(p.name)}</span><span class="mt block">${meta}${p.wins ? `, ${p.wins} win${p.wins > 1 ? 's' : ''}` : ''}</span></span>
    </button></li>`;
  }

  // ---------- table ----------
  function renderTable() {
    const m = mode();
    $('t-mode').innerHTML = `<span aria-hidden="true">${m.icon}</span>${escapeHtml(m.name)}`;
    $('t-round').textContent = state.round;
    const mt = state.match;
    $('t-match').textContent = mt.type === 'points' ? `First to ${mt.target}` : mt.type === 'knockout' ? `Knockout, ${mt.alive} left` : '';
    $('t-code').textContent = state.code;
    $('t-deck').innerHTML = (state.drawCount > 0 ? renderBack() : '<div class="lc-card" style="opacity:.15"></div>')
      + `<span class="tv-deck-count">${state.drawCount} to draw</span>`;

    // Discard pile: last few cards, newest on top.
    const pile = state.discard;
    const top = pile[pile.length - 1];
    const isNew = top && top.id !== lastTopId;
    $('t-discard').innerHTML = pile.map((c, i) => {
      const newest = i === pile.length - 1;
      const cls = newest && c.id === arrivingId ? 'is-arriving' : newest && isNew && !arrivingId ? 'lc-landing' : '';
      return renderCard(c, { extraClass: cls, attrs: `style="--tilt:${tiltFor(c.id)}deg;transform:rotate(${tiltFor(c.id)}deg)"` });
    }).join('') + (state.stack ? `<span class="tv-stack ${state.stack.total !== lastStack ? 'pop' : ''}" aria-label="${state.stack.total} cards stacked">+${state.stack.total}</span>` : '');
    lastStack = state.stack ? state.stack.total : 0;
    lastTopId = top ? top.id : null;

    setGlow(state.activeColor);
    const chip = $('t-color');
    chip.innerHTML = state.activeColor ? `<span aria-hidden="true">${COLOR_MARK[state.activeColor]}</span>${COLOR_NAME[state.activeColor]}` : (state.phase === 'playing' ? 'Any colour' : '');
    chip.classList.toggle('is-yellow', !state.activeColor || isLight(state.activeColor));

    const trail = $('t-trail');
    trail.classList.toggle('ccw', state.direction !== 1);

    renderSeats();

    const seated = state.players.filter((p) => p.inRound);
    const current = seated.find((p) => p.isCurrent);
    const latest = state.log[state.log.length - 1] || '';
    $('t-log').textContent = state.phase === 'playing' && current ? `${latest}${!latest ? '' : /[.!?]$/.test(latest) ? ' ' : '. '}${current.name} to play.` : latest;
    const waiting = state.players.filter((p) => !p.inRound && !p.out);
    const out = state.players.filter((p) => p.out);
    $('t-wait').textContent = [
      waiting.length ? `Joining next round: ${waiting.map((p) => p.name).join(', ')}` : '',
      out.length ? `Knocked out: ${out.map((p) => p.name).join(', ')}` : '',
    ].filter(Boolean).join('. ');
    $('t-stage').classList.toggle('is-hot', !!state.fuse);
    const frenzy = state.mode === 'frenzy' && state.phase === 'playing';
    $('t-stage').classList.toggle('is-frenzy', frenzy);
    if (frenzy) $('t-log').innerHTML = `<span class="tv-go">Anyone can play!</span> ${escapeHtml(latest)}`;

    if (state.flash && state.flash.id !== lastFlashId) {
      lastFlashId = state.flash.id;
      if (state.phase === 'playing') showFlash(state.flash);
    }
  }

  function seatPos(i, n) {
    const a = (90 + (i * 360) / n) * (Math.PI / 180); // seat 0 at the bottom, clockwise
    return { x: 50 + 45 * Math.cos(a), y: 50 + 40 * Math.sin(a) };
  }

  function renderSeats() {
    const wrap = $('t-seats');
    const seated = state.players.filter((p) => p.inRound);
    const keep = new Set();
    seated.forEach((p, i) => {
      keep.add(p.id);
      let el = wrap.querySelector(`[data-seat="${p.id}"]`);
      if (!el) {
        el = document.createElement('button');
        el.className = 'tv-seat';
        el.dataset.seat = p.id;
        el.dataset.remove = p.id;
        wrap.appendChild(el);
      }
      const pos = seatPos(i, seated.length);
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
      el.title = `Remove ${p.name}`;
      const last = p.cardCount === 1 && state.phase === 'playing';
      el.classList.toggle('is-current', p.isCurrent);
      el.classList.toggle('is-last', last && !p.called);
      el.classList.toggle('is-away', !p.connected);
      el.classList.toggle('is-frozen', !!p.frozen);
      el.classList.toggle('is-winner', state.phase === 'finished' && (p.id === state.winnerId || (state.winnerTeam !== null && p.team === state.winnerTeam)));
      const team = state.teams && p.team !== null ? state.teams[p.team] : null;
      if (team) { el.dataset.team = p.team; el.style.setProperty('--team', team.color); }
      else { delete el.dataset.team; el.style.removeProperty('--team'); }

      const badge = p.cardCount === 1 && state.phase === 'playing'
        ? `<span class="badge ${p.called ? 'tone-success' : 'tone-danger'}">${p.called ? 'Last card!' : '1 card'}</span>` : '';
      const shown = Math.min(p.cardCount, 9);
      const fan = `<span class="tv-fan" style="width:calc(var(--w) + ${Math.max(0, shown - 1) * 0.42}em)">${
        Array.from({ length: shown }, (_, k) => `<span class="lc-card lc-back" style="left:${k * 0.42}em;transform:rotate(${(k - (shown - 1) / 2) * 4}deg)"></span>`).join('')
      }</span>`;
      const meta = p.isCurrent && p.isBot && state.phase === 'playing'
        ? `<span class="thinking" aria-label="Thinking"><i></i><i></i><i></i></span>`
        : `${fan}<span>${p.cardCount}</span>`;
      const html = `<span class="disc"><span class="em">${p.avatar}</span>${badge}</span>
        <span class="name">${escapeHtml(p.name)}</span>
        ${team ? `<span class="team-tag">Team ${team.name}${p.isBot ? ', computer' : ''}</span>` : p.isBot ? `<span class="bot-tag">Computer</span>` : ''}
        <span class="meta">${p.connected ? meta : 'Away'}${state.match.type === 'points' ? `<span class="pts">${p.points} pts</span>` : ''}</span>`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    });
    for (const el of [...wrap.children]) if (!keep.has(el.dataset.seat)) el.remove();
  }

  function seatEl(id) { return $('t-seats').querySelector(`[data-seat="${id}"]`); }

  function showFlash(f) {
    const wrap = $('t-flash-wrap');
    wrap.innerHTML = `<p class="tv-flash tone-${f.tone}">${escapeHtml(f.text)}</p>`;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { wrap.innerHTML = ''; }, 2300);
  }

  // ---------- animation: cards flying between seats and the piles ----------
  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function cardWidth() {
    const c = document.querySelector('#t-deck .lc-card, #t-discard .lc-card');
    return c ? c.getBoundingClientRect().width : 140;
  }

  function fly(html, fromEl, toEl, { startScale = 0.3, endScale = 1, tilt = 0, duration = 520 } = {}) {
    if (!fromEl || !toEl || REDUCE) return Promise.resolve();
    const w = cardWidth();
    const a = centre(fromEl.getBoundingClientRect());
    const b = centre(toEl.getBoundingClientRect());
    const el = document.createElement('div');
    el.className = 'fly-card';
    el.style.setProperty('--w', `${w}px`);
    el.innerHTML = html;
    document.body.appendChild(el);
    const h = w * 1.5;
    const anim = el.animate([
      { transform: `translate(${a.x - w / 2}px, ${a.y - h / 2}px) scale(${startScale}) rotate(-25deg)`, opacity: 0 },
      { opacity: 1, offset: 0.12 },
      { transform: `translate(${b.x - w / 2}px, ${b.y - h / 2}px) scale(${endScale}) rotate(${tilt}deg)`, opacity: 1 },
    ], { duration, easing: 'cubic-bezier(.2,.75,.25,1)' });
    return anim.finished.then(() => el.remove(), () => el.remove());
  }

  function spotlight(id) {
    const s = seatEl(id);
    if (!s || REDUCE) return;
    const stage = $('t-stage').getBoundingClientRect();
    const c = centre(s.getBoundingClientRect());
    const spot = $('t-spot');
    spot.style.setProperty('--sx', `${((c.x - stage.left) / stage.width) * 100}%`);
    spot.style.setProperty('--sy', `${((c.y - stage.top) / stage.height) * 100}%`);
    spot.classList.remove('on'); void spot.offsetWidth; spot.classList.add('on');
  }

  function shakeTable() {
    if (REDUCE) return;
    const st = $('t-stage');
    st.classList.remove('is-hit'); void st.offsetWidth; st.classList.add('is-hit');
  }

  async function animate(events) {
    for (const e of events) {
      if (e.type === 'play') {
        const top = $('t-discard').querySelector(`[data-id="${e.card.id}"]`);
        await fly(renderCard(e.card), seatEl(e.by), $('t-discard'), { tilt: tiltFor(e.card.id) });
        if (top) top.classList.remove('is-arriving');
        if (arrivingId === e.card.id) arrivingId = null;
      } else if (e.type === 'draw') {
        const n = Math.min(e.n, 6);
        const flights = [];
        for (let k = 0; k < n; k++) {
          flights.push(wait(k * 110).then(() => fly(renderBack(), $('t-deck'), seatEl(e.by), { startScale: 1, endScale: 0.25, duration: 460 })));
        }
        await Promise.all(flights);
      } else if (e.type === 'flip') {
        const top = $('t-discard').querySelector(`[data-id="${e.card.id}"]`);
        await fly(renderCard(e.card), $('t-deck'), $('t-discard'), { startScale: 1, tilt: tiltFor(e.card.id), duration: 450 });
        if (top) top.classList.remove('is-arriving');
      } else if (e.type === 'freeze') {
        if (!REDUCE) { const f = $('t-frost'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
        spotlight(e.by);
        // seats thaw on their own: re-render when the freeze ends
        setTimeout(() => { if (state && state.phase === 'playing') socket.emit('tv:ping'); }, e.ms + 50);
      } else if (e.type === 'wrong') {
        spotlight(e.by);
      } else if (e.type === 'eclipse') {
        if (!REDUCE) {
          const ov = $('t-eclipse');
          ov.classList.remove('on'); void ov.offsetWidth; ov.classList.add('on');
          setTimeout(() => ov.classList.remove('on'), 1900);
        }
        const pile = $('t-discard');
        pile.classList.add('flip-in');
        setTimeout(() => pile.classList.remove('flip-in'), 700);
      } else if (e.type === 'boom') {
        if (!REDUCE) { const b = $('t-boom'); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
        shakeTable();
        spotlight(e.by);
      } else if (e.type === 'hit') {
        shakeTable();
      } else if (e.type === 'swap') {
        const out = [];
        for (let k = 0; k < 3; k++) {
          out.push(wait(k * 120).then(() => fly(renderBack(), seatEl(e.by), seatEl(e.with), { startScale: 0.35, endScale: 0.35, duration: 620 })));
          out.push(wait(k * 120).then(() => fly(renderBack(), seatEl(e.with), seatEl(e.by), { startScale: 0.35, endScale: 0.35, duration: 620 })));
        }
        await Promise.all(out);
      } else if (e.type === 'rotate') {
        const seated = state.players.filter((p) => p.inRound);
        const n = seated.length;
        await Promise.all(seated.map((p, i) => fly(renderBack(), seatEl(p.id), seatEl(seated[((i + e.direction) % n + n) % n].id), { startScale: 0.35, endScale: 0.35, duration: 700 })));
      } else if (e.type === 'shout' || e.type === 'penalty' || e.type === 'win') {
        spotlight(e.by);
      }
    }
    // Safety: never leave the top card hidden.
    const hidden = $('t-discard').querySelector('.is-arriving');
    if (hidden) hidden.classList.remove('is-arriving');
  }

  // ---------- Hot Potato: a spark racing round the rim, and a 5-second clock on whoever's turn it is ----------
  function syncHot() {
    const f = state.fuse;
    if (!f || state.phase !== 'playing') { stopHot(); return; }
    const now = performance.now();
    const ang = hot ? hot.ang : Math.PI / 2;
    hot = { litAt: now - f.elapsed, deadline: now + f.turnLeft, turnMs: f.turnMs, ang, last: now };
    if (!hotRaf) hotRaf = requestAnimationFrame(hotLoop);
  }

  function stopHot() {
    hot = null;
    cancelAnimationFrame(hotRaf);
    hotRaf = null;
    for (const c of document.querySelectorAll('.tv-seat .clock')) c.remove();
  }

  function hotLoop(now) {
    if (!hot) { hotRaf = null; return; }
    const dt = Math.min(64, now - hot.last);
    hot.last = now;
    const heat = Math.min(1, (now - hot.litAt) / 40000); // gets angrier the longer it burns
    const stage = $('t-stage');
    stage.style.setProperty('--heat', heat.toFixed(3));
    stage.style.setProperty('--beat', `${(1.4 - heat * 0.95).toFixed(2)}s`);
    if (!REDUCE) hot.ang += dt * (0.0011 + heat * 0.0026);
    const spark = $('t-spark');
    spark.style.left = `${50 + 43 * Math.cos(hot.ang)}%`;
    spark.style.top = `${50 + 43 * Math.sin(hot.ang)}%`;
    const t = Math.max(0, (hot.deadline - now) / hot.turnMs);
    for (const disc of $('t-seats').querySelectorAll('.tv-seat .disc')) {
      const current = disc.parentElement.classList.contains('is-current');
      let c = disc.querySelector('.clock');
      if (current && !c) { c = document.createElement('span'); c.className = 'clock'; disc.appendChild(c); }
      if (!current && c) c.remove();
      if (current) c.style.setProperty('--t', t.toFixed(3));
    }
    hotRaf = requestAnimationFrame(hotLoop);
  }

  // Tag Team: show that someone signalled their partner, without saying what.
  socket.on('signal-sent', ({ by } = {}) => {
    const s = seatEl(by);
    if (!s) return;
    const disc = s.querySelector('.disc');
    const b = document.createElement('span');
    b.className = 'tv-bubble';
    b.textContent = '💬';
    disc.appendChild(b);
    setTimeout(() => b.remove(), 2100);
  });

  // ---------- winner ----------
  function showWinner() {
    const winner = state.players.find((p) => p.id === state.winnerId);
    $('screen-winner').hidden = false;
    $('w-avatar').textContent = winner ? winner.avatar : '🏆';
    const team = state.teams && state.winnerTeam !== null ? state.teams[state.winnerTeam] : null;
    if (team) {
      const members = state.players.filter((p) => p.team === state.winnerTeam);
      $('w-avatar').textContent = members.map((p) => p.avatar).join(' ');
      $('w-title').textContent = `Team ${team.name} wins`;
    } else {
      $('w-title').textContent = winner ? `${winner.name} wins` : 'Round over';
    }
    const mt = state.match;
    const byPoints = mt.type === 'points';
    const champ = mt.over ? state.players.find((p) => p.id === mt.championId) : null;
    if (champ) {
      $('w-avatar').textContent = champ.avatar;
      $('w-title').textContent = `${champ.name} wins the match`;
    }
    let sub = '';
    if (byPoints) {
      const gainers = Object.keys(mt.gains).map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
      const pts = gainers.length ? mt.gains[gainers[0].id] : 0;
      sub = gainers.length ? `${gainers.map((p) => p.name).join(' and ')} score${gainers.length === 1 ? 's' : ''} ${pts} point${pts === 1 ? '' : 's'}` : '';
      if (!mt.over) sub += `${sub ? '. ' : ''}First to ${mt.target} wins the match.`;
    } else if (mt.type === 'knockout') {
      const outNow = mt.knocked.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
      sub = outNow.length ? `${outNow.map((p) => p.name).join(', ')} ${outNow.length === 1 ? 'is' : 'are'} knocked out, holding the most cards.` : '';
      if (!mt.over) sub += ` ${mt.alive} left in.`;
    }
    $('w-sub').textContent = sub;
    $('btn-again').textContent = mt.over ? 'Start a new match' : 'Deal next round';
    const score = (p) => (byPoints ? p.points : p.wins);
    const ranked = [...state.players].sort((a, b) => score(b) - score(a) || a.out - b.out);
    const best = ranked.length ? score(ranked[0]) : 0;
    $('w-scores').innerHTML = ranked.map((p) => `
      <li class="tv-chip ${score(p) === best && best > 0 ? 'is-top' : ''} ${p.out ? 'is-away' : ''}"><span class="av">${p.avatar}</span>
        <span class="text-left"><span class="nm block">${escapeHtml(p.name)}</span>
        <span class="mt block">${byPoints ? `${p.points} pts${mt.gains[p.id] ? ` (+${mt.gains[p.id]})` : ''}` : `${p.wins} win${p.wins === 1 ? '' : 's'}`}${p.out ? ', out' : p.inRound && p.id !== state.winnerId && !byPoints ? `, ${p.cardCount} left` : ''}</span></span>
      </li>`).join('');
    const key = `${state.round}:${state.winnerId}`;
    if (lastWinnerShown !== key) {
      lastWinnerShown = key;
      setTimeout(() => CardRain.start(), 300);
    }
  }

  function hideWinner() {
    $('screen-winner').hidden = true;
    CardRain.stop();
  }

  /** Winner celebration: a shower of little jewel-coloured cards. */
  const CardRain = (() => {
    const canvas = $('confetti');
    const ctx = canvas.getContext('2d');
    const colours = Object.values(COLOR_HEX);
    let parts = [];
    let raf = null;
    let until = 0;

    function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; }
    function spawn(n, burst) {
      const d = devicePixelRatio;
      for (let i = 0; i < n; i++) {
        const w = (18 + Math.random() * 22) * d;
        parts.push({
          x: Math.random() * canvas.width,
          y: burst ? -60 * d + Math.random() * canvas.height * 0.45 : -60 * d - Math.random() * canvas.height * 0.2,
          vx: (Math.random() - 0.5) * 3, vy: 3.5 + Math.random() * 4,
          w, h: w * 1.5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.12,
          flip: Math.random() * Math.PI, vf: 0.05 + Math.random() * 0.08,
          c: colours[(Math.random() * colours.length) | 0],
        });
      }
    }
    function card(p) {
      const sx = Math.cos(p.flip); // spin in 3D by squashing the width
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(sx, 1);
      const w = p.w, h = p.h, r = w * 0.12;
      ctx.fillStyle = '#fbf6e8';
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.fill();
      ctx.fillStyle = sx > 0 ? p.c : '#14306b';
      ctx.beginPath(); ctx.roundRect(-w / 2 + w * 0.08, -h / 2 + w * 0.08, w * 0.84, h - w * 0.16, r * 0.7); ctx.fill();
      if (sx > 0) { ctx.fillStyle = '#fbf6e8'; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.3, h * 0.3, 0.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    function frame(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (t < until && parts.length < 140) spawn(3);
      parts = parts.filter((p) => p.y < canvas.height + 80);
      const d = devicePixelRatio;
      for (const p of parts) {
        p.x += p.vx * d; p.y += p.vy * d; p.r += p.vr; p.flip += p.vf; p.vy += 0.025;
        card(p);
      }
      raf = parts.length || t < until ? requestAnimationFrame(frame) : null;
    }
    return {
      start() {
        if (REDUCE || !ctx.roundRect) return;
        resize(); parts = []; spawn(45, true); until = performance.now() + 4000;
        cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
      },
      stop() { cancelAnimationFrame(raf); raf = null; parts = []; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    };
  })();
  addEventListener('resize', () => { const c = $('confetti'); c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; });

  // ---------- host controls ----------
  const complain = (r) => { if (r && !r.ok && r.error) showLobbyHint(r.error); };
  function showLobbyHint(text) {
    if (state && state.phase === 'lobby') $('lobby-hint').textContent = text;
    else alert(text);
  }
  const deal = () => socket.emit('tv:start', {}, complain);
  $('btn-start').addEventListener('click', deal);
  $('btn-again').addEventListener('click', deal);
  $('btn-lobby').addEventListener('click', () => socket.emit('tv:lobby'));

  $('picker').addEventListener('click', (e) => {
    const t = e.target.closest('[data-mode]');
    if (!t || !state) return;
    socket.emit('tv:mode', { id: t.dataset.mode }, complain);
  });
  $('bot-minus').addEventListener('click', () => socket.emit('tv:bots', { count: state.botCount - 1 }, complain));
  $('bot-plus').addEventListener('click', () => socket.emit('tv:bots', { count: state.botCount + 1 }, complain));
  $('match-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-match]');
    if (b && !b.disabled) socket.emit('tv:match', { type: b.dataset.match }, complain);
  });
  $('team-size').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (b) socket.emit('tv:teamsize', { size: Number(b.dataset.size) }, complain);
  });
  $('bot-level').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b) socket.emit('tv:bots', { level: b.dataset.level }, complain);
  });

  // Keyboard: arrows choose a game, Enter deals.
  document.addEventListener('keydown', (e) => {
    if (!state || e.target.closest('input, textarea')) return;
    if (state.phase === 'lobby' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const ready = state.modes.filter((m) => m.ready);
      const i = ready.findIndex((m) => m.id === state.mode);
      const next = ready[(i + (e.key === 'ArrowRight' ? 1 : -1) + ready.length) % ready.length];
      socket.emit('tv:mode', { id: next.id }, complain);
    } else if (e.key === 'Enter' && state.phase !== 'playing' && !e.target.closest('button')) {
      deal();
    }
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn || !state) return;
    const p = state.players.find((x) => x.id === btn.dataset.remove);
    if (p && confirm(`Remove ${p.name} from the game?${state.phase === 'playing' ? ' Their cards go back in the deck.' : ''}`)) {
      socket.emit('tv:remove', { id: p.id });
    }
  });
})();
