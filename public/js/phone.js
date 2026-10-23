/* Last Card — phone controller. Shows only this player's private hand. */
(function () {
  'use strict';
  const { renderCard, sortHand, escapeHtml, COLOR_NAME, COLOR_MARK, COLOR_HEX, COLOR_SOFT, isLight } = window.LC;
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'lastcard:player';
  const AvatarLib = window.LastCardAvatars;
  const AVATARS = AvatarLib.ids.slice();
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buzz = (p) => { if (navigator.vibrate) navigator.vibrate(p); };

  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;
  let session = loadSession();
  let chosenAvatar = AvatarLib.isValid(session && session.avatar) ? AvatarLib.normalize(session.avatar) : AVATARS[(Math.random() * AVATARS.length) | 0];
  let busy = false;
  let wildCardId = null;
  let swapCardId = null;
  let lastSide = null;
  let fz = null; // Frenzy: local deadlines { frozenAt, lockedAt, drawAt }
  let fzTimer = null;
  let hot = null; // Hot Potato clock in this phone's own time
  let hotRaf = null;
  let knownIds = new Set();
  let wasMyTurn = false;
  let lastFlashId = null;
  let toastTimer = null;
  let handKey = '';
  let solo = { count: 3, level: 'medium' };

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

  function setGlow(color) {
    const root = document.documentElement.style;
    root.setProperty('--glow', COLOR_HEX[color] || '#d9b45a');
    root.setProperty('--glow-soft', COLOR_SOFT[color] || 'rgba(217,180,90,.35)');
  }

  function showJoin(error) {
    show('screen-join');
    setGlow(null);
    $('edge').classList.remove('on');
    const code = codeFromUrl() || (session && session.code) || '';
    if (!$('in-code').value) $('in-code').value = code;
    if (!$('in-name').value && session && session.name) $('in-name').value = session.name;
    $('join-error').textContent = error || '';
    renderAvatars();
    renderHero();
    for (const m of ['modal-end', 'modal-wild', 'modal-solo', 'modal-swap']) $(m).hidden = true;
  }

  function renderHero() {
    const cards = [
      { id: 'h1', color: 'red', value: '7' },
      { id: 'h2', color: 'wild', value: 'wild' },
      { id: 'h3', color: 'blue', value: 'reverse' },
    ];
    $('hero').innerHTML = cards.map((c, i) => renderCard(c, { attrs: `style="transform:translateX(-50%) rotate(${(i - 1) * 16}deg)"` })).join('');
  }

  function renderAvatars() {
    $('avatars').innerHTML = AVATARS.map((a) => {
      const def = AvatarLib.find(a);
      return `<button type="button" class="ph-avatar" data-avatar="${a}" aria-pressed="${a === chosenAvatar}" aria-label="Choose avatar ${escapeHtml(def.name)}" title="${escapeHtml(def.name)}"><img class="lc-avatar-badge" src="${def.image}" alt="" width="54" height="54" loading="eager" decoding="async"><span class="lc-avatar-name">${escapeHtml(def.name)}</span></button>`;
    }).join('');
  }

  // ---------- connection ----------
  function join(payload) {
    if (!socket.connected) return;
    $('btn-join').disabled = true;
    socket.timeout(8000).emit('player:join', payload, (err, res) => {
      $('btn-join').disabled = false;
      if (err) {
        toast('The server is not responding. Retrying when connected.', 'info', 3200);
        return;
      }
      if (!res || !res.ok) {
        // Keep valid seat credentials on transient errors. Clear them only when
        // the server explicitly rejects the session or the room no longer exists.
        const reason = (res && res.error) || 'Could not join the table.';
        const invalid = /credentials expired|no game with that code/i.test(reason);
        if (payload.playerId && invalid) {
          clearSession();
          chosenAvatar = AvatarLib.isValid(session && session.avatar) ? AvatarLib.normalize(session.avatar) : chosenAvatar;
        }
        showJoin(reason);
        return;
      }
      hideToast();
      saveSession({ code: res.code, playerId: res.playerId, resumeToken: res.resumeToken,
        name: payload.name || (session && session.name), avatar: AvatarLib.normalize(payload.avatar || (session && session.avatar) || chosenAvatar) });
      if (location.pathname !== '/join') history.replaceState(null, '', '/join');
    });
  }

  socket.on('connect', () => {
    const urlCode = codeFromUrl();
    if (session && session.playerId && session.code && (!urlCode || urlCode === session.code)) {
      join({ code: session.code, playerId: session.playerId, resumeToken: session.resumeToken });
    } else if (!state) {
      showJoin();
    }
  });

  socket.on('disconnect', () => { busy = false; toast('Connection lost — reconnecting…', 'info', 60000); });
  socket.on('removed', () => { clearSession(); state = null; showJoin('You were removed from the game.'); });

  socket.on('update-player', (s) => {
    const first = !state;
    state = s;
    hideToast();
    if (first) { lastFlashId = s.flash ? s.flash.id : null; knownIds = new Set(s.hand.map((c) => c.id)); hideToast(); }
    render();
  });

  // ---------- rendering ----------
  function render() {
    busy = false;
    const mode = state.modes.find((m) => m.id === state.mode);
    if (mode) document.documentElement.style.setProperty('--accent', mode.accent);
    syncHot();
    if (state.frenzy) {
      const now = performance.now();
      fz = { frozenAt: now + state.frenzy.frozenFor, lockedAt: now + state.frenzy.lockedFor, drawAt: now + state.frenzy.drawWait };
    } else fz = null;
    if (state.mode === 'eclipse' && state.phase !== 'lobby' && state.inRound) document.body.dataset.side = state.side;
    else delete document.body.dataset.side;
    if (state.phase === 'lobby' || !state.inRound) { renderWait(); return; }
    renderPlay();
  }

  function renderWait() {
    show('screen-wait');
    setGlow(null);
    $('edge').classList.remove('on');
    handKey = '';
    if (state.phase === 'finished' && state.winner) renderEnd();
    else $('modal-end').hidden = true;
    $('w-avatar').textContent = state.me.avatar;
    $('w-name').textContent = state.me.name;
    $('w-code').textContent = state.code;
    const leader = state.lobby.find((p) => p.isLeader);
    const lead = state.me.isLeader;
    const mode = state.modes.find((m) => m.id === state.mode);
    let msg;
    if (state.me.out) msg = "You've been knocked out. Watch the TV, you're back in for the next match.";
    else if (state.phase === 'playing') msg = "A round is being played. You'll be dealt in next round.";
    else if (lead) msg = canDeal() ? 'Pick a game, then deal when everyone is in.' : mode.solo ? 'Add a computer player to start.' : 'Waiting for one more player, or add a computer player.';
    else msg = `You're in. Watch the TV, ${leader ? escapeHtml(leader.name) : 'the host'} will deal.`;
    $('w-message').innerHTML = msg;

    // Game choice: the first player picks, everyone else sees what's chosen.
    $('w-modes-wrap').hidden = state.tvless;
    const picking = lead && state.phase !== 'playing';
    const list = picking ? state.modes.filter((m) => m.ready) : [mode];
    const soon = state.modes.filter((m) => !m.ready).map((m) => m.name);
    $('w-modes-label').textContent = picking ? 'Choose the game' : 'Game';
    $('w-modes').innerHTML = list.map((m) => `
      <button type="button" class="ph-mode" style="--a:${m.accent}" data-mode="${m.id}" aria-pressed="${m.id === state.mode}" ${m.ready && lead ? '' : 'disabled'} ${lead ? '' : 'tabindex="-1"'}>
        <span class="ic" aria-hidden="true">${m.icon}</span>
        <span class="flex-1 min-w-0"><span class="nm">${escapeHtml(m.name)}</span><span class="tg">${m.ready ? escapeHtml(m.tagline) : 'Coming soon'}</span></span>
      </button>`).join('') + (picking && soon.length ? `<p class="ph-soon">Coming soon: ${soon.join(', ')}</p>` : '');
    if (!lead) { const b = $('w-modes').querySelector('button'); if (b) b.disabled = false; }

    // Computer players (first player only)
    $('w-bots').hidden = !lead || state.phase === 'playing';
    $('w-bot-count').textContent = state.botCount;
    $('w-bot-minus').disabled = state.botCount <= 0;
    $('w-bot-plus').disabled = state.botCount >= state.maxBots;
    for (const b of $('w-bot-level').querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === state.botLevel));
    $('w-teams').hidden = !mode.teams;
    for (const b of $('w-team-size').querySelectorAll('[data-size]')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === state.teamSize));
    $('w-match-wrap').hidden = !lead || state.phase === 'playing';
    $('w-match').innerHTML = state.match.types.map((t) => `<button data-match="${t.id}" aria-pressed="${t.id === state.match.type}" ${t.id === 'knockout' && mode.teams ? 'disabled' : ''}>${t.short}</button>`).join('');
    $('w-team-problem').hidden = !(mode.teams && state.teamProblem && state.phase !== 'playing');
    $('w-team-problem').textContent = state.teamProblem || '';

    $('btn-start').hidden = !(lead && state.phase !== 'playing');
    $('btn-start').disabled = !canDeal();
    $('w-players').innerHTML = state.lobby.map((p) => `
      <li class="ph-seat ${p.connected ? '' : 'opacity-50'}" style="border-radius:18px;padding:.45rem .9rem .45rem .45rem">
        <span class="av" style="width:42px;height:42px;font-size:1.5rem">${p.avatar}</span>
        <span class="flex-1 font-extrabold text-lg">${escapeHtml(p.name)}${p.isBot ? ' <span class="muted text-sm">computer</span>' : ''}</span>
        <span class="muted font-bold">${p.wins ? `${p.wins} win${p.wins > 1 ? 's' : ''}` : ''}</span>
      </li>`).join('');
  }

  function canDeal() {
    const mode = state.modes.find((m) => m.id === state.mode);
    if (mode && mode.solo) return state.phase !== 'playing' && state.humanCount === 1 && state.botCount >= 1;
    if (mode && mode.teams && state.teamProblem) return false;
    return state.canStart;
  }

  const teamInfo = (i) => (state.teams && i !== null && i !== undefined ? state.teams[i] : null);

  function renderPlay() {
    show('screen-play');
    setGlow(state.activeColor);
    $('p-avatar').textContent = state.me.avatar;
    $('p-name').textContent = state.me.name;
    const myTeam = teamInfo(state.myTeam);
    $('p-team').hidden = !myTeam;
    if (myTeam) {
      $('p-team').textContent = `Team ${myTeam.name}`;
      document.documentElement.style.setProperty('--team', myTeam.color);
    }
    $('p-count').innerHTML = `${state.hand.length} card${state.hand.length === 1 ? '' : 's'}${state.match.type === 'points' ? `, <span class="ph-pts">${state.me.points} pts</span>` : ''}`;
    const yellow = !state.activeColor || isLight(state.activeColor);

    // Seats around the table
    $('p-seats').innerHTML = state.seats.map((o) => {
      const thinking = o.isCurrent && o.isBot && state.phase === 'playing';
      const t = teamInfo(o.team);
      const partner = t && !o.isMe && o.team === state.myTeam;
      return `<li class="ph-seat ${o.isCurrent ? 'is-current' : ''} ${o.frozen ? 'is-frozen' : ''} ${o.isMe ? 'is-me' : ''} ${partner ? 'is-partner' : ''} ${o.cardCount === 1 && !o.called && state.phase === 'playing' ? 'is-last' : ''}" ${t ? `style="--team:${t.color}"` : ''}>
        <span class="av">${o.avatar}</span>
        ${t ? '<span class="tdot" aria-hidden="true"></span>' : ''}
        <span class="n">${o.isMe ? 'You' : escapeHtml(o.name)}${partner ? ' <span class="muted text-xs">partner</span>' : ''}</span>
        ${thinking ? '<span class="thinking" aria-label="Thinking"><i></i><i></i><i></i></span>' : `<span class="c">${o.cardCount}</span>`}
      </li>`;
    }).join('');
    const cur = $('p-seats').querySelector('.is-current');
    if (cur) cur.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });

    // Table centre
    $('p-top').innerHTML = state.topCard ? renderCard(state.topCard) : '';
    const c = state.activeColor;
    $('p-color').innerHTML = c ? `<span aria-hidden="true">${COLOR_MARK[c]}</span>${COLOR_NAME[c]}` : 'Any colour';
    $('p-color').classList.toggle('is-yellow', yellow);
    $('p-log').textContent = state.log || '';
    $('p-fuse').hidden = !state.fuse;
    $('p-stack').hidden = !state.stack;
    if (state.stack) $('p-stack').textContent = `+${state.stack.total}`;

    // Turn banner, edge glow and a buzz when it becomes your turn
    const turn = $('p-turn');
    const mine = state.isMyTurn && state.phase === 'playing';
    turn.classList.toggle('is-mine', mine);
    turn.classList.toggle('is-yellow', mine && yellow);
    if (state.phase === 'finished') turn.textContent = 'Round over';
    else if (mine && state.mustTake) turn.textContent = state.playableIds.length ? `+${state.mustTake} on you! Stack another, or take them` : `+${state.mustTake} on you. Nothing to stack, take them`;
    else if (mine && state.fuse) turn.textContent = state.canPass ? 'Quick! Play it or keep it' : state.canDraw ? 'Quick! Draw a card' : 'Quick! Your turn';
    else if (mine) turn.textContent = state.canPass ? 'Play the card you drew, or keep it' : state.canDraw ? 'No match. Draw a card' : 'Your turn';
    else {
      const who = state.seats.find((s) => s.isCurrent);
      turn.textContent = who ? `${who.name} ${who.isBot ? 'is thinking' : 'is playing'}…` : '';
    }
    $('edge').classList.toggle('on', mine && !state.fuse);
    $('edge').classList.toggle('hot', !!state.fuse);
    $('p-clock').hidden = !(mine && state.fuse);
    if (state.frenzy) renderFrenzyStatus();
    if (mine && !wasMyTurn) buzz([60, 40, 60]);
    wasMyTurn = mine;

    // Action buttons
    const draw = $('btn-draw');
    draw.classList.remove('is-ready', 'is-keep', 'is-take');
    if (state.mustTake) { draw.textContent = `Take ${state.mustTake}`; draw.classList.add('is-take'); draw.disabled = false; }
    else if (state.canPass) { draw.textContent = 'Keep this card'; draw.classList.add('is-keep'); draw.disabled = false; }
    else { draw.textContent = 'Draw a card'; draw.disabled = !state.canDraw; if (state.canDraw) draw.classList.add('is-ready'); }
    if (state.frenzy) {
      draw.textContent = 'Draw a card';
      draw.disabled = !state.canDraw;
      draw.classList.toggle('is-ready', !!state.canDraw);
    }
    const shout = $('btn-shout');
    shout.classList.toggle('is-called', !!state.called);
    shout.classList.toggle('is-live', !state.called && !!state.canShout);
    shout.textContent = state.called ? 'Called ✓' : 'Last Card!';

    // Tag Team signals
    const signals = !!myTeam && state.phase === 'playing';
    $('p-signals').hidden = !signals;
    if (!signals) $('p-have').hidden = true;

    renderHand();
    $('p-hint').textContent = (mine || state.frenzy) && state.playableIds.length ? 'Swipe a glowing card up, or tap it' : '';

    if (state.phase === 'finished') renderEnd(); else $('modal-end').hidden = true;

    if (state.flash && state.flash.id !== lastFlashId) {
      lastFlashId = state.flash.id;
      const f = state.flash;
      if (state.phase === 'playing') {
        toast(f.who === state.me.id && f.you ? f.you : f.text, f.tone);
        if (f.who === state.me.id && f.tone !== 'success') buzz([120, 60, 120]);
      }
    }
  }

  // ---------- the hand: a fanned arc you can scroll along ----------
  function renderHand() {
    const hand = sortHand(state.hand);
    const playable = new Set(state.playableIds);
    const handEl = $('p-hand');
    handEl.classList.toggle('is-turn', state.isMyTurn || (!!state.frenzy && !state.frenzy.frozenFor));
    // Only rebuild when the hand actually changed, so taps aren't lost mid-render.
    const key = [hand.map((c) => c.id).join(','), state.playableIds.join(','), state.pendingDrawnId, state.isMyTurn, state.side, !!state.frenzy && state.frenzy.frozenFor > 0].join('|');
    if (key === handKey) return;
    handKey = key;
    const flipped = lastSide && lastSide !== state.side;
    lastSide = state.side;
    $('p-track').innerHTML = hand.map((card) => {
      const cls = [
        playable.has(card.id) ? 'is-playable' : '',
        card.id === state.pendingDrawnId ? 'is-drawn' : '',
        knownIds.has(card.id) ? '' : 'lc-new',
      ].join(' ');
      return renderCard(card, { tag: 'button', extraClass: cls, attrs: `type="button" aria-disabled="${!playable.has(card.id)}" aria-label="${escapeHtml(card.color)} ${escapeHtml(card.value)} card${playable.has(card.id) ? ', playable' : ', not playable'}"` });
    }).join('');
    const fresh = hand.find((c) => !knownIds.has(c.id));
    knownIds = new Set(hand.map((x) => x.id));
    layoutHand();
    if (flipped && !REDUCE) {
      // Eclipse: every card in your hand turns over
      $('p-track').classList.add('flip-in');
      buzz([20, 60, 20]);
      setTimeout(() => $('p-track').classList.remove('flip-in'), 700);
    }
    if (fresh) {
      const el = $('p-track').querySelector(`[data-id="${fresh.id}"]`);
      if (el) handEl.scrollTo({ left: el._x - handEl.clientWidth / 2, behavior: REDUCE ? 'auto' : 'smooth' });
    }
  }

  function layoutHand() {
    const handEl = $('p-hand');
    const track = $('p-track');
    const cards = [...track.querySelectorAll('.lc-card')];
    const n = cards.length;
    if (!n) { track.style.width = '100%'; return; }
    const W = handEl.clientWidth;
    const cw = cards[0].offsetWidth || 104;
    const pad = 28;
    let gap = n > 1 ? (W - pad * 2 - cw) / (n - 1) : 0;
    gap = Math.max(46, Math.min(gap, cw * 0.74));
    const spread = cw + (n - 1) * gap;
    const trackW = Math.max(W, spread + pad * 2);
    const offset = (trackW - spread) / 2;
    track.style.width = `${trackW}px`;
    cards.forEach((el, i) => {
      el.style.left = `${offset + i * gap}px`;
      el.style.zIndex = String(i + 1);
      el._x = offset + i * gap + cw / 2;
    });
    curveHand();
  }

  function curveHand() {
    const handEl = $('p-hand');
    const W = handEl.clientWidth;
    const sl = handEl.scrollLeft;
    for (const el of $('p-track').querySelectorAll('.lc-card')) {
      const d = Math.max(-1.4, Math.min(1.4, (el._x - sl - W / 2) / (W / 2)));
      el.style.setProperty('--rot', `${(d * 9).toFixed(2)}deg`);
      el.style.setProperty('--arc', `${(d * d * 20).toFixed(1)}px`);
    }
  }
  let curveQueued = false;
  // Recalculate positions when the phone rotates or its viewport changes.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (state && state.inRound) layoutHand(); }).observe($('p-hand'));
  } else {
    window.addEventListener('resize', () => { if (state && state.inRound) layoutHand(); });
  }
  $('p-hand').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cards = [...$('p-track').querySelectorAll('button.lc-card')];
    const index = cards.indexOf(document.activeElement);
    if (index < 0 || !cards.length) return;
    const next = cards[Math.max(0, Math.min(cards.length - 1, index + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (next !== document.activeElement) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  });
  $('p-hand').addEventListener('scroll', () => {
    if (curveQueued) return;
    curveQueued = true;
    requestAnimationFrame(() => { curveQueued = false; curveHand(); });
  }, { passive: true });
  addEventListener('resize', () => { if (state && !$('screen-play').hidden) layoutHand(); });

  function renderEnd() {
    const w = state.winner;
    const lead = state.me.isLeader;
    $('modal-end').hidden = false;
    $('modal-wild').hidden = true;
    $('edge').classList.remove('on');
    $('e-avatar').textContent = w ? w.avatar : '🏁';
    const wt = teamInfo(state.winnerTeam);
    if (wt) {
      const members = state.seats.filter((x) => x.team === state.winnerTeam);
      $('e-avatar').textContent = members.map((x) => x.avatar).join(' ');
      $('e-title').textContent = state.winnerTeam === state.myTeam ? 'Your team wins!' : `Team ${wt.name} wins`;
    } else {
      $('e-title').textContent = w ? (w.isMe ? 'You win!' : `${w.name} wins`) : 'Round over';
    }
    const wins = state.me.wins;
    $('e-sub').textContent = `${wins ? `You've won ${wins} round${wins === 1 ? '' : 's'}. ` : ''}${lead ? 'Deal again when everyone is ready.' : 'Waiting for the next round…'}`;
    $('btn-again').hidden = !lead;
    $('btn-again').disabled = !canDeal();
    $('btn-end-leave').hidden = !state.tvless;
    const mt = state.match;
    if (mt.type !== 'single') {
      const champ = mt.over ? state.lobby.find((x) => x.id === mt.championId) : null;
      let extra = '';
      if (champ) {
        $('e-avatar').textContent = champ.avatar;
        $('e-title').textContent = champ.id === state.me.id ? 'You win the match!' : `${champ.name} wins the match`;
        extra = 'Deal again for a new match.';
      } else if (mt.type === 'points') {
        const gain = mt.gains[state.me.id];
        const firstId = Object.keys(mt.gains)[0];
        const scorer = firstId && state.lobby.find((x) => x.id === firstId);
        const said = gain ? `You score ${gain}. ` : scorer ? `${scorer.name} scores ${mt.gains[firstId]}. ` : '';
        extra = `${said}You have ${state.me.points} of ${mt.target}.`;
      } else {
        const out = mt.knocked.map((id) => state.lobby.find((x) => x.id === id)).filter(Boolean);
        extra = out.some((x) => x.id === state.me.id) ? "You're knocked out, holding the most cards." : out.length ? `${out.map((x) => x.name).join(', ')} knocked out. ${mt.alive} left in.` : '';
      }
      $('e-sub').textContent = `${extra} ${$('e-sub').textContent}`.trim();
    }
    if (w && (w.isMe || (wt && state.winnerTeam === state.myTeam)) && $('modal-end').dataset.round !== String(state.round)) { buzz([100, 60, 100, 60, 200]); window.dispatchEvent(new Event('lastcard:win')); }
    $('modal-end').dataset.round = String(state.round);
  }

  // ---------- Frenzy: no turns, just GO (unless you're frozen) ----------
  function renderFrenzyStatus() {
    clearTimeout(fzTimer);
    if (!fz || !state || state.phase !== 'playing') return;
    const now = performance.now();
    const frozen = fz.frozenAt - now;
    const locked = fz.lockedAt - now;
    const turn = $('p-turn');
    turn.classList.remove('is-mine', 'is-yellow', 'is-go', 'is-frozen', 'is-locked');
    $('edge').classList.remove('on', 'go', 'ice');
    if (frozen > 0) {
      turn.classList.add('is-frozen');
      turn.textContent = `❄ Frozen! ${(frozen / 1000).toFixed(1)}s`;
      $('edge').classList.add('ice');
    } else if (locked > 0) {
      turn.classList.add('is-locked');
      turn.textContent = `Steady! ${(locked / 1000).toFixed(1)}s`;
    } else {
      turn.classList.add('is-go');
      turn.textContent = state.playableIds.length ? 'GO! Fastest card wins' : 'Nothing fits. Draw, or wait for a change';
      $('edge').classList.add('go');
    }
    // keep the countdowns and the Draw button honest between updates
    const draw = $('btn-draw');
    const drawLeft = fz.drawAt - now;
    if (drawLeft <= 0 && frozen <= 0) { draw.disabled = false; draw.classList.add('is-ready'); }
    if (frozen > 0 || locked > 0 || drawLeft > 0) {
      fzTimer = setTimeout(() => {
        if (frozen > 0 && fz.frozenAt - performance.now() <= 0) { handKey = ''; renderHand(); } // thawed: cards light up again
        renderFrenzyStatus();
      }, 100);
    }
  }

  // ---------- Hot Potato clock ----------
  function syncHot() {
    const f = state.fuse;
    if (!f || state.phase !== 'playing') {
      hot = null; cancelAnimationFrame(hotRaf); hotRaf = null;
      $('edge').classList.remove('hot');
      return;
    }
    const now = performance.now();
    const deadline = now + f.turnLeft;
    const fresh = !hot || deadline > hot.deadline + 300; // a new turn: tick again
    hot = { litAt: now - f.elapsed, deadline, turnMs: f.turnMs, lastTick: fresh ? 99 : hot.lastTick };
    if (!hotRaf) hotRaf = requestAnimationFrame(hotLoop);
  }
  function hotLoop(now) {
    if (!hot) { hotRaf = null; return; }
    const heat = Math.min(1, (now - hot.litAt) / 40000);
    document.documentElement.style.setProperty('--beat', `${(1.4 - heat * 0.95).toFixed(2)}s`);
    const left = Math.max(0, hot.deadline - now);
    const bar = $('p-clock');
    if (!bar.hidden) {
      bar.style.setProperty('--t', (left / hot.turnMs).toFixed(3));
      const sec = Math.ceil(left / 1000);
      if (sec <= 3 && sec > 0 && sec !== hot.lastTick) { hot.lastTick = sec; buzz(40); } // tick, tick, tick
    }
    hotRaf = requestAnimationFrame(hotLoop);
  }

  let wildSeen = null;
  function openWheel() {
    $('wheel').innerHTML = (state.palette || ['red', 'yellow', 'green', 'blue']).map((col) =>
      `<button data-color="${col}" class="${isLight(col) ? 'is-light' : ''}" style="background:${COLOR_HEX[col]}"><span aria-hidden="true">${COLOR_MARK[col]}</span>${COLOR_NAME[col]}</button>`).join('')
      + '<span class="hub" aria-hidden="true">Wild</span>';
    $('modal-wild').hidden = false;
    $('modal-wild').querySelector('[data-color]').focus();
  }

  // ---------- feedback ----------
  function toast(text, tone = 'info', ms = 2200, isHtml = false) {
    clearTimeout(toastTimer);
    $('toast-wrap').innerHTML = `<p class="ph-toast tone-${tone}">${isHtml ? text : escapeHtml(text)}</p>`;
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast-wrap').innerHTML = ''; }

  function shake(el) {
    if (!el) return;
    el.classList.remove('lc-shake');
    void el.offsetWidth;
    el.classList.add('lc-shake');
    buzz(30);
  }

  function send(event, payload, failEl, onOk) {
    if (busy) return;
    busy = true;
    socket.emit(event, payload || {}, (res) => {
      if (res && res.ok && onOk) onOk(res);
      if (!res || !res.ok) {
        busy = false;
        if (failEl) failEl.classList.remove('is-thrown');
        shake(failEl);
        if (res && res.error) toast(res.error, 'danger');
      }
      // On success the server broadcasts a fresh state, which re-renders and clears busy.
    });
    setTimeout(() => { busy = false; }, 3000); // safety net on a flaky connection
  }

  function throwCard(el, cardId, color, target, seenTopId) {
    el.classList.add('is-thrown');
    buzz(15);
    const after = (res) => {
      // Frenzy: lost the race, or the card didn't fit. Either way it comes back to your hand.
      if (res.result === 'late') { el.classList.remove('is-thrown'); toast(`${res.beatenBy} beat you by ${(res.ms / 1000).toFixed(2)}s`, 'info', 1600); buzz(40); }
      if (res.result === 'wrong') { el.classList.remove('is-thrown'); buzz([80, 40, 80]); }
    };
    // In Frenzy every millisecond counts, so throw straight away.
    const delay = state && state.frenzy ? 0 : REDUCE ? 0 : 200;
    setTimeout(() => send('player:play', { cardId, color, target, seenTopId }, el, after), delay);
  }

  /** Tap or swipe on a card: play it if allowed, otherwise explain why not. */
  function tryPlay(el) {
    if (!el || !state || busy) return;
    const id = el.dataset.id;
    if (state.frenzy) {
      const now = performance.now();
      if (fz && fz.frozenAt > now) { shake(el); toast("You're frozen!", 'info', 1000); return; }
      if (fz && fz.lockedAt > now) { shake(el); return; }
      // In Frenzy any card can be thrown. If it doesn't fit, that's a wrong card and costs 2.
      const fcard = state.hand.find((c) => c.id === id);
      if (fcard.color === 'wild') {
        wildCardId = id;
        wildSeen = state.topCard && state.topCard.id;
        openWheel();
        return;
      }
      throwCard(el, id, null, null, state.topCard && state.topCard.id);
      return;
    }
    if (!state.isMyTurn || !state.playableIds.includes(id)) {
      shake(el);
      toast(!state.isMyTurn ? "It's not your turn yet." : "That card doesn't match.", 'info', 1300);
      return;
    }
    const card = state.hand.find((c) => c.id === id);
    if (state.rules && state.rules.seven && card.value === '7' && state.hand.length > 1) {
      swapCardId = id;
      $('swap-list').innerHTML = state.seats.filter((x) => !x.isMe).map((x) => {
        const t = teamInfo(x.team);
        return `<button type="button" class="ph-target" data-target="${x.id}">
          <span class="av">${x.avatar}</span>
          <span class="flex-1 font-extrabold text-lg">${escapeHtml(x.name)}${t ? ` <span class="muted text-sm">Team ${t.name}</span>` : ''}</span>
          <span class="c">${x.cardCount}</span><span class="muted font-bold">card${x.cardCount === 1 ? '' : 's'}</span>
        </button>`;
      }).join('');
      $('modal-swap').hidden = false;
      return;
    }
    if (card.color === 'wild') {
      wildCardId = id;
      wildSeen = null;
      openWheel();
      $('modal-wild').querySelector('[data-color]').focus();
      return;
    }
    throwCard(el, id);
  }

  // ---------- input: swipe a card up to throw it, or tap it ----------
  let drag = null;
  $('p-track').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.lc-card');
    if (!el) return;
    drag = { el, x: e.clientX, y: e.clientY, pid: e.pointerId, active: false };
  });
  addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      if (dy < -10 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        drag.active = true;
        drag.el.classList.add('is-dragging');
        try { drag.el.setPointerCapture(drag.pid); } catch (_) {}
      } else if (Math.abs(dx) > 12) { drag = null; return; }
    }
    if (drag.active) drag.el.style.setProperty('--drag', `${Math.min(0, dy)}px`);
  });
  addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.el.classList.remove('is-dragging');
    if (d.active) {
      d.el.style.setProperty('--drag', '0px');
      if (dy < -70) tryPlay(d.el);
    } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      tryPlay(d.el);
    }
  });
  addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.el.classList.remove('is-dragging');
    drag.el.style.setProperty('--drag', '0px');
    drag = null;
  });
  // Keyboard users: Enter/Space on a focused card.
  $('p-track').addEventListener('click', (e) => { if (e.detail === 0) tryPlay(e.target.closest('.lc-card')); });

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
    if (code.length !== 4) { $('join-error').textContent = 'The room code is 4 letters. Look at the TV.'; shake($('in-code')); return; }
    if (!name) { $('join-error').textContent = 'Type your name first.'; shake($('in-name')); return; }
    saveSession({ name, avatar: chosenAvatar });
    join({ code, name, avatar: chosenAvatar });
  }
  $('btn-join').addEventListener('click', submitJoin);
  $('in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });

  // Phone-only Solo
  function renderSolo() {
    $('solo-count').textContent = solo.count;
    $('solo-minus').disabled = solo.count <= 1;
    $('solo-plus').disabled = solo.count >= 5;
    for (const b of $('solo-level').querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === solo.level));
  }
  $('btn-solo').addEventListener('click', () => {
    if (!$('in-name').value.trim()) { $('join-error').textContent = 'Type your name first, then tap Play solo.'; shake($('in-name')); $('in-name').focus(); return; }
    $('solo-error').textContent = '';
    renderSolo();
    $('modal-solo').hidden = false;
  });
  $('solo-minus').addEventListener('click', () => { solo.count = Math.max(1, solo.count - 1); renderSolo(); });
  $('solo-plus').addEventListener('click', () => { solo.count = Math.min(5, solo.count + 1); renderSolo(); });
  $('solo-level').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) { solo.level = b.dataset.level; renderSolo(); } });
  $('btn-solo-cancel').addEventListener('click', () => { $('modal-solo').hidden = true; });
  $('btn-solo-go').addEventListener('click', () => {
    const name = $('in-name').value.trim();
    const btn = $('btn-solo-go');
    btn.disabled = true;
    socket.emit('solo:create', { name, avatar: chosenAvatar, bots: solo.count, level: solo.level }, (res) => {
      btn.disabled = false;
      if (!res || !res.ok) { $('solo-error').textContent = (res && res.error) || 'Could not start. Try again.'; return; }
      $('modal-solo').hidden = true;
      saveSession({ code: res.code, playerId: res.playerId, resumeToken: res.resumeToken, name, avatar: chosenAvatar });
      if (location.pathname !== '/join') history.replaceState(null, '', '/join');
    });
  });

  // Waiting room controls
  $('w-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || !state || !state.me.isLeader) return;
    send('player:mode', { id: b.dataset.mode }, b);
  });
  $('w-bot-minus').addEventListener('click', (e) => send('player:bots', { count: state.botCount - 1 }, e.currentTarget));
  $('w-bot-plus').addEventListener('click', (e) => send('player:bots', { count: state.botCount + 1 }, e.currentTarget));
  $('w-bot-level').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) send('player:bots', { level: b.dataset.level }, b); });

  $('btn-start').addEventListener('click', (e) => send('player:start', {}, e.currentTarget));
  $('btn-again').addEventListener('click', (e) => send('player:start', {}, e.currentTarget));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-leave]')) return;
    if (!confirm(state && state.tvless ? 'End this Solo game?' : 'Leave this game? Your cards go back in the deck.')) return;
    socket.emit('player:leave', {}, () => { clearSession(); state = null; showJoin(); });
  });

  $('modal-wild').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || !wildCardId) return;
    $('modal-wild').hidden = true;
    const el = $('p-track').querySelector(`[data-id="${wildCardId}"]`);
    const id = wildCardId;
    wildCardId = null;
    if (el) throwCard(el, id, b.dataset.color, null, wildSeen);
    else send('player:play', { cardId: id, color: b.dataset.color, seenTopId: wildSeen });
  });
  $('modal-swap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (!b || !swapCardId) return;
    $('modal-swap').hidden = true;
    const id = swapCardId;
    swapCardId = null;
    const el = $('p-track').querySelector(`[data-id="${id}"]`);
    if (el) throwCard(el, id, null, b.dataset.target);
    else send('player:play', { cardId: id, target: b.dataset.target });
  });
  $('btn-swap-cancel').addEventListener('click', () => { swapCardId = null; $('modal-swap').hidden = true; });

  // Tag Team signals
  function sendSignal(kind, color) {
    $('p-have').hidden = true;
    socket.emit('player:signal', { kind, color }, (res) => {
      if (res && res.ok) { toast('Sent to your partner', 'success', 1200); buzz(20); }
      else if (res && res.error) toast(res.error, 'info', 1400);
    });
  }
  $('p-signals').addEventListener('click', (e) => {
    const have = e.target.closest('[data-have]');
    if (have) return sendSignal('have', have.dataset.have);
    const b = e.target.closest('[data-signal]');
    if (!b) return;
    if (b.dataset.signal === 'have') { $('p-have').hidden = !$('p-have').hidden; return; }
    sendSignal(b.dataset.signal);
  });
  socket.on('signal', (sig) => {
    const avatar = AvatarLib.find(sig.avatar);
    toast(`<span class="ph-toast-row"><span class="av" data-avatar-id="${escapeHtml(avatar.id)}">${escapeHtml(avatar.id)}</span><strong>${escapeHtml(sig.from)}:</strong><span>${escapeHtml(sig.text)}</span></span>`, 'info', 3200, true);
    const t = document.querySelector('#toast-wrap .ph-toast');
    if (t) { t.style.borderColor = 'var(--team)'; t.style.boxShadow = '0 0 0 2px var(--team), 0 10px 28px rgba(0,0,0,.55)'; }
    buzz([30, 40, 30]);
  });

  $('w-match').addEventListener('click', (e) => { const b = e.target.closest('[data-match]'); if (b && !b.disabled) send('player:match', { type: b.dataset.match }, b); });
  $('w-team-size').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (b) send('player:teamsize', { size: Number(b.dataset.size) }, b); });

  $('btn-wild-cancel').addEventListener('click', () => { wildCardId = null; $('modal-wild').hidden = true; });

  $('btn-draw').addEventListener('click', (e) => {
    if (!state) return;
    if (state.frenzy) { if (state.canDraw) send('player:draw', {}, e.currentTarget); else shake(e.currentTarget); return; }
    if (state.mustTake) send('player:draw', {}, e.currentTarget);
    else if (state.canPass) send('player:pass', {}, e.currentTarget);
    else if (state.canDraw) send('player:draw', {}, e.currentTarget);
    else shake(e.currentTarget);
  });

  $('btn-shout').addEventListener('click', (e) => {
    if (!state || state.called) return;
    if (!state.canShout) { shake(e.currentTarget); toast('Call it when you are down to your last card, or about to be.', 'info', 1800); return; }
    socket.emit('player:shout', {}, (res) => { if (!res || !res.ok) shake(e.currentTarget); else buzz([40, 30, 80]); });
  });

  // First paint before the socket connects
  if (!(session && session.playerId)) showJoin();
})();
