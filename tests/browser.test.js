// Navigateur : un vrai Chrome (headless) piloté par DevTools, sans dépendance. Le site est statique : un petit serveur Node le sert.
//   npm run test:browser          (CHROME_BIN réglable ; SHOTS=/dossier enregistre des captures d'écran)
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});
async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = `erreur : ${e.message}`; }
    if (Date.now() - t0 > ms) throw new Error(`délai dépassé : ${what} (dernière valeur : ${JSON.stringify(last)})`);
    await sleep(50);
  }
}

let BASE, server, chrome, tmpDir, cdp, nextId = 0;
const pending = new Map();
const errors = [];

before(async () => {
  server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  BASE = `http://localhost:${port}`;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chrome-'));
  const dbg = await freePort();
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  const tab = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page'), 15000, 'Chrome');
  cdp = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { cdp.onopen = resolve; cdp.onerror = () => reject(new Error('DevTools')); });
  cdp.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable');
});
after(() => {
  try { cdp.close(); } catch { /* déjà fermé */ }
  try { chrome?.kill(); } catch { /* déjà arrêté */ }
  server?.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignoré */ }
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    cdp.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page : ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function shot(name) {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(process.env.SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
const DESKTOP = { w: 1100, h: 760, touch: false };
const PHONE_PORTRAIT = { w: 390, h: 844, touch: true };
const PHONE_LANDSCAPE = { w: 844, h: 390, touch: true };

async function open(device, lang = 'fr', storage = {}) {
  await call('Emulation.setDeviceMetricsOverride', { width: device.w, height: device.h, deviceScaleFactor: 1, mobile: !!device.touch });
  await call('Emulation.setTouchEmulationEnabled', device.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await call('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'local_storage' });
  await call('Page.navigate', { url: `${BASE}/` });
  await waitFor(() => ev('document.readyState === "complete" && !!window.__ss'), 10000, 'page chargée');
  const sets = Object.entries({ lang, ...storage }).map(([k, v]) => `localStorage.setItem('sevenstacks.${k}', ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`).join(' ');
  await ev(`localStorage.clear(); ${sets} location.reload()`);
  await sleep(100);
  await waitFor(() => ev('document.readyState === "complete" && !!window.__ss'), 10000, 'page rechargée');
}
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const visible = (sel) => ev(`!document.querySelector(${JSON.stringify(sel)}).hidden`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const game = () => ev('JSON.parse(JSON.stringify(window.__ss.app.game))');
const rect = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
const cardAt = (c) => rect(`.card[data-c="${c}"]`);
const key = (k, extra = {}) => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ...${JSON.stringify(extra)} }))`);
const C = (rank, suit) => suit * 13 + rank - 1; // 0 ♠ 1 ♥ 2 ♦ 3 ♣
/** Installe une position choisie (les cartes absentes vont au talon, faces cachées). */
async function setPosition(pos) {
  await ev(`(() => {
    const p = ${JSON.stringify(pos)};
    const used = new Set([...(p.waste || []), ...(p.found || [[], [], [], []]).flat(), ...p.tab.flatMap((c) => c.cards)]);
    const stock = p.stock ?? [...Array(52).keys()].filter((c) => !used.has(c));
    const a = window.__ss.app;
    a.game = { seed: 777, draw: p.draw || 1, stock, waste: p.waste || [], found: p.found || [[], [], [], []], tab: p.tab, score: 0, moves: 0, passes: 0, won: false };
    a.history = []; a.counted = false; a.elapsed = 0;
    window.__ss.render();
  })()`);
  await sleep(250);
}
const tab7 = (cols) => Array.from({ length: 7 }, (_, i) => cols[i] || { cards: [], down: 0 });

async function mouseDrag(from, to) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 6; k++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * k) / 6, y: from.y + ((to.y - from.y) * k) / 6, button: 'left' });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await sleep(250);
}
async function mouseTap(p) {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(250);
}
async function touchDrag(from, to) {
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let k = 1; k <= 6; k++) await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * k) / 6, y: from.y + ((to.y - from.y) * k) / 6, id: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}
async function touchTap(p) {
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 2 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}
/** Le haut d'une carte (là où elle dépasse dans une colonne). */
const grip = (r) => ({ x: r.cx, y: r.y + Math.min(10, r.h * 0.1) });

describe('menus', () => {
  test('le titre, les réglages (tirer 1/3, donnes gagnables) gardés d\'une visite à l\'autre, l\'aide, l\'anglais, sans erreur', async () => {
    errors.length = 0;
    await open(DESKTOP);
    assert.equal(await ev('document.title'), 'Sevenstacks');
    assert.match(await text('#btn-play'), /Nouvelle partie/);
    assert.equal(await visible('#btn-resume'), false, 'rien à reprendre au premier lancement');
    assert.equal(await ev('document.querySelector("#title a.all").href'), 'https://games.prunus.dev/');
    assert.equal(await ev('document.querySelector("#seg-draw [aria-pressed=true]").dataset.draw'), '1');
    assert.equal(await ev('document.querySelector("#seg-mode [aria-pressed=true]").dataset.mode'), 'winnable');
    await click('#seg-draw [data-draw="3"]');
    await click('#seg-mode [data-mode="random"]');
    assert.deepEqual(await ev('JSON.parse(localStorage.getItem("sevenstacks.settings"))'), { draw: 3, mode: 'random' });
    await shot('title');
    await call('Page.reload');
    await waitFor(() => ev('document.readyState === "complete" && !!window.__ss'), 10000, 'rechargée');
    assert.equal(await ev('document.querySelector("#seg-draw [aria-pressed=true]").dataset.draw'), '3');
    await click('#btn-play');
    assert.equal((await game()).draw, 3, 'la partie suit le réglage');
    await click('#btn-menu');
    await click('[data-action=help]');
    assert.ok(await visible('#help'));
    await open(DESKTOP, 'en');
    assert.match(await text('#btn-play'), /New game/);
    await click('#opt-lang');
    assert.match(await text('#btn-play'), /Nouvelle partie/);
    assert.deepEqual(errors, []);
  });
});

describe('partie à la souris', () => {
  test('donne, talon, glisser une carte, toucher pour placer, refus, annuler, clavier, indice', async () => {
    errors.length = 0;
    await open(DESKTOP);
    await click('#btn-play');
    assert.ok(await visible('#game'));
    let g = await game();
    assert.equal(g.stock.length, 24);
    assert.ok(await ev('window.__ss.E.solve(window.__ss.app.game, 3000) !== null'), 'donne gagnable par défaut');
    assert.equal(await text('#st-deal'), `Donne n° ${g.seed}`);
    await shot('desktop-start');

    // talon : un clic tire une carte
    await mouseTap(grip(await rect('.slot[data-pile=s]')));
    g = await game();
    assert.equal(g.waste.length, 1);
    assert.equal(g.moves, 1);

    // position choisie : 9♠ sur 10♥ par glisser-déposer
    await setPosition({ tab: tab7([{ cards: [C(5, 3), C(10, 1)], down: 1 }, { cards: [C(9, 0)], down: 0 }, { cards: [C(1, 2)], down: 0 }, { cards: [C(13, 2)], down: 0 }, { cards: [C(11, 3)], down: 0 }]) });
    await mouseDrag(grip(await cardAt(C(9, 0))), grip(await cardAt(C(10, 1))));
    g = await game();
    assert.deepEqual(g.tab[0].cards, [C(5, 3), C(10, 1), C(9, 0)], 'glissé sur la colonne 1');
    assert.equal(await ev('window.__ss.app.counted'), true);
    // le tirage puis le glisser (setPosition recommence une partie) : deux parties comptées, chacune dès son premier coup
    assert.equal(await ev('JSON.parse(localStorage.getItem("sevenstacks.stats")).played'), 2, 'la partie compte dès le premier coup');

    // lâcher au mauvais endroit : la carte revient
    await mouseDrag(grip(await cardAt(C(13, 2))), grip(await cardAt(C(9, 0))));
    g = await game();
    assert.deepEqual(g.tab[3].cards, [C(13, 2)]);
    const back = await cardAt(C(13, 2));
    const slot = await rect('.slot[data-pile=t3]');
    assert.ok(Math.abs(back.x - slot.x) < 2 && Math.abs(back.y - slot.y) < 2, 'le roi est revenu à sa place');

    // toucher l'as : il monte tout seul
    await mouseTap(grip(await cardAt(C(1, 2))));
    g = await game();
    assert.deepEqual(g.found[2], [C(1, 2)]);
    // toucher la suite 10♥ 9♠ : elle va sur le valet de trèfle ; la carte cachée se retourne
    await mouseTap(grip(await cardAt(C(10, 1))));
    g = await game();
    assert.equal(g.tab[0].down, 0, '5♣ retourné');
    assert.deepEqual(g.tab[4].cards, [C(11, 3), C(10, 1), C(9, 0)], 'la suite a bougé');
    // toucher une carte qui ne peut aller nulle part : rien ne change
    const before = JSON.stringify(await game());
    await mouseTap(grip(await cardAt(C(5, 3))));
    assert.equal(JSON.stringify(await game()), before);

    // annuler (bouton puis Ctrl+Z) et retourner la carte de nouveau
    await click('#btn-undo');
    g = await game();
    assert.equal(g.tab[0].down, 1, 'annuler recache la carte');
    await key('z', { ctrlKey: true });
    assert.deepEqual((await game()).found[2], [], 'Ctrl+Z annule aussi');
    await key(' ');
    assert.equal((await game()).waste.length, 1, 'Espace tire');

    // indice sur une donne : un coup surligné
    await click('#btn-new');
    assert.ok(await visible('#confirm'), 'abandonner une partie commencée demande confirmation');
    await click('[data-action=confirmNo]');
    assert.ok(!(await visible('#confirm')));
    await click('#btn-new');
    await click('[data-action=confirmYes]');
    assert.equal(await ev('JSON.parse(localStorage.getItem("sevenstacks.stats")).streak'), 0);
    assert.equal((await game()).moves, 0);
    await click('#btn-hint');
    const h = await ev('window.__ss.app.lastHint');
    assert.ok(h && (h.k === 'draw' || h.from), JSON.stringify(h));
    assert.ok(await ev('document.querySelectorAll(".hint").length') >= 1, 'quelque chose est surligné');
    assert.deepEqual(errors, []);
  });

  test('victoire : le dernier coup lance la fin automatique, écran de victoire, statistiques et record', async () => {
    errors.length = 0;
    await open(DESKTOP);
    await click('#btn-play');
    const found = [0, 1, 2, 3].map((s) => Array.from({ length: s === 0 ? 10 : 11 }, (_, i) => C(i + 1, s)));
    await setPosition({
      stock: [],
      waste: [C(11, 0)],
      found,
      tab: tab7([
        { cards: [C(13, 0), C(12, 1)], down: 0 }, { cards: [C(13, 1), C(12, 0)], down: 0 },
        { cards: [C(13, 2), C(12, 3)], down: 0 }, { cards: [C(13, 3), C(12, 2)], down: 0 },
      ]),
    });
    await ev('window.__ss.app.elapsed = 95');
    await mouseTap(grip(await cardAt(C(11, 0))));
    await waitFor(() => ev('window.__ss.app.game.won'), 6000, 'fin automatique jusqu\'à la victoire');
    await waitFor(() => visible('#result'), 3000, 'écran de victoire');
    assert.match(await text('#res-detail'), /1:3[5-6]/);
    const st = await ev('JSON.parse(localStorage.getItem("sevenstacks.stats"))');
    assert.equal(st.won, 1);
    assert.equal(st.streak, 1);
    assert.ok(st.best['1'].time >= 95 && st.best['1'].time <= 96, st.best['1'].time);
    assert.equal(await ev('localStorage.getItem("sevenstacks.save")'), null, 'plus de partie à reprendre');
    await shot('won');
    await click('[data-action=replay]');
    assert.equal((await game()).seed, 777, 'rejouer la même donne');
    assert.equal(await visible('#result'), false);
    await click('#btn-menu');
    assert.match(await text('#stats-line'), /Gagnées : 1 sur 1/);
    assert.match(await text('#best-line'), /1:3[5-6]/);
    assert.deepEqual(errors, []);
  });

  test('une partie entière jouée par les indices se gagne, et la partie en cours se reprend après rechargement', async () => {
    errors.length = 0;
    await open(DESKTOP);
    await click('#btn-play');
    await ev('window.__ss.app.elapsed = 0');
    for (let i = 0; i < 400; i++) {
      const done = await ev(`(() => { const s = window.__ss; if (s.app.game.won) return true; if (s.app.finishing) return false; const h = s.E.hint(s.app.game); if (h) s.play(h, { quiet: true }); return false; })()`);
      if (done) break;
      if (i === 5) {
        // au milieu : on recharge et on reprend
        const mid = JSON.stringify(await game());
        await call('Page.reload');
        await waitFor(() => ev('document.readyState === "complete" && !!window.__ss'), 10000, 'rechargée');
        assert.ok(await visible('#btn-resume'), 'bouton Continuer');
        await click('#btn-resume');
        assert.equal(JSON.stringify(await game()), mid, 'même position');
        assert.equal(await ev('window.__ss.app.history.length'), 6, 'annulations gardées');
      }
    }
    await waitFor(() => ev('window.__ss.app.game.won'), 8000, 'gagnée');
    await waitFor(() => visible('#result'), 3000, 'écran de victoire');
    assert.deepEqual(errors, []);
  });
});

for (const [name, device] of [['portrait', PHONE_PORTRAIT], ['paysage', PHONE_LANDSCAPE]]) {
  describe(`téléphone en ${name}`, () => {
    test('tout tient à l\'écran, boutons d\'au moins 40 px, glisser et toucher au doigt', async () => {
      errors.length = 0;
      await open(device);
      const titleBtns = await ev('[...document.querySelectorAll("#title button:not([hidden])")].map((b) => b.getBoundingClientRect().height)');
      assert.ok(titleBtns.every((h) => h >= 40), `boutons du titre : ${titleBtns}`);
      await click('#btn-play');
      await sleep(300);
      const scroll = await ev('({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight })');
      assert.ok(scroll.w <= scroll.iw && scroll.h <= scroll.ih, `pas de défilement : ${JSON.stringify(scroll)}`);
      const ctl = await ev('[...document.querySelectorAll("#controls .ctl:not([hidden])")].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height, r.bottom <= innerHeight, r.right <= innerWidth]; })');
      for (const [w, h, inY, inX] of ctl) assert.ok(w >= 40 && h >= 40 && inY && inX, `bouton ${w}×${h} visible ${inY} ${inX}`);
      // une colonne très longue (6 cachées + 12 visibles) tient dans le tapis
      const run = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((r, i) => C(r, i % 2 ? 1 : 0));
      await setPosition({ tab: tab7([null, null, null, null, null, null, { cards: [C(1, 2), C(2, 2), C(3, 2), C(4, 2), C(5, 2), C(6, 2), ...run], down: 6 }].map((c) => c || { cards: [], down: 0 })).map((c, i) => (i === 0 ? { cards: [C(1, 3)], down: 0 } : c)) });
      const board = await rect('#board');
      const out = await ev(`[...document.querySelectorAll('.card')].map((e) => e.getBoundingClientRect()).filter((r) => r.bottom > ${board.y + board.h + 1} || r.right > ${board.x + board.w + 1} || r.left < ${board.x - 1}).length`);
      assert.equal(out, 0, 'aucune carte hors du tapis');
      const cw = await ev('window.__ss.app.geo.cw');
      assert.ok(cw >= 40, `cartes assez larges pour le doigt : ${cw}`);
      await shot(`phone-${name}`);
      // toucher l'as de trèfle : il monte
      await touchTap(grip(await cardAt(C(1, 3))));
      assert.deepEqual((await game()).found[3], [C(1, 3)], 'toucher = placement automatique');
      // glisser le 2♥ ... pas possible ; on glisse le roi de la colonne longue vers la colonne vide (suite entière)
      const k = await cardAt(C(13, 0));
      const dst = await rect('.slot[data-pile=t0]');
      await touchDrag(grip(k), grip(dst));
      const g = await game();
      assert.equal(g.tab[0].cards.length, 12, 'la suite du roi au 2 a été glissée au doigt');
      assert.equal(g.tab[6].down, 5, 'la carte dessous s\'est retournée');
      // le talon au doigt
      await touchTap(grip(await rect('.slot[data-pile=s]')));
      assert.equal((await game()).waste.length, 1);
      assert.deepEqual(errors, []);
    });
  });
}

describe('hors ligne (PWA)', () => {
  test('après une première visite, la page se charge sans réseau et une partie démarre', async () => {
    await open(DESKTOP);
    assert.equal(await ev('navigator.serviceWorker.ready.then(() => true)'), true);
    await call('Page.navigate', { url: `${BASE}/` });
    await waitFor(() => ev('!!window.__ss && !!navigator.serviceWorker.controller'), 10000, 'page contrôlée par le service worker');
    await call('Network.enable');
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await call('Page.navigate', { url: `${BASE}/` });
      await waitFor(() => ev('!!window.__ss'), 8000, 'page chargée hors ligne');
      await click('#btn-play');
      assert.equal((await game()).stock.length, 24);
    } finally {
      await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
  });
});
