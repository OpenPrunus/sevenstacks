# Sevenstacks

[![CI](https://github.com/OpenPrunus/sevenstacks/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenPrunus/sevenstacks/actions/workflows/ci.yml)

Classic **Klondike solitaire** in the browser, with no account, installable and playable offline. Seven columns, four foundations,
a stock to draw from: move every card to the foundations, by suit, from ace to king.

## Features

- **Draw 1 or draw 3**, unlimited passes through the stock, classic scoring (+5 / +10, −15 back from a foundation, −100 or −20 per pass,
  time bonus at the end).
- **Winnable deals** (default): a built-in solver checks the deal before you get it, so a solution always exists. Random deals too.
  Every deal has a number and can be replayed.
- **Drag and drop** with the mouse or a finger, or just **tap a card**: it goes by itself to the best place (foundation first, then a
  column). Unlimited **undo**, **hints** (the first move of a solution found from the current position when there is one), and the end
  plays itself once every card is face up.
- Statistics (games won, streak, best time and score per mode), the game in progress is saved and can be resumed after closing the page.
- Layout that follows the screen: portrait phone, landscape phone (stock on the left, foundations on the right, buttons on the side),
  desktop. Cards are drawn in CSS, no image.
- French and English, small synthesized sounds, **installable and playable offline** (PWA: manifest, icons, network-first service worker).

Keyboard: Space draw, U or Ctrl+Z undo, H hint, N new deal, F finish, Esc menu.

## Run it

```bash
docker compose up -d --build     # http://localhost:8106
# or, without Docker, any static server on web/:
npm run serve                    # python3 -m http.server 8106 --directory web
```

It is a static site: `web/` is the whole game (HTML, CSS and JavaScript modules, no build step, no dependency).

## Tests

```bash
npm test              # unit tests, then the browser tests
npm run test:unit     # engine, translations, PWA (Node 22, no dependency)
npm run test:browser  # a real headless Chrome drives the page (CHROME_BIN to choose it)
```

The engine is deterministic (seeded deals) and never touches the DOM: the rules, the stock in draw 1 and draw 3, scoring, the solver
(its solutions are replayed move by move and must win), winnable deals, and a whole game won by following the hints. The browser tests
cover the menus and saved settings in both languages, mouse drag and drop, tap to move, rejected drops, undo, keyboard, hints, the
automatic finish and the win screen with statistics, resuming after a reload, portrait and landscape phone layouts (no scrolling, every
card on the table, buttons of at least 40 px, real touch drags and taps) and offline use.

## Layout

```
web/js/engine.js   cards, rules, scoring, solver, hints
web/js/main.js     screens, layout, drag and drop / tap, undo, statistics, save
web/css/style.css  table and cards
```

MIT licence.
