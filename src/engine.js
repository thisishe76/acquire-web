// Acquire rules engine: all game state and rules, no DOM.
// The UI (src/app.js) only reads this state and calls the public move methods, which throw
// an Error with a user-facing (Korean) message when a move is illegal.

/**
 * The seven hotel chains, indexed by chain id: [name, UI color, price-tier offset].
 * The offset is added to the size-based base price, so Sackson/Zeta are the cheap tier,
 * Hydra/Fusion/America the middle tier, and Phoenix/Quantum the expensive tier.
 */
export const COMPANIES = [
  ["Sackson", "#ef476f", 100], ["Zeta", "#ffd166", 100], ["Hydra", "#f78c3d", 200],
  ["Fusion", "#42b883", 200], ["America", "#4d96ff", 200], ["Phoenix", "#c77dff", 300],
  ["Quantum", "#27c4c9", 300],
];
// The board is a flat array of ROWS * COLS cells; tile/cell index = row * COLS + col.
export const ROWS = 9;
export const COLS = 12;
// Board cell values: EMPTY (null), "loose" (a placed tile not in any chain), or a chain id 0–6.
const EMPTY = null;

/** Board label for a tile index: rows are letters A–I, columns are numbers 1–12 (e.g. 0 → "A1"). */
export function tileName(tile) {
  return tile == null ? "—" : `${String.fromCharCode(65 + Math.floor(tile / COLS))}${(tile % COLS) + 1}`;
}

/**
 * Share price of a chain: a base price from its size bracket plus the chain's tier offset.
 * Chains smaller than 2 tiles (i.e. not on the board) have no price.
 */
export function priceFor(company) {
  const size = company.size;
  let level = size < 2 ? 0 : size === 2 ? 100 : size === 3 ? 200 : size === 4 ? 300 : size === 5 ? 400 : size <= 10 ? 500 : size <= 20 ? 600 : size <= 30 ? 700 : size <= 40 ? 800 : 900;
  return level ? level + COMPANIES[company.id][2] : 0;
}

/** Fisher–Yates shuffle using the injected random function (tests pass a fixed one). */
function shuffled(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * One game of Acquire: a human (always players[0]) against computer players.
 *
 * `phase` drives the turn:
 *   "setup"        – before start()
 *   "tile"         – current player places a tile (chooseTile / passTile)
 *   "found"        – the placed tile founds a chain; waiting for chooseFounder()
 *   "mergeWinner"  – tied largest chains in a merger; waiting for the human's chooseMergeWinner()
 *   "mergerShares" – the human holds shares of a defunct chain; waiting for resolveMergerShares()
 *   "buy"          – current player buys up to 3 shares (buyShares)
 *   "results"      – game over
 * `pending` carries the in-progress founding/merger between those calls.
 * Computer players move synchronously inside the engine via runBots().
 */
export class AcquireGame {
  constructor(random = Math.random) { this.random = random; this.reset(); }

  /** Back to the setup screen with a fresh shuffled deck of all 108 tiles. */
  reset() {
    this.board = Array(ROWS * COLS).fill(EMPTY);
    this.deck = shuffled(Array.from({ length: ROWS * COLS }, (_, i) => i), this.random);
    // shares = shares still in the bank (25 per chain in total, split between bank and players).
    this.companies = COMPANIES.map((_, id) => ({ id, active: false, size: 0, shares: 25 }));
    this.players = []; this.turn = 0; this.phase = "setup"; this.pending = null; this.log = [];
  }

  /**
   * Starts a game for the human plus `aiCount` computer players. Each player draws one tile that
   * is placed on the board as a loose tile; whoever drew the tile closest to A1 goes first.
   */
  start(name, aiCount) {
    this.reset();
    this.players = [{ id: 0, name: name.trim() || "나", human: true, cash: 6000, shares: Array(7).fill(0), hand: [] }];
    const aiNames = ["지민", "서준", "하린", "도윤", "수아"];
    for (let i = 0; i < aiCount; i++) this.players.push({ id: i + 1, name: aiNames[i], human: false, cash: 6000, shares: Array(7).fill(0), hand: [] });
    let first = 0, lowest = Infinity;
    this.players.forEach((player, i) => { const tile = this.draw(); this.board[tile] = "loose"; if (tile < lowest) { lowest = tile; first = i; } this.addLog(`${player.name}의 시작 타일: ${tileName(tile)}`); });
    this.players.forEach(p => this.drawToSix(p));
    this.turn = first; this.phase = "tile"; this.addLog(`${this.current.name}부터 시작합니다.`);
    // If a computer player goes first, play until it is the human's turn.
    this.runBots();
  }

  get current() { return this.players[this.turn]; }
  /** Newest entry first; only the latest 60 entries are kept. */
  addLog(message) { this.log.unshift(message); if (this.log.length > 60) this.log.pop(); }
  /** Draws from the end of the deck; null when the deck is empty. */
  draw() { return this.deck.pop() ?? null; }
  drawToSix(player) { while (player.hand.length < 6) { const tile = this.draw(); if (tile == null) break; player.hand.push(tile); } }
  /** Orthogonally adjacent tile indexes (up, left, down, right) that are on the board. */
  neighbors(tile) { const row = Math.floor(tile / COLS), col = tile % COLS; return [[row - 1, col], [row, col - 1], [row + 1, col], [row, col + 1]].filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS).map(([r, c]) => r * COLS + c); }
  activeChains() { return this.companies.filter(c => c.active); }

  /**
   * What placing `tile` from `player`'s hand would do. This is the single place tile legality is decided:
   *   isolated – touches nothing; stays a loose tile
   *   found    – touches only loose tiles; starts a new chain (invalid if all 7 chains exist —
   *              only temporarily, since a merger can free a chain)
   *   grow     – touches exactly one chain; joins it
   *   merge    – touches 2+ chains; `chains` is ordered largest first (ties: lower id first)
   *   invalid  – not playable; `permanent: true` when it would merge two or more safe chains
   *              (size >= 11). Safe chains never shrink, so such a tile can never be played.
   */
  evaluate(tile, player = this.current) {
    if (!player.hand.includes(tile) || this.board[tile] !== EMPTY) return { type: "invalid", reason: "이미 사용할 수 없는 타일입니다." };
    const adjacent = this.neighbors(tile).map(t => this.board[t]);
    const chains = [...new Set(adjacent.filter(v => Number.isInteger(v)))];
    const loose = adjacent.includes("loose");
    if (!chains.length && !loose) return { type: "isolated" };
    if (!chains.length && loose) return this.availableFounders().length ? { type: "found" } : { type: "invalid", reason: "창설할 수 있는 체인이 없습니다." };
    if (chains.length === 1) return { type: "grow", chain: chains[0] };
    const ordered = chains.sort((a, b) => this.companies[b].size - this.companies[a].size || a - b);
    // Only the largest chain may be safe; a safe chain among the ones being absorbed blocks the merger.
    if (ordered.slice(1).some(id => this.companies[id].size >= 11)) return { type: "invalid", permanent: true, reason: "안전한 체인은 합병할 수 없습니다." };
    return { type: "merge", chains: ordered };
  }

  /** Tiles that would merge two safe chains. Safe chains never shrink, so these can never be played. */
  deadTiles(player) { return player.hand.filter(tile => this.evaluate(tile, player).permanent); }
  /** End-of-turn draw: discard permanently unplayable tiles (out of the game) and draw replacements. */
  refillHand(player) {
    this.drawToSix(player);
    // Repeat in case a replacement tile is itself permanently unplayable.
    for (let dead = this.deadTiles(player); dead.length; dead = this.deadTiles(player)) {
      player.hand = player.hand.filter(tile => !dead.includes(tile));
      this.addLog(`${player.name}: 놓을 수 없는 타일 ${dead.map(tileName).join(", ")}을(를) 버리고 새로 뽑습니다.`);
      this.drawToSix(player);
    }
  }
  hasPlayableTile(player = this.current) { return player.hand.some(tile => this.evaluate(tile, player).type !== "invalid"); }
  /** Skips placing a tile; only allowed when no tile in hand can be played. Goes on to the buy phase. */
  passTile() {
    if (this.phase !== "tile") throw new Error("지금은 타일을 놓을 차례가 아닙니다.");
    if (this.hasPlayableTile()) throw new Error("놓을 수 있는 타일이 있습니다.");
    this.addLog(`${this.current.name}: 놓을 수 있는 타일이 없어 건너뜁니다.`); this.afterTile();
  }
  /** Chain ids not currently on the board (can be founded). */
  availableFounders() { return this.companies.filter(c => !c.active).map(c => c.id); }
  /**
   * Places a tile from the current player's hand. Isolated/grow tiles go straight to the buy phase;
   * founding waits in the "found" phase for chooseFounder(); mergers continue in beginMerge().
   */
  chooseTile(tile) {
    if (this.phase !== "tile") throw new Error("지금은 타일을 놓을 차례가 아닙니다.");
    const result = this.evaluate(tile);
    if (result.type === "invalid") throw new Error(result.reason);
    this.current.hand.splice(this.current.hand.indexOf(tile), 1);
    this.addLog(`${this.current.name}: ${tileName(tile)} 타일`);
    if (result.type === "isolated") { this.board[tile] = "loose"; return this.afterTile(); }
    if (result.type === "grow") { this.placeInto(tile, result.chain); return this.afterTile(); }
    if (result.type === "merge") { this.pending = { kind: "merge", tile, chains: result.chains, winner: null, remaining: null }; return this.beginMerge(); }
    this.pending = { kind: "found", tile }; this.phase = "found";
  }

  /**
   * Puts `tile` into `chain` and absorbs every loose tile connected to it (flood fill).
   * The chain grows by the placed tile plus the absorbed loose tiles. Tiles of other chains are
   * not touched here; during a merger they are recolored later in finishDefunct().
   */
  placeInto(tile, chain) {
    this.board[tile] = chain;
    const fill = start => { if (this.board[start] !== "loose") return 0; this.board[start] = chain; return 1 + this.neighbors(start).reduce((n, next) => n + fill(next), 0); };
    let gained = this.neighbors(tile).reduce((n, next) => n + fill(next), 0);
    this.companies[chain].size += gained + 1;
    this.addLog(`${COMPANIES[chain][0]} 체인이 ${this.companies[chain].size}칸이 되었습니다.`);
  }

  /** Founds `chain` with the pending tile. The founder gets one free share if the bank has any. */
  chooseFounder(chain) {
    if (this.phase !== "found" || !this.availableFounders().includes(chain)) throw new Error("선택할 수 없는 체인입니다.");
    const { tile } = this.pending; this.companies[chain].active = true; this.companies[chain].size = 0; this.placeInto(tile, chain);
    if (this.companies[chain].shares) { this.current.shares[chain]++; this.companies[chain].shares--; }
    this.addLog(`${this.current.name}이(가) ${COMPANIES[chain][0]} 체인을 창설했습니다.`); this.afterTile();
  }

  /**
   * The largest chain survives. If several chains tie for largest, the human chooses
   * ("mergeWinner" phase); a computer player takes the first one.
   */
  beginMerge() {
    const p = this.pending; const largest = Math.max(...p.chains.map(id => this.companies[id].size));
    const choices = p.chains.filter(id => this.companies[id].size === largest);
    if (choices.length > 1 && this.current.human) { this.phase = "mergeWinner"; p.choices = choices; return; }
    this.chooseMergeWinner(choices[0]);
  }
  /**
   * Fixes the surviving chain, adds the merging tile to it, then resolves the defunct chains
   * one at a time, largest first.
   */
  chooseMergeWinner(winner) {
    const p = this.pending;
    if (!p || p.kind !== "merge" || !p.chains.includes(winner)) throw new Error("선택할 수 없는 체인입니다.");
    p.winner = winner; p.remaining = p.chains.filter(id => id !== winner).sort((a, b) => this.companies[b].size - this.companies[a].size || a - b);
    this.placeInto(p.tile, winner); this.processNextDefunct();
  }
  /**
   * Resolves the next defunct chain: pay shareholder bonuses, then let every holder sell/exchange/keep
   * their shares. Pauses in the "mergerShares" phase when the human holds shares; otherwise the bots
   * decide immediately. finishDefunct() calls back here until no defunct chains remain.
   */
  processNextDefunct() {
    const p = this.pending;
    if (!p.remaining.length) { this.pending = null; return this.afterTile(); }
    const defunct = p.remaining.shift(); p.defunct = defunct; this.payBonuses(defunct);
    const humanHas = this.players[0].shares[defunct];
    if (humanHas) { this.phase = "mergerShares"; return; }
    this.resolveDefunctForBots(); this.finishDefunct();
  }
  /**
   * Majority holder gets 10× the share price, minority holder 5×.
   * - Tie for majority: majority + minority bonuses are split among them; no minority bonus.
   * - Only one holder: that player gets both bonuses.
   * - Tie for minority: the minority bonus is split.
   * Split amounts are rounded to the nearest $100.
   */
  payBonuses(chain) {
    const holdings = this.players.map(p => p.shares[chain]); const max = Math.max(...holdings);
    if (!max) return;
    const major = priceFor(this.companies[chain]) * 10, minor = major / 2;
    const majors = holdings.map((n, i) => n === max ? i : -1).filter(i => i >= 0);
    const second = Math.max(...holdings.filter(n => n < max), 0); const minors = second ? holdings.map((n, i) => n === second ? i : -1).filter(i => i >= 0) : [];
    if (majors.length > 1 || !minors.length) { const bonus = Math.round((major + minor) / majors.length / 100) * 100; majors.forEach(i => this.players[i].cash += bonus); }
    else { this.players[majors[0]].cash += major; const bonus = Math.round(minor / minors.length / 100) * 100; minors.forEach(i => this.players[i].cash += bonus); }
    this.addLog(`${COMPANIES[chain][0]} 주주 보너스를 지급했습니다.`);
  }
  /**
   * The human's decision for the current defunct chain: sell `sell` shares and trade 2-for-1 for
   * `exchange` survivor shares; any remaining defunct shares are kept. Bots decide right after.
   */
  resolveMergerShares({ sell = 0, exchange = 0 } = {}) {
    if (this.phase !== "mergerShares") throw new Error("처리할 합병 주식이 없습니다.");
    const { defunct, winner } = this.pending, player = this.players[0], owned = player.shares[defunct];
    if (!Number.isInteger(sell) || !Number.isInteger(exchange) || sell < 0 || exchange < 0 || sell + exchange * 2 > owned || exchange > this.companies[winner].shares) throw new Error("유효하지 않은 주식 처리입니다.");
    this.transferShares(player, defunct, winner, sell, exchange); this.resolveDefunctForBots(); this.finishDefunct();
  }
  /**
   * Sells `sell` defunct shares at the defunct chain's current price and trades `exchange * 2` defunct
   * shares for `exchange` survivor shares. Sold and traded-in shares go back to the defunct chain's bank.
   * Must run before finishDefunct(), which resets the defunct chain's size (and therefore its price).
   */
  transferShares(player, defunct, winner, sell, exchange) {
    player.cash += sell * priceFor(this.companies[defunct]); player.shares[defunct] -= sell; this.companies[defunct].shares += sell;
    player.shares[defunct] -= exchange * 2; this.companies[defunct].shares += exchange * 2; player.shares[winner] += exchange; this.companies[winner].shares -= exchange;
  }
  /**
   * Computer players' share decisions for the current defunct chain: sell just enough to reach a cash
   * reserve of 3× the average share price, exchange as many pairs as possible, and keep the rest —
   * except late in the game (fewer than 30 tiles left), when leftovers are sold too.
   */
  resolveDefunctForBots() {
    const { defunct, winner } = this.pending;
    for (const player of this.players.slice(1)) {
      let owned = player.shares[defunct], sell = 0, exchange = 0;
      if (owned) { const target = this.averagePrice() * 3; sell = player.cash >= target ? 0 : Math.min(owned, Math.floor((target - player.cash) / priceFor(this.companies[defunct]))); owned -= sell; exchange = Math.min(Math.floor(owned / 2), this.companies[winner].shares); if (this.deck.length < 30) sell += owned - exchange * 2; this.transferShares(player, defunct, winner, sell, exchange); }
    }
  }
  /** Folds the defunct chain into the survivor (size and board cells) and frees it to be founded again. */
  finishDefunct() {
    const { defunct, winner } = this.pending;
    this.companies[winner].size += this.companies[defunct].size;
    this.board = this.board.map(cell => cell === defunct ? winner : cell);
    Object.assign(this.companies[defunct], { active: false, size: 0 });
    this.addLog(`${COMPANIES[defunct][0]} 체인이 ${COMPANIES[winner][0]}에 합병되었습니다.`); this.processNextDefunct();
  }

  /** Moves to the buy phase, or ends the turn right away if there is no share left to buy. */
  afterTile() { this.phase = "buy"; if (!this.activeChains().some(c => c.shares > 0)) this.finishBuy([]); }
  /** `selection` is a list of chain ids, one entry per share (e.g. [0, 0, 3]); [] buys nothing. */
  buyShares(selection) { if (this.phase !== "buy") throw new Error("지금은 주식을 살 수 없습니다."); this.finishBuy(selection); }
  /** Validates the whole purchase before changing anything (all or nothing), then ends the turn. */
  finishBuy(selection) {
    const quantities = Array(7).fill(0); for (const id of selection) quantities[id]++;
    if (quantities.reduce((a, b) => a + b, 0) > 3) throw new Error("한 턴에 최대 3주를 살 수 있습니다.");
    let cost = 0; quantities.forEach((n, id) => { const c = this.companies[id]; if (n && (!c.active || c.shares < n)) throw new Error("살 수 없는 주식입니다."); cost += n * priceFor(c); });
    if (cost > this.current.cash) throw new Error("현금이 부족합니다.");
    quantities.forEach((n, id) => { this.current.shares[id] += n; this.companies[id].shares -= n; }); this.current.cash -= cost; if (cost) this.addLog(`${this.current.name}: 주식 ${quantities.reduce((a,b)=>a+b,0)}주 구매`); this.endTurn();
  }
  /** Average price of the active chains that still have shares in the bank (used by the bots). */
  averagePrice() { const active = this.activeChains().filter(c => c.shares); return active.length ? active.reduce((n, c) => n + priceFor(c), 0) / active.length : 0; }
  /**
   * The game ends automatically when a chain has 41+ tiles, when every chain on the board is safe,
   * or when the deck is empty and nobody can place a tile.
   */
  isGameOver() { return this.activeChains().some(c => c.size > 40) || (this.activeChains().length && this.activeChains().every(c => c.size >= 11)) || (this.deck.length === 0 && this.players.every(p => p.hand.every(t => this.evaluate(t, p).type === "invalid"))); }
  /** Checks for game end, refills the current player's hand, and passes the turn (bots play on). */
  endTurn() { if (this.isGameOver()) return this.finishGame(); this.refillHand(this.current); this.turn = (this.turn + 1) % this.players.length; this.phase = "tile"; this.runBots(); }
  /** Final scoring: pay bonuses for every chain on the board, then sell all shares at current prices. */
  finishGame() { for (const chain of this.activeChains()) { this.payBonuses(chain.id); for (const p of this.players) p.cash += p.shares[chain.id] * priceFor(chain); } this.phase = "results"; this.addLog("게임이 종료되었습니다."); }

  /**
   * A computer player's tile placement: prefer merge > found > grow > isolated, ties broken by the
   * lowest tile index. Founding and tied mergers take the first available choice.
   */
  botAction() {
    const player = this.current; const options = player.hand.map(tile => ({ tile, evaluation: this.evaluate(tile, player) })).filter(x => x.evaluation.type !== "invalid");
    if (!options.length) return this.passTile();
    const rank = { merge: 6, found: 5, grow: 4, isolated: 3 }; options.sort((a, b) => (rank[b.evaluation.type] - rank[a.evaluation.type]) || a.tile - b.tile); const chosen = options[0];
    this.chooseTile(chosen.tile); if (this.phase === "found") this.chooseFounder(this.availableFounders()[0]); if (this.phase === "mergeWinner") this.chooseMergeWinner(this.pending.choices[0]);
  }
  /** A computer player's purchase: one share each of the cheapest chains, up to 3, within its cash. */
  botBuy() { const choices = this.activeChains().filter(c => c.shares && priceFor(c) <= this.current.cash).sort((a, b) => priceFor(a) - priceFor(b)); let budget = this.current.cash; const buys = []; for (const c of choices) { if (buys.length === 3) break; if (priceFor(c) <= budget) { buys.push(c.id); budget -= priceFor(c); } } this.finishBuy(buys); }
  /**
   * Plays computer turns until it is the human's turn or the game waits for human input
   * (e.g. the "mergerShares" phase during a bot's merger). The guard prevents an infinite loop.
   */
  runBots() {
    let guard = 50;
    while (!this.current.human && (this.phase === "tile" || this.phase === "buy") && guard--) {
      if (this.phase === "tile") this.botAction();
      if (this.phase === "buy") this.botBuy();
    }
  }
}
