// Sevenstacks — écrans, tapis de jeu, glisser-déposer (souris et doigt), toucher = placement automatique, annulation, indices.
import * as E from './engine.js';
import { t, apply as applyI18n, setLang, getLang, detectLang } from './i18n.js';
import { sfx, unlock, isMuted, setMuted } from './audio.js';

const $ = (s) => document.querySelector(s);
const board = $('#board');
const KEYS = { save: 'sevenstacks.save', stats: 'sevenstacks.stats', settings: 'sevenstacks.settings' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : d; } catch { return d; } };
const store = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoré */ } };
const HISTORY_MAX = 400;
const DRAG_START = 7; // px avant qu'un appui devienne un glisser

const app = {
  game: null, history: [], elapsed: 0, counted: false, finishing: false, screen: 'title',
  settings: { draw: 1, mode: 'winnable', ...load(KEYS.settings, {}) },
  stats: { played: 0, won: 0, streak: 0, bestStreak: 0, best: {}, ...load(KEYS.stats, {}) },
  geo: null, where: [], press: null, pendingConfirm: null, lastTick: 0, timers: new Set(),
};

/* ---------- cartes et emplacements (créés une fois) ---------- */
const VS = '︎';
const els = [];
const slots = {};
for (const id of ['s', 'w', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6']) {
  const el = document.createElement('div');
  el.className = `slot${id === 's' ? ' stock' : ''}`;
  el.dataset.pile = id;
  if (id[0] === 'f') el.textContent = E.SUITS[+id[1]] + VS;
  if (id === 's') el.textContent = '↻';
  board.append(el);
  slots[id] = el;
}
for (let c = 0; c < 52; c++) {
  const el = document.createElement('div');
  el.className = `card${E.isRed(c) ? ' red' : ''}`;
  el.dataset.c = c;
  const r = E.rankOf(c);
  const rk = E.RANKS[r];
  const s = E.SUITS[E.suitOf(c)] + VS;
  const mid = r > 10 ? `<span class="mid court"><b>${rk}</b><span>${s}</span></span>` : `<span class="mid${r === 1 ? ' ace' : ''}">${s}</span>`;
  el.innerHTML = `<div class="back"></div><div class="face"><span class="rk">${rk}</span><span class="st">${s}</span>${mid}</div>`;
  board.append(el);
  els.push(el);
}

/* ---------- mise en page ---------- */
function layout() {
  const W = board.clientWidth;
  const H = board.clientHeight;
  const side = W / Math.max(1, H) > 1.5; // écran large et bas : talon à gauche, fondations à droite
  const gap = Math.max(4, Math.min(14, Math.min(W, H * 1.4) * 0.013));
  let cw;
  let ch;
  const pos = {};
  if (!side) {
    cw = (W - gap * 8) / 7;
    ch = cw * 1.4;
    const maxCh = (H - gap * 3) / 3.3;
    if (ch > maxCh) { ch = maxCh; cw = ch / 1.4; }
    const x0 = (W - (cw * 7 + gap * 6)) / 2;
    const col = (i) => x0 + i * (cw + gap);
    pos.s = { x: col(0), y: gap };
    pos.w = { x: col(1), y: gap };
    for (let i = 0; i < 4; i++) pos[`f${i}`] = { x: col(3 + i), y: gap };
    for (let i = 0; i < 7; i++) pos[`t${i}`] = { x: col(i), y: gap * 2.5 + ch };
  } else {
    cw = (W - gap * 10) / 9.4;
    ch = cw * 1.4;
    const maxCh = (H - gap * 5) / 4;
    if (ch > maxCh) { ch = maxCh; cw = ch / 1.4; }
    const total = cw * 9 + gap * 8 + gap * 2;
    const x0 = (W - total) / 2;
    pos.s = { x: x0, y: gap };
    pos.w = { x: x0, y: gap * 2 + ch };
    for (let i = 0; i < 7; i++) pos[`t${i}`] = { x: x0 + (cw + gap) * (i + 1) + gap, y: gap };
    const fx = x0 + (cw + gap) * 8 + gap * 2;
    for (let i = 0; i < 4; i++) pos[`f${i}`] = { x: fx, y: gap + i * (ch + gap) };
  }
  return { W, H, side, gap, cw, ch, pos };
}

/** Écarts verticaux d'une colonne (resserrés si elle est trop longue pour l'écran). */
function fan(geo, col, extra = 0) {
  let fd = geo.ch * 0.11;
  let fu = geo.ch * 0.27;
  const up = col.cards.length - col.down + extra;
  const need = col.down * fd + Math.max(0, up - 1) * fu;
  const avail = geo.H - geo.gap - geo.pos.t0.y - geo.ch;
  if (need > avail && need > 0) { const k = avail / need; fd *= k; fu *= k; }
  return { fd, fu };
}

/** Position de chaque carte : { x, y, z, up } ; mémorise aussi sa pile et son rang. */
function computePositions(g, geo) {
  const out = [];
  const where = [];
  const put = (c, x, y, z, up, pileId, i) => { out[c] = { x, y, z, up }; where[c] = { pile: pileId, i }; };
  g.stock.forEach((c, i) => put(c, geo.pos.s.x, geo.pos.s.y, 1 + i, false, 's', i));
  const fanN = g.draw === 3 ? 3 : 1;
  const wStart = Math.max(0, g.waste.length - fanN);
  g.waste.forEach((c, i) => {
    const k = Math.max(0, i - wStart);
    const dx = geo.side ? 0 : k * geo.cw * 0.3;
    const dy = geo.side ? k * geo.ch * 0.2 : 0;
    put(c, geo.pos.w.x + dx, geo.pos.w.y + dy, 100 + i, true, 'w', i);
  });
  g.found.forEach((f, s) => f.forEach((c, i) => put(c, geo.pos[`f${s}`].x, geo.pos[`f${s}`].y, 200 + i, true, `f${s}`, i)));
  g.tab.forEach((col, ti) => {
    const { fd, fu } = fan(geo, col);
    let y = geo.pos[`t${ti}`].y;
    col.cards.forEach((c, i) => {
      put(c, geo.pos[`t${ti}`].x, y, 300 + i, i >= col.down, `t${ti}`, i);
      y += i < col.down ? fd : fu;
    });
  });
  return { out, where };
}

function render() {
  const g = app.game;
  if (!g) return;
  const geo = layout();
  app.geo = geo;
  board.style.setProperty('--cw', `${geo.cw}px`);
  board.style.setProperty('--ch', `${geo.ch}px`);
  for (const [id, el] of Object.entries(slots)) el.style.transform = `translate(${geo.pos[id].x}px, ${geo.pos[id].y}px)`;
  const { out, where } = computePositions(g, geo);
  app.where = where;
  app.positions = out;
  for (let c = 0; c < 52; c++) {
    const p = out[c];
    const el = els[c];
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.zIndex = p.z;
    el.classList.toggle('up', p.up);
  }
  $('#st-score').textContent = g.score;
  $('#st-moves').textContent = g.moves;
  $('#st-deal').textContent = t('dealNo', { n: g.seed });
  $('#btn-undo').disabled = !app.history.length || g.won || app.finishing;
  $('#btn-hint').disabled = g.won || app.finishing;
  $('#btn-finish').hidden = !E.canAutoFinish(g) || app.finishing;
  showTime();
}

const fmtTime = (secs) => { const s = Math.floor(secs); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const showTime = () => { $('#st-time').textContent = fmtTime(app.elapsed); };

/* ---------- partie ---------- */
const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

function startGame(seed = null) {
  const draw = app.settings.draw === 3 ? 3 : 1;
  let g;
  if (seed !== null) g = E.deal(seed, draw);
  else if (app.settings.mode === 'winnable') g = E.winnableDeal(randomSeed(), draw);
  else g = E.deal(randomSeed(), draw);
  app.game = g;
  app.history = [];
  app.elapsed = 0;
  app.counted = false;
  app.finishing = false;
  clearTimers();
  board.classList.remove('party');
  $('#result').hidden = true;
  $('#confirm').hidden = true;
  show('game');
  dealAnimation();
  save();
}

/** Les cartes partent du talon puis gagnent leur place l'une après l'autre. */
function dealAnimation() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  render();
  if (reduce) return;
  const geo = app.geo;
  board.classList.add('dealing');
  const order = [];
  app.game.tab.forEach((col) => col.cards.forEach((c, i) => order.push([c, i])));
  for (const [c] of order) {
    const el = els[c];
    el.style.transition = 'none';
    el.style.transform = `translate(${geo.pos.s.x}px, ${geo.pos.s.y}px)`;
    el.classList.remove('up');
  }
  void board.offsetWidth;
  order.sort((a, b) => a[1] - b[1]);
  order.forEach(([c], k) => {
    const el = els[c];
    el.style.transition = '';
    el.style.transitionDelay = `${k * 18}ms`;
  });
  render();
  later(() => { board.classList.remove('dealing'); for (const [c] of order) els[c].style.transitionDelay = ''; }, 28 * 18 + 400);
}

function later(fn, ms) {
  const id = setTimeout(() => { app.timers.delete(id); fn(); }, ms);
  app.timers.add(id);
  return id;
}
function clearTimers() { for (const id of app.timers) clearTimeout(id); app.timers.clear(); }

function save() {
  const g = app.game;
  if (!g || g.won) { store(KEYS.save, null); return; }
  store(KEYS.save, { v: 1, game: g, history: app.history.slice(-100), elapsed: app.elapsed, counted: app.counted });
}

function loadSave() {
  const s = load(KEYS.save, null);
  if (!s || s.v !== 1 || !s.game || !Array.isArray(s.game.tab) || s.game.won) return null;
  return s;
}

const saveStats = () => store(KEYS.stats, app.stats);
const saveSettings = () => store(KEYS.settings, app.settings);

/** Joue un coup du joueur (avec historique et sons). Retourne true s'il a été joué. */
function play(m, { quiet = false } = {}) {
  const g = app.game;
  if (!g || g.won) return false;
  const before = E.clone(g);
  const downs = g.tab.map((c) => c.down);
  if (!E.apply(g, m)) return false;
  app.history.push(before);
  if (app.history.length > HISTORY_MAX) app.history.shift();
  if (!quiet) {
    if (m.k === 'draw') sfx.draw();
    else if (m.to[0] === 'f') sfx.found();
    else sfx.place();
    if (g.tab.some((c, i) => c.down < downs[i])) later(() => sfx.flip(), 90);
  }
  if (!app.counted) {
    app.counted = true;
    app.stats.played++;
    saveStats();
  }
  afterMove();
  return true;
}

function afterMove() {
  const g = app.game;
  render();
  if (g.won) { win(); return; }
  save();
  if (!app.finishing && E.canAutoFinish(g)) later(() => autoFinish(), 250);
}

function undo() {
  if (!app.history.length || app.game.won || app.finishing) return;
  app.game = app.history.pop();
  sfx.place();
  render();
  save();
}

function autoFinish() {
  const g = app.game;
  if (!g || g.won || app.finishing || !E.canAutoFinish(g)) return;
  app.finishing = true;
  render();
  const step = () => {
    const m = E.foundationMove(app.game);
    if (!m) { app.finishing = false; render(); return; }
    play(m);
    if (!app.game.won) later(step, 85);
  };
  later(step, 60);
}

function win() {
  const g = app.game;
  app.finishing = false;
  const secs = Math.max(1, Math.floor(app.elapsed));
  const bonus = E.timeBonus(secs);
  const total = g.score + bonus;
  const st = app.stats;
  st.won++;
  st.streak++;
  st.bestStreak = Math.max(st.bestStreak, st.streak);
  const key = String(g.draw);
  const prev = st.best[key] || {};
  const records = [];
  if (!prev.time || secs < prev.time) records.push('time');
  if (!prev.score || total > prev.score) records.push('score');
  st.best[key] = { time: Math.min(prev.time || Infinity, secs), score: Math.max(prev.score || 0, total), moves: Math.min(prev.moves || Infinity, g.moves) };
  saveStats();
  store(KEYS.save, null);
  sfx.win();
  // petite fête : les cartes des fondations sautillent en décalé
  g.found.forEach((f) => f.forEach((c, i) => els[c].style.setProperty('--d', `${(i * 0.07 + Math.random() * 0.2).toFixed(2)}s`)));
  board.classList.add('party');
  $('#res-detail').textContent = t('resultDetail', { time: fmtTime(secs), moves: g.moves, score: total, bonus });
  $('#res-record').textContent = (prev.time || prev.score) && records.length ? t('newBest') : '';
  $('#res-stats').textContent = statsText();
  app.lastWin = { secs, bonus, total, records };
  later(() => { $('#result').hidden = false; }, 700);
  render();
}

function statsText() {
  const st = app.stats;
  return t('statsLine', { won: st.won, played: st.played, streak: st.streak, bestStreak: st.bestStreak });
}

/** Nouvelle donne : demande confirmation si la partie en cours a commencé (elle compte alors comme perdue). */
function askNew(seed = null) {
  const g = app.game;
  if (g && app.counted && !g.won) {
    app.pendingConfirm = seed;
    $('#confirm').hidden = false;
    return;
  }
  startGame(seed);
}
function confirmNew(yes) {
  $('#confirm').hidden = true;
  if (!yes) return;
  app.stats.streak = 0;
  saveStats();
  startGame(app.pendingConfirm);
}

/* ---------- indices et messages ---------- */
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function clearHints() { for (const el of board.querySelectorAll('.hint')) el.classList.remove('hint'); }

function showHint() {
  const g = app.game;
  if (!g || g.won || app.finishing) return null;
  clearHints();
  const h = E.hint(g);
  app.lastHint = h;
  if (!h) { toast(t('noMoves')); sfx.nope(); return h; }
  if (h.k === 'draw') {
    // tirer sans fin ne sert à rien si aucune carte du talon ne peut jamais servir
    const anyUse = [...g.stock, ...g.waste].some((c) => E.usefulMoves({ ...E.clone(g), waste: [c], stock: [] }).some((m) => m.from === 'w'));
    if (!anyUse && !h.sure) { toast(t('noMoves')); sfx.nope(); app.lastHint = null; return null; }
    (g.stock.length ? els[E.top(g.stock)] : slots.s).classList.add('hint');
    toast(t('hintDraw'));
  } else {
    const src = E.pile(g, h.from);
    for (const c of src.slice(src.length - h.n)) els[c].classList.add('hint');
    const dst = E.pile(g, h.to);
    (dst.length ? els[E.top(dst)] : slots[h.to]).classList.add('hint');
    if (!h.sure) toast(t('hintMaybe'));
  }
  setTimeout(clearHints, 1600);
  return h;
}

/* ---------- toucher / souris ---------- */
/** Meilleure destination pour un simple toucher : fondation, puis colonne non vide, puis colonne vide. */
function smartTarget(g, from, n) {
  const c = E.moving(g, from, n);
  if (c < 0) return null;
  const f = `f${E.suitOf(c)}`;
  if (n === 1 && from[0] !== 'f' && E.canMove(g, from, 1, f)) return f;
  const start = from[0] === 't' ? +from[1] + 1 : 0;
  let empty = null;
  for (let k = 0; k < 7; k++) {
    const j = (start + k) % 7;
    const to = `t${j}`;
    if (!E.canMove(g, from, n, to)) continue;
    if (g.tab[j].cards.length) return to;
    // un roi déjà en bas de sa colonne ne gagne rien à changer de colonne vide
    if (!(from[0] === 't' && g.tab[+from[1]].down === 0 && n === g.tab[+from[1]].cards.length)) empty ??= to;
  }
  return empty;
}

function pressInfo(target) {
  const g = app.game;
  const cardEl = target.closest?.('.card');
  const slotEl = target.closest?.('.slot');
  if (cardEl) {
    const c = +cardEl.dataset.c;
    const w = app.where[c];
    if (!w) return null;
    if (w.pile === 's') return { stock: true };
    const p = E.pile(g, w.pile);
    if (w.pile[0] === 't') {
      const col = g.tab[+w.pile[1]];
      if (w.i < col.down) return null;
      return { from: w.pile, n: p.length - w.i };
    }
    if (w.pile === 'w' || w.pile[0] === 'f') return w.i === p.length - 1 ? { from: w.pile, n: 1 } : null;
  }
  if (slotEl?.dataset.pile === 's') return { stock: true };
  return null;
}

function dragCards(press) {
  const p = E.pile(app.game, press.from);
  return p.slice(p.length - press.n);
}

board.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !app.game || app.game.won || app.finishing || app.press) return;
  if (!$('#confirm').hidden || !$('#result').hidden) return;
  unlock();
  const info = pressInfo(e.target);
  if (!info) return;
  e.preventDefault();
  clearHints();
  app.press = { ...info, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
  try { board.setPointerCapture(e.pointerId); } catch { /* ignoré */ }
});

board.addEventListener('pointermove', (e) => {
  const pr = app.press;
  if (!pr || pr.id !== e.pointerId || pr.stock) return;
  const dx = e.clientX - pr.x0;
  const dy = e.clientY - pr.y0;
  if (!pr.moved && Math.hypot(dx, dy) < DRAG_START) return;
  if (!pr.moved) {
    pr.moved = true;
    pr.cards = dragCards(pr);
    pr.cards.forEach((c, k) => { els[c].classList.add('dragging'); els[c].style.zIndex = 1000 + k; });
  }
  pr.dx = dx;
  pr.dy = dy;
  for (const c of pr.cards) {
    const p = app.positions[c];
    els[c].style.transform = `translate(${p.x + dx}px, ${p.y + dy}px)`;
  }
});

function endPress(e, cancelled = false) {
  const pr = app.press;
  if (!pr || pr.id !== e.pointerId) return;
  app.press = null;
  const g = app.game;
  if (pr.moved) for (const c of pr.cards) els[c].classList.remove('dragging');
  if (cancelled) { render(); return; }
  if (pr.stock) {
    if (Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) < 20) play({ k: 'draw' });
    return;
  }
  if (!pr.moved) {
    const to = smartTarget(g, pr.from, pr.n);
    if (to) play({ k: 'move', from: pr.from, n: pr.n, to });
    else nope(dragCards(pr));
    return;
  }
  const to = dropTarget(pr);
  if (to && play({ k: 'move', from: pr.from, n: pr.n, to })) return;
  render();
}
board.addEventListener('pointerup', (e) => endPress(e));
board.addEventListener('pointercancel', (e) => endPress(e, true));

function nope(cards) {
  sfx.nope();
  for (const c of cards) {
    els[c].classList.remove('shake');
    void els[c].offsetWidth;
    els[c].classList.add('shake');
    setTimeout(() => els[c].classList.remove('shake'), 320);
  }
}

/** Pile où lâcher : celle, autorisée, que la carte tenue recouvre le plus. */
function dropTarget(pr) {
  const g = app.game;
  const geo = app.geo;
  const p = app.positions[pr.cards[0]];
  const r = { x: p.x + pr.dx, y: p.y + pr.dy, w: geo.cw, h: geo.ch };
  let best = null;
  let bestA = 0;
  const ids = ['f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  for (const id of ids) {
    if (!E.canMove(g, pr.from, pr.n, id)) continue;
    const base = geo.pos[id];
    let h = geo.ch;
    if (id[0] === 't') {
      const cards = g.tab[+id[1]].cards;
      if (cards.length) h = app.positions[E.top(cards)].y - base.y + geo.ch;
    }
    const pad = geo.gap / 2;
    const ox = Math.min(r.x + r.w, base.x + geo.cw + pad) - Math.max(r.x, base.x - pad);
    const oy = Math.min(r.y + r.h, base.y + h + pad) - Math.max(r.y, base.y - pad);
    const a = ox > 0 && oy > 0 ? ox * oy : 0;
    if (a > bestA) { bestA = a; best = id; }
  }
  return best;
}

/* ---------- écrans ---------- */
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  app.screen = id;
  if (id === 'title') refreshTitle();
  if (id === 'game') requestAnimationFrame(render);
}

function refreshTitle() {
  $('#btn-resume').hidden = !(app.game && !app.game.won) && !loadSave();
  $('#btn-play').classList.toggle('primary', $('#btn-resume').hidden);
  for (const b of document.querySelectorAll('#seg-draw button')) b.setAttribute('aria-pressed', String(+b.dataset.draw === app.settings.draw));
  for (const b of document.querySelectorAll('#seg-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === app.settings.mode));
  const st = app.stats;
  $('#stats-line').textContent = st.played ? statsText() : '';
  const b = st.best[String(app.settings.draw)];
  $('#best-line').textContent = b ? t('bestLine', { time: fmtTime(b.time), score: b.score }) : '';
  $('#opt-sound').textContent = t(isMuted() ? 'soundOff' : 'soundOn');
  $('#offline').hidden = navigator.onLine !== false;
}

function refreshSound() {
  $('#lbl-sound').textContent = t('sound');
  $('#btn-sound').setAttribute('aria-label', t(isMuted() ? 'soundOff' : 'soundOn'));
  $('#btn-sound').classList.toggle('muted', isMuted());
  $('#opt-sound').textContent = t(isMuted() ? 'soundOff' : 'soundOn');
}

function resume() {
  if (!app.game || app.game.won) {
    const s = loadSave();
    if (!s) { startGame(); return; }
    app.game = s.game;
    app.history = Array.isArray(s.history) ? s.history : [];
    app.elapsed = +s.elapsed || 0;
    app.counted = !!s.counted;
  }
  app.finishing = false;
  show('game');
  if (E.canAutoFinish(app.game)) later(() => autoFinish(), 300);
}

const actions = {
  play: () => askNew(),
  resume,
  help: () => show('help'),
  title: () => { clearTimers(); app.finishing = false; save(); show('title'); },
  undo,
  hint: showHint,
  finish: autoFinish,
  new: () => askNew(),
  again: () => startGame(),
  replay: () => { if (app.game?.won) startGame(app.game.seed); else askNew(app.game?.seed ?? null); },
  confirmYes: () => confirmNew(true),
  confirmNo: () => confirmNew(false),
  toggleSound: () => { setMuted(!isMuted()); refreshSound(); },
  toggleLang: () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); applyI18n(); refreshSound(); refreshTitle(); if (app.game) render(); },
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action], [data-draw], [data-mode]');
  if (!b) return;
  unlock();
  if (b.dataset.draw) {
    app.settings.draw = +b.dataset.draw;
    saveSettings();
    refreshTitle();
    return;
  }
  if (b.dataset.mode) {
    app.settings.mode = b.dataset.mode;
    saveSettings();
    refreshTitle();
    return;
  }
  actions[b.dataset.action]?.();
});

document.addEventListener('keydown', (e) => {
  if (app.screen !== 'game') {
    if (e.key === 'Escape' && app.screen === 'help') show('title');
    return;
  }
  if (!$('#confirm').hidden) {
    if (e.key === 'Escape') confirmNew(false);
    return;
  }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === ' ' || k === 'd') { e.preventDefault(); if (!app.finishing) play({ k: 'draw' }); } else if (k === 'u' || k === 'backspace') undo();
  else if (k === 'h') showHint();
  else if (k === 'n') askNew();
  else if (k === 'f' || k === 'a') autoFinish();
  else if (k === 'escape') actions.title();
});

/* ---------- temps ---------- */
function tick(now) {
  const dt = Math.min(1, (now - (app.lastTick || now)) / 1000);
  app.lastTick = now;
  const g = app.game;
  if (g && !g.won && app.counted && app.screen === 'game' && !document.hidden && $('#confirm').hidden) {
    const before = Math.floor(app.elapsed);
    app.elapsed += dt;
    if (Math.floor(app.elapsed) !== before) {
      showTime();
      if (Math.floor(app.elapsed) % 10 === 0) save();
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- démarrage ---------- */
let resizeRaf = 0;
const onResize = () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(() => { if (app.screen === 'game') render(); }); };
window.addEventListener('resize', onResize);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(board);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);
window.addEventListener('online', refreshTitle);
window.addEventListener('offline', refreshTitle);

if (![1, 3].includes(app.settings.draw)) app.settings.draw = 1;
if (!['winnable', 'random'].includes(app.settings.mode)) app.settings.mode = 'winnable';
setLang(detectLang());
applyI18n();
refreshSound();
show('title');

// accès pour les tests navigateur
window.__ss = { app, E, render, play, undo, showHint, startGame, autoFinish, layout, smartTarget };
