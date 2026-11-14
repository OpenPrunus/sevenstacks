// Sevenstacks — moteur du solitaire (Klondike). Aucun accès au DOM, entièrement déterministe (graine de la donne).
//
// Cartes : entiers 0..51 ; couleur (enseigne) = floor(c / 13) dans l'ordre ♠ ♥ ♦ ♣, valeur = c % 13 + 1 (1 = as, 13 = roi).
// Piles : 's' talon, 'w' défausse, 'f0'..'f3' fondations (une par enseigne), 't0'..'t6' colonnes du tableau.
// Une colonne garde ses cartes de bas en haut ; ses `down` premières sont face cachée.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const suitOf = (c) => Math.floor(c / 13);
export const rankOf = (c) => (c % 13) + 1;
export const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardName = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

export const SCORE = { wasteToTab: 5, toFound: 10, flip: 5, foundToTab: -15, recycle1: -100, recycle3: -20 };

/** Générateur pseudo-aléatoire (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(seed) {
  const d = [...Array(52).keys()];
  const r = rng(seed);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Nouvelle donne : 1 à 7 cartes par colonne, la dernière retournée ; le reste (24) au talon. */
export function deal(seed, draw = 1) {
  const deck = shuffled(seed);
  const tab = [];
  let k = 0;
  for (let i = 0; i < 7; i++) {
    tab.push({ cards: deck.slice(k, k + i + 1), down: i });
    k += i + 1;
  }
  return {
    seed, draw: draw === 3 ? 3 : 1,
    stock: deck.slice(k), // le dessus du talon est la fin du tableau
    waste: [],
    found: [[], [], [], []],
    tab,
    score: 0, moves: 0, passes: 0, won: false,
  };
}

export const clone = (g) => ({
  ...g,
  stock: g.stock.slice(),
  waste: g.waste.slice(),
  found: g.found.map((f) => f.slice()),
  tab: g.tab.map((c) => ({ cards: c.cards.slice(), down: c.down })),
});

export function pile(g, id) {
  if (id === 's') return g.stock;
  if (id === 'w') return g.waste;
  if (id[0] === 'f') return g.found[+id[1]];
  return g.tab[+id[1]].cards;
}

export const top = (arr) => arr[arr.length - 1];
export const faceUp = (col) => col.cards.length - col.down;

/** Peut-on poser la carte `c` (avec éventuellement une suite dessus) sur la pile `to` ? */
export function accepts(g, to, c, n = 1) {
  if (to[0] === 'f') {
    const f = g.found[+to[1]];
    return n === 1 && suitOf(c) === +to[1] && rankOf(c) === f.length + 1;
  }
  if (to[0] === 't') {
    const col = g.tab[+to[1]];
    if (!col.cards.length) return rankOf(c) === 13;
    const u = top(col.cards);
    return rankOf(u) === rankOf(c) + 1 && isRed(u) !== isRed(c);
  }
  return false;
}

/** Carte qui serait déplacée (la plus basse de la suite) si l'on prend `n` cartes de `from`, ou -1. */
export function moving(g, from, n) {
  if (from === 'w' || from[0] === 'f') {
    const p = pile(g, from);
    return n === 1 && p.length ? top(p) : -1;
  }
  if (from[0] === 't') {
    const col = g.tab[+from[1]];
    if (n < 1 || n > faceUp(col)) return -1;
    return col.cards[col.cards.length - n];
  }
  return -1;
}

export function canMove(g, from, n, to) {
  if (g.won || from === to || to === 's' || to === 'w') return false;
  const c = moving(g, from, n);
  return c >= 0 && accepts(g, to, c, n);
}

const addScore = (g, d) => { g.score = Math.max(0, g.score + d); };

/** Déplace `n` cartes de `from` vers `to` ; retourne la carte découverte en dessous et compte les points. */
export function move(g, from, n, to) {
  if (!canMove(g, from, n, to)) return false;
  const src = pile(g, from);
  const cards = src.splice(src.length - n, n);
  pile(g, to).push(...cards);
  if (to[0] === 'f') addScore(g, SCORE.toFound);
  else if (from === 'w') addScore(g, SCORE.wasteToTab);
  else if (from[0] === 'f') addScore(g, SCORE.foundToTab);
  if (from[0] === 't') {
    const col = g.tab[+from[1]];
    if (col.down > 0 && col.down >= col.cards.length) {
      col.down = col.cards.length - 1;
      addScore(g, SCORE.flip);
    }
  }
  g.moves++;
  g.won = g.found.every((f) => f.length === 13);
  return true;
}

/** Tire 1 ou 3 cartes du talon vers la défausse, ou remet la défausse au talon quand il est vide. */
export function draw(g) {
  if (g.won) return false;
  if (g.stock.length) {
    for (let i = 0; i < g.draw && g.stock.length; i++) g.waste.push(g.stock.pop());
  } else if (g.waste.length) {
    g.stock = g.waste.reverse();
    g.waste = [];
    g.passes++;
    addScore(g, g.draw === 1 ? SCORE.recycle1 : SCORE.recycle3);
  } else return false;
  g.moves++;
  return true;
}

/** Applique un coup { k: 'draw' } ou { k: 'move', from, n, to }. */
export function apply(g, m) {
  return m.k === 'draw' ? draw(g) : move(g, m.from, m.n, m.to);
}

export const isWon = (g) => g.found.every((f) => f.length === 13);

/** Toutes les cartes sont visibles et le talon vide : la fin peut se jouer toute seule. */
export const canAutoFinish = (g) => !g.won && !g.stock.length && !g.waste.length && g.tab.every((c) => c.down === 0);

/** Prochain coup vers une fondation (la plus petite valeur d'abord), ou null. */
export function foundationMove(g) {
  let best = null;
  const sources = ['w', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  for (const from of sources) {
    const c = moving(g, from, 1);
    if (c < 0) continue;
    const to = `f${suitOf(c)}`;
    if (accepts(g, to, c) && (!best || rankOf(c) < best.r)) best = { k: 'move', from, n: 1, to, r: rankOf(c) };
  }
  if (!best) return null;
  delete best.r;
  return best;
}

/** Une carte peut monter sans risque : plus aucune carte de couleur opposée ne pourra avoir besoin d'elle. */
export function safeToFound(g, c) {
  const r = rankOf(c);
  if (r <= 2) return true;
  const opp = isRed(c) ? [0, 3] : [1, 2];
  return opp.every((s) => g.found[s].length >= r - 1);
}

/** Coups utiles depuis cette position (sans les allers-retours sans intérêt). */
export function usefulMoves(g, { withFoundToTab = false } = {}) {
  const out = [];
  // vers les fondations
  for (const from of ['w', 't0', 't1', 't2', 't3', 't4', 't5', 't6']) {
    const c = moving(g, from, 1);
    if (c >= 0 && accepts(g, `f${suitOf(c)}`, c)) out.push({ k: 'move', from, n: 1, to: `f${suitOf(c)}` });
  }
  // entre colonnes
  for (let i = 0; i < 7; i++) {
    const col = g.tab[i];
    const up = faceUp(col);
    for (let n = up; n >= 1; n--) {
      const c = col.cards[col.cards.length - n];
      const whole = n === up;
      if (whole) {
        // tout déplacer n'a d'intérêt que pour retourner une carte ou vider une colonne (pas pour un roi déjà en bas)
        if (col.down === 0 && rankOf(c) === 13) continue;
      } else {
        // une partie de suite : seulement si cela libère une carte pour une fondation
        const under = col.cards[col.cards.length - n - 1];
        if (!accepts(g, `f${suitOf(under)}`, under)) continue;
      }
      let emptyDone = false;
      for (let j = 0; j < 7; j++) {
        if (j === i || !accepts(g, `t${j}`, c, n)) continue;
        if (!g.tab[j].cards.length) {
          if (emptyDone) continue; // les colonnes vides se valent
          emptyDone = true;
        }
        out.push({ k: 'move', from: `t${i}`, n, to: `t${j}` });
      }
    }
  }
  // défausse vers le tableau
  if (g.waste.length) {
    const c = top(g.waste);
    let emptyDone = false;
    for (let j = 0; j < 7; j++) {
      if (!accepts(g, `t${j}`, c)) continue;
      if (!g.tab[j].cards.length) { if (emptyDone) continue; emptyDone = true; }
      out.push({ k: 'move', from: 'w', n: 1, to: `t${j}` });
    }
  }
  if (withFoundToTab) {
    for (let s = 0; s < 4; s++) {
      if (!g.found[s].length) continue;
      const c = top(g.found[s]);
      for (let j = 0; j < 7; j++) if (g.tab[j].cards.length && accepts(g, `t${j}`, c)) out.push({ k: 'move', from: `f${s}`, n: 1, to: `t${j}` });
    }
  }
  if (g.stock.length || g.waste.length) out.push({ k: 'draw' });
  return out;
}

function key(g) {
  const cols = g.tab.map((c) => `${c.down}:${c.cards.join(',')}`).sort().join('|');
  return `${cols}#${g.found.map((f) => f.length).join(',')}#${g.stock.join(',')}#${g.waste.join(',')}`;
}

/**
 * Cherche une solution complète depuis `g0` (recherche en profondeur avec mémoire des positions vues).
 * Retourne la liste des coups, ou null si aucune n'est trouvée dans le budget (nombre de positions explorées).
 */
export function solve(g0, budget = 20000) {
  const seen = new Set();
  let nodes = 0;
  const path = [];

  function rec(g) {
    // coups de fondation sans risque : joués d'office, sans embranchement
    const forced = [];
    for (;;) {
      const m = foundationMove(g);
      if (!m || !safeToFound(g, moving(g, m.from, 1))) break;
      move(g, m.from, 1, m.to);
      forced.push(m);
    }
    path.push(...forced);
    if (isWon(g)) return true;
    const k = key(g);
    if (!seen.has(k) && ++nodes <= budget) {
      seen.add(k);
      for (const m of usefulMoves(g)) {
        const h = clone(g);
        apply(h, m);
        path.push(m);
        if (rec(h)) return true;
        path.pop();
        if (nodes > budget) break;
      }
    }
    path.length -= forced.length;
    return false;
  }
  const g = clone(g0);
  g.won = false;
  return rec(g) ? path.slice() : null;
}

/** Donne gagnable : essaie les graines à partir de `seed` jusqu'à en trouver une que le solveur sait finir. */
export function winnableDeal(seed, draw = 1, { tries = 60, budget = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const s = ((seed + i * 7919) % 999999) + 1;
    const g = deal(s, draw);
    if (solve(g, budget)) return g;
  }
  return deal(seed, draw);
}

/**
 * Indice : le premier coup d'une solution si le solveur en trouve une, sinon le meilleur coup utile
 * (fondation, carte à retourner, défausse vers le tableau, talon). Null s'il ne reste rien à faire.
 */
export function hint(g, budget = 4000) {
  if (g.won) return null;
  const sol = solve(g, budget);
  if (sol && sol.length) return { ...sol[0], sure: true };
  const moves = usefulMoves(g, { withFoundToTab: false });
  const rank = (m) => {
    if (m.k === 'draw') return 5;
    if (m.to[0] === 'f') return 0;
    if (m.from[0] === 't') {
      const col = g.tab[+m.from[1]];
      if (m.n === faceUp(col) && col.down > 0) return 1;
      return 3;
    }
    return 2;
  };
  moves.sort((a, b) => rank(a) - rank(b));
  const m = moves[0];
  if (!m) return null;
  return { ...m, sure: false };
}

/** Bonus de temps à la victoire (règle classique) : 700 000 / secondes, au-delà de 30 s. */
export const timeBonus = (secs) => (secs >= 30 ? Math.round(700000 / secs) : 0);
