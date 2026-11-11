# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

No dependencies, no build step, no linter. Requires Node (uses `node:test`).

- `npm start` — dev server at http://localhost:8000 (`scripts/serve.js`, sends `Cache-Control: no-store` so edits show on a normal reload; `PORT=9000 npm start` to change port). The app uses ES modules, so `index.html` cannot be opened from the filesystem.
- `npm test` — all engine tests (`test/engine.test.js`).
- Single test: `node --test --test-name-pattern="dead tiles" test/engine.test.js` (`npm test -- --test-name-pattern=...` does **not** filter).

## Architecture

A single-player browser version of the Acquire board game: one human vs. 2–5 computer players. UI text, log messages and engine error messages are Korean.

**`src/engine.js` — all rules and state, no DOM.** `AcquireGame` is a phase state machine (`game.phase`):
`setup → tile → (found | mergeWinner | mergerShares)* → buy → tile …` until `results`. Each public method (`chooseTile`, `chooseFounder`, `chooseMergeWinner`, `resolveMergerShares`, `passTile`, `buyShares`) checks the phase and **throws `Error` with a user-facing message** for illegal moves; the UI shows that message as-is.

- Board: flat array of `ROWS*COLS` (9×12) cells, index `row * COLS + col`, `tileName` → `A1`…`I12`. A cell is `null`, `"loose"` (unchained tile), or a chain id 0–6. Chain ids index `COMPANIES` (`[name, color, price-tier offset]`), `game.companies` (`{active, size, shares}` = shares left in the bank), and each player's `shares[]`.
- `evaluate(tile, player)` is the single source of truth for what a tile does (`isolated | found | grow | merge | invalid`). `invalid` with `permanent: true` means it would merge two safe (≥11) chains; such tiles are discarded and replaced in `refillHand()` at `endTurn()`. Tiles that would found an 8th chain stay in hand.
- Mergers keep in-progress state in `game.pending`; `processNextDefunct()` handles defunct chains one at a time (pay bonuses → dispose of shares → `finishDefunct()`).
- **The human is always `players[0]`**, and the engine branches on it: only the human gets the `mergeWinner` choice and the `mergerShares` phase; bots' share disposal (`resolveDefunctForBots`) and moves (`botAction`/`botBuy`) are decided inside the engine.
- **Bots play synchronously.** `runBots()` (called from `start`, `endTurn`, and after every human action) loops while the current player is a bot and the phase is `tile`/`buy`, with a guard of 50 iterations. Any new rule must leave bots able to finish their turn without UI input, or the game stalls on a bot's turn.
- Invariants worth checking when changing rules: each chain's 25 shares are conserved (bank + players), and every tile is in exactly one place (deck, a hand, the board, or discarded).

**`src/app.js` — rendering and input only.** Module-level UI state (`selectedTile`, `buySelection`, `notice`) plus the `game` instance.
- `render()` rebuilds `#app.innerHTML` from small `render*` functions; modals are picked by phase via the `MODALS` map. The `html` template tag joins arrays and drops `null`/`false` but **does not escape** — wrap player names and log lines in `escapeHtml()`.
- Events use one delegated `click` and one `submit` listener on `#app`. Add buttons with `data-action="…"` (handler in `ACTIONS`) and forms with `data-form="…"` (handler in `FORMS`).
- Engine calls from the human go through `act(fn)`: run the move, clear selections, `game.runBots()`, re-render; a thrown error becomes `notice` and keeps the current selection.

**Tests** construct deterministic games via `new AcquireGame(random)`, then set up positions by mutating `game.board`, `game.companies`, player hands and `game.deck` directly (helpers `cleanGame()` and `at(row, col)`). `deck.pop()` draws, so the last element of `game.deck` is drawn first.
