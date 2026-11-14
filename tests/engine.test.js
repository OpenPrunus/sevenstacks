// Moteur : la donne, les règles de déplacement, le talon, les points, le solveur et les indices.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../web/js/engine.js';

const card = (rank, suit) => suit * 13 + rank - 1; // suit : 0 ♠, 1 ♥, 2 ♦, 3 ♣
const empty = (draw = 1) => ({ seed: 1, draw, stock: [], waste: [], found: [[], [], [], []], tab: Array.from({ length: 7 }, () => ({ cards: [], down: 0 })), score: 0, moves: 0, passes: 0, won: false });

test('la donne : 52 cartes distinctes, 1 à 7 cartes par colonne avec seule la dernière visible, 24 au talon', () => {
  const g = E.deal(123);
  const all = [...g.stock, ...g.tab.flatMap((c) => c.cards)];
  assert.equal(new Set(all).size, 52);
  assert.equal(g.stock.length, 24);
  g.tab.forEach((c, i) => { assert.equal(c.cards.length, i + 1); assert.equal(c.down, i); });
  assert.deepEqual(E.deal(123), g, 'même graine, même donne');
  assert.notDeepEqual(E.deal(124).tab, g.tab);
});

test('cartes : enseignes, valeurs, couleurs et noms', () => {
  assert.equal(E.cardName(card(1, 0)), 'A♠');
  assert.equal(E.cardName(card(10, 1)), '10♥');
  assert.equal(E.cardName(card(13, 3)), 'K♣');
  assert.ok(E.isRed(card(5, 1)) && E.isRed(card(5, 2)) && !E.isRed(card(5, 0)) && !E.isRed(card(5, 3)));
});

test('colonnes : on descend en alternant les couleurs ; seul un roi va sur une colonne vide', () => {
  const g = empty();
  g.tab[0] = { cards: [card(10, 1)], down: 0 }; // 10♥
  g.tab[1] = { cards: [card(9, 0)], down: 0 }; // 9♠
  g.tab[2] = { cards: [card(9, 2)], down: 0 }; // 9♦
  g.tab[3] = { cards: [card(8, 3)], down: 0 }; // 8♣
  g.tab[4] = { cards: [card(13, 0)], down: 0 }; // K♠
  assert.ok(E.canMove(g, 't1', 1, 't0'), '9♠ sur 10♥');
  assert.ok(!E.canMove(g, 't2', 1, 't0'), '9♦ pas sur 10♥ (même couleur)');
  assert.ok(!E.canMove(g, 't3', 1, 't0'), '8♣ pas sur 10♥ (pas la valeur suivante)');
  assert.ok(!E.canMove(g, 't1', 1, 't5'), 'un 9 ne va pas sur une colonne vide');
  assert.ok(E.canMove(g, 't4', 1, 't5'), 'un roi va sur une colonne vide');
  assert.ok(E.move(g, 't1', 1, 't0'));
  assert.ok(E.canMove(g, 't0', 2, 't6') === false, 'une suite sans roi ne va pas sur une colonne vide');
  // suite entière : 10♥ 9♠ sur un valet noir
  g.tab[6] = { cards: [card(11, 3)], down: 0 };
  assert.ok(E.move(g, 't0', 2, 't6'));
  assert.deepEqual(g.tab[6].cards, [card(11, 3), card(10, 1), card(9, 0)]);
  assert.ok(!E.canMove(g, 't6', 4, 't0'), 'pas plus de cartes que la colonne n\'en montre');
});

test('fondations : par enseigne, de l\'as au roi ; on peut en redescendre une carte (−15 points)', () => {
  const g = empty();
  g.waste = [card(2, 1), card(1, 1)];
  assert.ok(!E.canMove(g, 'w', 1, 'f0'), 'l\'as de cœur ne va pas sur la fondation de pique');
  assert.ok(E.move(g, 'w', 1, 'f1'));
  assert.ok(E.move(g, 'w', 1, 'f1'));
  assert.equal(g.score, 20);
  assert.ok(!E.canMove(g, 'w', 1, 'f1'));
  g.tab[0] = { cards: [card(3, 0)], down: 0 };
  assert.ok(E.move(g, 'f1', 1, 't0'), '2♥ redescend sur 3♠');
  assert.equal(g.score, 5);
  assert.equal(g.found[1].length, 1);
});

test('une carte cachée se retourne quand elle est dégagée (+5 points)', () => {
  const g = empty();
  g.tab[0] = { cards: [card(4, 0), card(1, 2)], down: 1 };
  assert.ok(E.move(g, 't0', 1, 'f2'));
  assert.equal(g.tab[0].down, 0, '4♠ est retourné');
  assert.equal(g.score, 15);
  assert.ok(!E.canMove(g, 't0', 2, 't1'), 'impossible de prendre une carte cachée');
});

test('talon : tire 1 ou 3 cartes, puis reprend la défausse dans le même ordre (pénalité −100 / −20)', () => {
  const g1 = E.deal(7, 1);
  const order = g1.stock.slice().reverse();
  for (let i = 0; i < 24; i++) assert.ok(E.draw(g1));
  assert.deepEqual(g1.waste, order);
  g1.score = 250;
  assert.ok(E.draw(g1), 'talon vide : on reprend la défausse');
  assert.equal(g1.stock.length, 24);
  assert.equal(g1.waste.length, 0);
  assert.equal(g1.score, 150);
  assert.equal(g1.passes, 1);
  assert.ok(E.draw(g1));
  assert.equal(g1.waste[0], order[0], 'le même ordre au deuxième tour');

  const g3 = E.deal(7, 3);
  E.draw(g3);
  assert.equal(g3.waste.length, 3);
  for (let i = 0; i < 7; i++) E.draw(g3);
  assert.equal(g3.stock.length, 0);
  g3.score = 30;
  E.draw(g3);
  assert.equal(g3.score, 10);
  const g0 = empty();
  assert.equal(E.draw(g0), false, 'rien à tirer');
  assert.equal(E.apply(g0, { k: 'draw' }), false);
});

test('fin automatique, victoire et coups refusés après la victoire', () => {
  const g = empty();
  for (let s = 0; s < 4; s++) g.found[s] = Array.from({ length: 12 }, (_, i) => card(i + 1, s));
  for (let s = 0; s < 4; s++) g.tab[s] = { cards: [card(13, s)], down: 0 };
  assert.ok(E.canAutoFinish(g));
  let m;
  while ((m = E.foundationMove(g))) E.apply(g, m);
  assert.ok(g.won && E.isWon(g));
  assert.equal(E.draw(g), false);
  assert.equal(E.hint(g), null);
  assert.ok(!E.canAutoFinish(g));
  const h = E.deal(3);
  assert.ok(!E.canAutoFinish(h), 'pas au début (cartes cachées)');
});

test('montée sans risque : un 5 rouge peut monter seulement si les 4 noirs sont déjà en place', () => {
  const g = empty();
  assert.ok(E.safeToFound(g, card(2, 1)));
  assert.ok(!E.safeToFound(g, card(5, 1)));
  g.found[0] = [0, 1, 2, 3].map((r) => card(r + 1, 0));
  g.found[3] = [0, 1, 2, 3].map((r) => card(r + 1, 3));
  assert.ok(E.safeToFound(g, card(5, 1)));
});

test('le solveur trouve des solutions qui, rejouées coup par coup, gagnent la partie (tirer 1 et tirer 3)', () => {
  for (const draw of [1, 3]) {
    let solved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = E.deal(seed, draw);
      const sol = E.solve(g, 4000);
      if (!sol) continue;
      solved++;
      const h = E.clone(g);
      for (const m of sol) assert.ok(E.apply(h, m), `graine ${seed} : coup refusé ${JSON.stringify(m)}`);
      assert.ok(E.isWon(h), `graine ${seed} gagnée`);
    }
    assert.ok(solved >= 7, `tirer ${draw} : ${solved}/20 donnes résolues`);
  }
});

test('donnes gagnables : la donne proposée a une solution, et sa graine la redonne à l\'identique', () => {
  for (const draw of [1, 3]) {
    for (const seed of [11, 500, 98765]) {
      const g = E.winnableDeal(seed, draw);
      assert.equal(g.draw, draw);
      assert.ok(E.solve(g, 3000), `tirer ${draw}, départ ${seed}`);
      assert.deepEqual(E.deal(g.seed, draw), g);
    }
  }
});

test('indice : un coup légal ; joué à chaque fois, il mène au bout d\'une donne gagnable', () => {
  const g = E.winnableDeal(42, 1);
  for (let i = 0; i < 400 && !g.won; i++) {
    const h = E.hint(g);
    assert.ok(h, 'un indice tant que la partie n\'est pas finie');
    assert.ok(E.apply(g, h), `indice légal ${JSON.stringify(h)}`);
  }
  assert.ok(g.won, 'les indices gagnent la partie');
});

test('coups utiles : jamais de roi déjà en bas déplacé vers une autre colonne vide', () => {
  const g = empty();
  g.tab[0] = { cards: [card(13, 1), card(12, 0)], down: 0 };
  g.stock = [card(5, 1)];
  const ms = E.usefulMoves(g);
  assert.ok(!ms.some((m) => m.from === 't0' && m.to[0] === 't'));
  assert.ok(ms.some((m) => m.k === 'draw'));
});

test('bonus de temps : 700 000 / secondes au-delà de 30 s', () => {
  assert.equal(E.timeBonus(10), 0);
  assert.equal(E.timeBonus(100), 7000);
  assert.equal(E.timeBonus(350), 2000);
});
