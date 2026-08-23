export const COMPANIES = [
  ["Sackson", "#ef476f", 100], ["Zeta", "#ffd166", 100], ["Hydra", "#f78c3d", 200],
  ["Fusion", "#42b883", 200], ["America", "#4d96ff", 200], ["Phoenix", "#c77dff", 300],
  ["Quantum", "#27c4c9", 300],
];
export const ROWS = 12;
export const COLS = 9;
const EMPTY = null;

export function tileName(tile) {
  return tile == null ? "—" : `${String.fromCharCode(65 + Math.floor(tile / COLS))}${(tile % COLS) + 1}`;
}

export function priceFor(company) {
  const size = company.size;
  let level = size < 2 ? 0 : size === 2 ? 100 : size === 3 ? 200 : size === 4 ? 300 : size === 5 ? 400 : size <= 10 ? 500 : size <= 20 ? 600 : size <= 30 ? 700 : size <= 40 ? 800 : 900;
  return level ? level + COMPANIES[company.id][2] : 0;
}

function shuffled(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class AcquireGame {
  constructor(random = Math.random) { this.random = random; this.reset(); }

  reset() {
    this.board = Array(ROWS * COLS).fill(EMPTY);
    this.deck = shuffled(Array.from({ length: ROWS * COLS }, (_, i) => i), this.random);
    this.companies = COMPANIES.map((_, id) => ({ id, active: false, size: 0, shares: 25 }));
    this.players = []; this.turn = 0; this.phase = "setup"; this.pending = null; this.log = [];
  }

  start(name, aiCount) {
    this.reset();
    this.players = [{ id: 0, name: name.trim() || "나", human: true, cash: 6000, shares: Array(7).fill(0), hand: [] }];
    const aiNames = ["지민", "서준", "하린", "도윤", "수아"];
    for (let i = 0; i < aiCount; i++) this.players.push({ id: i + 1, name: aiNames[i], human: false, cash: 6000, shares: Array(7).fill(0), hand: [] });
    let first = 0, lowest = Infinity;
    this.players.forEach((player, i) => { const tile = this.draw(); this.board[tile] = "loose"; if (tile < lowest) { lowest = tile; first = i; } this.addLog(`${player.name}의 시작 타일: ${tileName(tile)}`); });
    this.players.forEach(p => this.drawToSix(p));
    this.turn = first; this.phase = "tile"; this.addLog(`${this.current.name}부터 시작합니다.`);
    this.runBots();
  }

  get current() { return this.players[this.turn]; }
  addLog(message) { this.log.unshift(message); if (this.log.length > 60) this.log.pop(); }
  draw() { return this.deck.pop() ?? null; }
  drawToSix(player) { while (player.hand.length < 6) { const tile = this.draw(); if (tile == null) break; player.hand.push(tile); } }
  neighbors(tile) { const row = Math.floor(tile / COLS), col = tile % COLS; return [[row - 1, col], [row, col - 1], [row + 1, col], [row, col + 1]].filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS).map(([r, c]) => r * COLS + c); }
  activeChains() { return this.companies.filter(c => c.active); }

  evaluate(tile, player = this.current) {
    if (!player.hand.includes(tile) || this.board[tile] !== EMPTY) return { type: "invalid", reason: "이미 사용할 수 없는 타일입니다." };
    const adjacent = this.neighbors(tile).map(t => this.board[t]);
    const chains = [...new Set(adjacent.filter(v => Number.isInteger(v)))];
    const loose = adjacent.includes("loose");
    if (!chains.length && !loose) return { type: "isolated" };
    if (!chains.length && loose) return this.availableFounders().length ? { type: "found" } : { type: "invalid", reason: "창설할 수 있는 체인이 없습니다." };
    if (chains.length === 1) return { type: "grow", chain: chains[0] };
    const ordered = chains.sort((a, b) => this.companies[b].size - this.companies[a].size || a - b);
    if (ordered.slice(1).some(id => this.companies[id].size >= 11)) return { type: "invalid", reason: "안전한 체인은 합병할 수 없습니다." };
    return { type: "merge", chains: ordered };
  }

  availableFounders() { return this.companies.filter(c => !c.active).map(c => c.id); }
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

  placeInto(tile, chain) {
    this.board[tile] = chain;
    const fill = start => { if (this.board[start] !== "loose") return 0; this.board[start] = chain; return 1 + this.neighbors(start).reduce((n, next) => n + fill(next), 0); };
    let gained = this.neighbors(tile).reduce((n, next) => n + fill(next), 0);
    this.companies[chain].size += gained + 1;
    this.addLog(`${COMPANIES[chain][0]} 체인이 ${this.companies[chain].size}칸이 되었습니다.`);
  }

  chooseFounder(chain) {
    if (this.phase !== "found" || !this.availableFounders().includes(chain)) throw new Error("선택할 수 없는 체인입니다.");
    const { tile } = this.pending; this.companies[chain].active = true; this.companies[chain].size = 0; this.placeInto(tile, chain);
    if (this.companies[chain].shares) { this.current.shares[chain]++; this.companies[chain].shares--; }
    this.addLog(`${this.current.name}이(가) ${COMPANIES[chain][0]} 체인을 창설했습니다.`); this.afterTile();
  }

  beginMerge() {
    const p = this.pending; const largest = Math.max(...p.chains.map(id => this.companies[id].size));
    const choices = p.chains.filter(id => this.companies[id].size === largest);
    if (choices.length > 1 && this.current.human) { this.phase = "mergeWinner"; p.choices = choices; return; }
    this.chooseMergeWinner(choices[0]);
  }
  chooseMergeWinner(winner) {
    const p = this.pending;
    if (!p || p.kind !== "merge" || !p.chains.includes(winner)) throw new Error("선택할 수 없는 체인입니다.");
    p.winner = winner; p.remaining = p.chains.filter(id => id !== winner).sort((a, b) => this.companies[b].size - this.companies[a].size || a - b);
    this.placeInto(p.tile, winner); this.processNextDefunct();
  }
  processNextDefunct() {
    const p = this.pending;
    if (!p.remaining.length) { this.pending = null; return this.afterTile(); }
    const defunct = p.remaining.shift(); p.defunct = defunct; this.payBonuses(defunct);
    const humanHas = this.players[0].shares[defunct];
    if (humanHas) { this.phase = "mergerShares"; return; }
    this.resolveDefunctForBots(); this.finishDefunct();
  }
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
  resolveMergerShares({ sell = 0, exchange = 0 } = {}) {
    if (this.phase !== "mergerShares") throw new Error("처리할 합병 주식이 없습니다.");
    const { defunct, winner } = this.pending, player = this.players[0], owned = player.shares[defunct];
    if (!Number.isInteger(sell) || !Number.isInteger(exchange) || sell < 0 || exchange < 0 || sell + exchange * 2 > owned || exchange > this.companies[winner].shares) throw new Error("유효하지 않은 주식 처리입니다.");
    this.transferShares(player, defunct, winner, sell, exchange); this.finishDefunct();
  }
  transferShares(player, defunct, winner, sell, exchange) {
    player.cash += sell * priceFor(this.companies[defunct]); player.shares[defunct] -= sell; this.companies[defunct].shares += sell;
    player.shares[defunct] -= exchange * 2; this.companies[defunct].shares += exchange * 2; player.shares[winner] += exchange; this.companies[winner].shares -= exchange;
  }
  resolveDefunctForBots() {
    const { defunct, winner } = this.pending;
    for (const player of this.players.slice(1)) {
      let owned = player.shares[defunct], sell = 0, exchange = 0;
      if (owned) { const target = this.averagePrice() * 3; sell = player.cash >= target ? 0 : Math.min(owned, Math.floor((target - player.cash) / priceFor(this.companies[defunct]))); owned -= sell; exchange = Math.min(Math.floor(owned / 2), this.companies[winner].shares); if (this.deck.length < 30) sell += owned - exchange * 2; this.transferShares(player, defunct, winner, sell, exchange); }
    }
  }
  finishDefunct() {
    const { defunct, winner } = this.pending;
    this.companies[winner].size += this.companies[defunct].size;
    this.board = this.board.map(cell => cell === defunct ? winner : cell);
    Object.assign(this.companies[defunct], { active: false, size: 0 });
    this.addLog(`${COMPANIES[defunct][0]} 체인이 ${COMPANIES[winner][0]}에 합병되었습니다.`); this.processNextDefunct();
  }

  afterTile() { this.phase = "buy"; if (!this.activeChains().some(c => c.shares > 0)) this.finishBuy([]); }
  buyShares(selection) { if (this.phase !== "buy") throw new Error("지금은 주식을 살 수 없습니다."); this.finishBuy(selection); }
  finishBuy(selection) {
    const quantities = Array(7).fill(0); for (const id of selection) quantities[id]++;
    if (quantities.reduce((a, b) => a + b, 0) > 3) throw new Error("한 턴에 최대 3주를 살 수 있습니다.");
    let cost = 0; quantities.forEach((n, id) => { const c = this.companies[id]; if (n && (!c.active || c.shares < n)) throw new Error("살 수 없는 주식입니다."); cost += n * priceFor(c); });
    if (cost > this.current.cash) throw new Error("현금이 부족합니다.");
    quantities.forEach((n, id) => { this.current.shares[id] += n; this.companies[id].shares -= n; }); this.current.cash -= cost; if (cost) this.addLog(`${this.current.name}: 주식 ${quantities.reduce((a,b)=>a+b,0)}주 구매`); this.endTurn();
  }
  averagePrice() { const active = this.activeChains().filter(c => c.shares); return active.length ? active.reduce((n, c) => n + priceFor(c), 0) / active.length : 0; }
  isGameOver() { return this.activeChains().some(c => c.size > 40) || (this.activeChains().length && this.activeChains().every(c => c.size >= 11)) || (this.deck.length === 0 && this.players.every(p => p.hand.every(t => this.evaluate(t, p).type === "invalid"))); }
  endTurn() { if (this.isGameOver()) return this.finishGame(); this.drawToSix(this.current); this.turn = (this.turn + 1) % this.players.length; this.phase = "tile"; this.runBots(); }
  finishGame() { for (const chain of this.activeChains()) { this.payBonuses(chain.id); for (const p of this.players) p.cash += p.shares[chain.id] * priceFor(chain); } this.phase = "results"; this.addLog("게임이 종료되었습니다."); }

  botAction() {
    const player = this.current; const options = player.hand.map(tile => ({ tile, evaluation: this.evaluate(tile, player) })).filter(x => x.evaluation.type !== "invalid");
    if (!options.length) { this.phase = "buy"; return this.botBuy(); }
    const rank = { merge: 6, found: 5, grow: 4, isolated: 3 }; options.sort((a, b) => (rank[b.evaluation.type] - rank[a.evaluation.type]) || a.tile - b.tile); const chosen = options[0];
    this.chooseTile(chosen.tile); if (this.phase === "found") this.chooseFounder(this.availableFounders()[0]); if (this.phase === "mergeWinner") this.chooseMergeWinner(this.pending.choices[0]);
  }
  botBuy() { const choices = this.activeChains().filter(c => c.shares && priceFor(c) <= this.current.cash).sort((a, b) => priceFor(a) - priceFor(b)); const buys = choices.slice(0, 3).map(c => c.id); this.finishBuy(buys); }
  runBots() {
    let guard = 50;
    while (!this.current.human && (this.phase === "tile" || this.phase === "buy") && guard--) {
      if (this.phase === "tile") this.botAction();
      if (this.phase === "buy") this.botBuy();
    }
  }
}
