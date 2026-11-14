// Sevenstacks — textes FR / EN.
export const DICT = {
  fr: {
    title: 'Sevenstacks',
    tagline: 'Le solitaire classique : sept colonnes, quatre fondations, une seule règle, tout ranger de l\'as au roi.',
    play: 'Nouvelle partie',
    resume: 'Continuer la partie',
    draw1: 'Tirer 1 carte',
    draw3: 'Tirer 3 cartes',
    winnable: 'Donnes gagnables',
    random: 'Donnes au hasard',
    howTo: 'Comment jouer',
    help1: 'But : monter les 52 cartes sur les quatre fondations (en haut à droite), par enseigne, de l\'as au roi.',
    help2: 'Dans les colonnes, on descend en alternant rouge et noir (un 9 noir sur un 10 rouge). On peut déplacer une suite entière. Seul un roi (ou une suite qui commence par un roi) va sur une colonne vide. Une carte cachée se retourne dès qu\'elle est dégagée.',
    help3: 'Touchez le talon pour tirer 1 ou 3 cartes ; vide, il reprend la défausse. Glissez une carte pour la poser, ou touchez-la : elle va d\'elle-même au meilleur endroit. « Donnes gagnables » ne propose que des donnes dont une solution est connue. Clavier : Espace tirer, U ou Ctrl+Z annuler, H indice, N nouvelle donne, Échap menu.',
    statsLine: 'Gagnées : {won} sur {played} · série {streak} (record {bestStreak})',
    bestLine: 'Meilleur temps : {time} · meilleur score : {score}',
    allGames: 'Tous les jeux',
    github: 'GitHub',
    sound: 'Son',
    soundOn: 'Son : oui',
    soundOff: 'Son : non',
    langToggle: 'English',
    ok: 'OK',
    score: 'Score',
    movesLabel: 'Coups',
    timeLabel: 'Temps',
    dealNo: 'Donne n° {n}',
    undo: 'Annuler',
    hint: 'Indice',
    newDeal: 'Nouvelle',
    menu: 'Menu',
    finish: 'Terminer',
    stock: 'Talon',
    waste: 'Défausse',
    foundation: 'Fondation {s}',
    column: 'Colonne {n}',
    noMoves: 'Plus aucun coup utile : annulez ou changez de donne.',
    hintDraw: 'Indice : tirez une carte du talon.',
    hintMaybe: 'Ce coup est possible, mais rien ne garantit qu\'il mène à la victoire.',
    won: 'Gagné !',
    resultDetail: '{time} · {moves} coups · score {score} (dont bonus de temps {bonus})',
    newBest: 'Nouveau record !',
    again: 'Nouvelle donne',
    replay: 'Rejouer cette donne',
    confirmNew: 'Abandonner cette partie ? Elle comptera comme perdue.',
    yes: 'Oui, nouvelle donne',
    no: 'Non, continuer',
    offline: 'Hors ligne : le jeu fonctionne sans internet une fois chargé.',
  },
  en: {
    title: 'Sevenstacks',
    tagline: 'Classic solitaire: seven columns, four foundations, one goal, sort everything from ace to king.',
    play: 'New game',
    resume: 'Resume game',
    draw1: 'Draw 1 card',
    draw3: 'Draw 3 cards',
    winnable: 'Winnable deals',
    random: 'Random deals',
    howTo: 'How to play',
    help1: 'Goal: move all 52 cards onto the four foundations (top right), by suit, from ace to king.',
    help2: 'In the columns, build down in alternating colours (a black 9 on a red 10). Whole runs can be moved. Only a king (or a run starting with a king) goes on an empty column. A hidden card turns over as soon as it is uncovered.',
    help3: 'Tap the stock to draw 1 or 3 cards; when empty, it takes the waste back. Drag a card to place it, or tap it: it goes to the best place by itself. "Winnable deals" only offers deals with a known solution. Keyboard: Space draw, U or Ctrl+Z undo, H hint, N new deal, Esc menu.',
    statsLine: 'Won: {won} of {played} · streak {streak} (best {bestStreak})',
    bestLine: 'Best time: {time} · best score: {score}',
    allGames: 'All games',
    github: 'GitHub',
    sound: 'Sound',
    soundOn: 'Sound: on',
    soundOff: 'Sound: off',
    langToggle: 'Français',
    ok: 'OK',
    score: 'Score',
    movesLabel: 'Moves',
    timeLabel: 'Time',
    dealNo: 'Deal #{n}',
    undo: 'Undo',
    hint: 'Hint',
    newDeal: 'New',
    menu: 'Menu',
    finish: 'Finish',
    stock: 'Stock',
    waste: 'Waste',
    foundation: 'Foundation {s}',
    column: 'Column {n}',
    noMoves: 'No useful move left: undo or start a new deal.',
    hintDraw: 'Hint: draw a card from the stock.',
    hintMaybe: 'This move is possible, but it may not lead to a win.',
    won: 'You won!',
    resultDetail: '{time} · {moves} moves · score {score} (time bonus {bonus})',
    newBest: 'New record!',
    again: 'New deal',
    replay: 'Replay this deal',
    confirmNew: 'Give up this game? It will count as lost.',
    yes: 'Yes, new deal',
    no: 'No, keep playing',
    offline: 'Offline: the game works without internet once loaded.',
  },
};

export const LANGS = Object.keys(DICT);
let lang = 'fr';

export function detectLang() {
  try {
    const saved = localStorage.getItem('sevenstacks.lang');
    if (saved && DICT[saved]) return saved;
  } catch { /* stockage indisponible */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'fr';
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLang(l) {
  if (!DICT[l]) return;
  lang = l;
  try { localStorage.setItem('sevenstacks.lang', l); } catch { /* ignoré */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export const getLang = () => lang;

export function t(key, vars = {}) {
  const s = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function apply(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  document.title = t('title');
}
