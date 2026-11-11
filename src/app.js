import { AcquireGame, COMPANIES, priceFor, tileName } from "./engine.js";

const MAX_SHARES_PER_TURN = 3;
const AI_COUNT_OPTIONS = [2, 3, 4, 5];
const DEFAULT_AI_COUNT = 3;
const MOVE_LABELS = { isolated: "고립", grow: "확장", found: "창설", merge: "합병", invalid: "불가" };
const DEAD_TILE_LABEL = "교체 예정"; // permanently unplayable; swapped for a new tile at the end of the turn

const app = document.querySelector("#app");

// ---------------------------------------------------------------------------
// UI state (game rules and data live in the engine)
// ---------------------------------------------------------------------------

let game = new AcquireGame();
let selectedTile = null; // tile the human has highlighted but not yet placed
let buySelection = null; // null = buy modal closed; otherwise chain ids picked so far
let notice = "";         // last error message from the engine

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Template tag for building markup: arrays are joined, and null/undefined/false render as nothing.
 * Values are NOT escaped automatically — wrap user-provided text in escapeHtml().
 */
function html(strings, ...values) {
  const toText = value => Array.isArray(value) ? value.join("") : value == null || value === false ? "" : String(value);
  return strings.reduce((out, text, i) => out + text + (i < values.length ? toText(values[i]) : ""), "");
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ESCAPES[c]);
const classNames = (...names) => names.filter(Boolean).join(" ");
const money = value => `$${value.toLocaleString("en-US")}`;

const chainName = id => COMPANIES[id][0];
const chainColor = id => COMPANIES[id][1];
const humanPlayer = () => game.players[0];
const isHumanTurn = phase => game.phase === phase && game.current.human;

const moveLabel = evaluation => evaluation.permanent ? DEAD_TILE_LABEL : MOVE_LABELS[evaluation.type];

function isPlayableTile(tile) {
  return isHumanTurn("tile") && game.current.hand.includes(tile) && game.evaluate(tile).type !== "invalid";
}

/** Chains the current player could buy one more share of right now. */
function buyableChains() {
  return game.activeChains().filter(chain => chain.shares > 0 && priceFor(chain) <= game.current.cash);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function render() {
  app.innerHTML = game.phase === "setup" ? renderSetup() : renderGame();
}

function renderSetup() {
  const aiOptions = AI_COUNT_OPTIONS.map(count =>
    html`<option value="${count}" ${count === DEFAULT_AI_COUNT && "selected"}>${count}명</option>`);

  return html`
    <section class="card setup">
      <h1>Acquire</h1>
      <p class="muted">호텔 체인을 키우고, 주식을 사고, 가장 큰 자산을 만드세요.</p>
      <form id="setup-form" data-form="setup">
        <label>플레이어 이름<input name="name" maxlength="18" value="나" required></label>
        <label>컴퓨터 상대<select name="ai">${aiOptions}</select></label>
        <button class="primary">게임 시작</button>
      </form>
    </section>`;
}

function renderGame() {
  return html`
    <div class="app">
      ${renderHeader()}
      <div class="layout">
        ${renderBoardCard()}
        <aside class="side">
          ${renderCompanies()}
          ${renderMyAssets()}
          ${renderPlayers()}
          ${renderLog()}
        </aside>
      </div>
      ${renderModal()}
    </div>`;
}

// ---------------------------------------------------------------------------
// Main layout sections
// ---------------------------------------------------------------------------

function renderHeader() {
  const status = game.phase === "results" ? "최종 결과" : `${escapeHtml(game.current.name)}의 차례`;
  return html`
    <header class="topbar">
      <div>
        <h1>Acquire</h1>
        <p class="subtitle">웹 에디션 · ${status}</p>
      </div>
      <div class="pill">남은 타일 ${game.deck.length}</div>
    </header>`;
}

function renderBoardCard() {
  return html`
    <section class="card">
      <h2 class="section-title">보드</h2>
      ${renderBoard()}
      <div class="actions">${renderTurnActions()}</div>
      ${notice && html`<p class="muted">${escapeHtml(notice)}</p>`}
    </section>`;
}

function renderBoard() {
  return html`
    <div class="board-wrap">
      <div class="board" role="grid" aria-label="게임 보드">${game.board.map(renderBoardTile)}</div>
    </div>`;
}

function renderBoardTile(cell, tile) {
  const isChain = Number.isInteger(cell);
  const playable = isPlayableTile(tile);
  const classes = classNames("tile", cell === "loose" && "loose", isChain && "chain", playable && "playable", selectedTile === tile && "selected");
  return html`
    <button class="${classes}" data-action="select-tile" data-tile="${tile}" ${!playable && "disabled"}
      style="${isChain && `background:${chainColor(cell)}`}" aria-label="${tileName(tile)}">${tileName(tile)}</button>`;
}

/** Buttons under the board for whatever the human can do this phase. */
function renderTurnActions() {
  if (isHumanTurn("tile")) {
    return game.hasPlayableTile()
      ? html`<button class="primary" data-action="place-tile" ${selectedTile == null && "disabled"}>선택한 타일 놓기</button>`
      : html`<button class="primary" data-action="pass-tile">놓을 수 있는 타일 없음 · 건너뛰기</button>`;
  }
  if (isHumanTurn("buy")) {
    return html`
      <button class="primary" data-action="open-buy">주식 구매 단계</button>
      <button data-action="skip-buy">구매하지 않기</button>`;
  }
  if (game.phase === "results") return html`<button class="primary" data-action="restart">새 게임</button>`;
  return "";
}

function renderCompanies() {
  const cards = game.companies.map(chain => {
    const detail = chain.active
      ? `${chain.size}칸 · ${money(priceFor(chain))} · ${chain.shares}주`
      : `미창설 · ${chain.shares}주`;
    return html`<div class="company" style="border-color:${chainColor(chain.id)}"><b>${chainName(chain.id)}</b><small>${detail}</small></div>`;
  });
  return html`
    <section class="card">
      <h2 class="section-title">호텔 체인</h2>
      <div class="companies">${cards}</div>
    </section>`;
}

function renderMyAssets() {
  const me = humanPlayer();
  const hand = me.hand.map(tile => html`
    <button data-action="select-tile" data-tile="${tile}" ${game.phase !== "tile" && "disabled"}>
      ${tileName(tile)}<small>${moveLabel(game.evaluate(tile, me))}</small>
    </button>`);
  const stocks = me.shares.map((count, id) =>
    html`<div class="stock" style="border-color:${chainColor(id)}">${chainName(id)} <b>${count}주</b></div>`);

  return html`
    <section class="card">
      <h2 class="section-title">내 자산 · ${money(me.cash)}</h2>
      <div class="hand">${hand}</div>
      <div class="stock-grid" style="margin-top:.7rem">${stocks}</div>
    </section>`;
}

function renderPlayers() {
  const rows = game.players.map((player, i) => html`
    <div class="${classNames("player", i === game.turn && "current")}">
      <span>${escapeHtml(player.name)}${player.human && " (나)"}</span><b>${money(player.cash)}</b>
    </div>`);
  return html`
    <section class="card">
      <h2 class="section-title">플레이어</h2>
      <div class="players">${rows}</div>
    </section>`;
}

function renderLog() {
  return html`
    <section class="card">
      <h2 class="section-title">게임 기록</h2>
      <ul class="log">${game.log.map(line => html`<li>${escapeHtml(line)}</li>`)}</ul>
    </section>`;
}

// ---------------------------------------------------------------------------
// Modals (one per phase that needs a decision from the human)
// ---------------------------------------------------------------------------

const MODALS = {
  found: renderFoundModal,
  mergeWinner: renderMergeWinnerModal,
  mergerShares: renderMergerSharesModal,
  buy: renderBuyModal,
  results: renderResultsModal,
};

function renderModal() {
  return MODALS[game.phase]?.() ?? "";
}

function modal(title, content) {
  return html`
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true">
        <h2>${title}</h2>
        ${content}
      </section>
    </div>`;
}

function chainChoiceButton(id, label = chainName(id)) {
  return html`<button class="choice" data-action="choose-chain" data-chain="${id}" style="border-left:5px solid ${chainColor(id)}">${label}</button>`;
}

function renderFoundModal() {
  return modal("새 체인 창설", html`
    <p class="muted">창설할 호텔 체인을 선택하세요. 창설 보너스 1주를 받습니다.</p>
    <div class="choice-grid">${game.availableFounders().map(id => chainChoiceButton(id))}</div>`);
}

function renderMergeWinnerModal() {
  const choices = game.pending.choices.map(id => chainChoiceButton(id, `${chainName(id)} · ${game.companies[id].size}칸`));
  return modal("합병 체인 선택", html`
    <p class="muted">동일한 크기의 체인입니다. 살아남을 체인을 선택하세요.</p>
    <div class="choice-grid">${choices}</div>`);
}

function renderMergerSharesModal() {
  const { defunct, winner } = game.pending;
  const owned = humanPlayer().shares[defunct];
  const available = game.companies[winner].shares;
  const maxExchange = Math.min(Math.floor(owned / 2), available);

  return modal(`${chainName(defunct)} 주식 처리`, html`
    <p class="muted">보유 ${owned}주 · ${chainName(winner)} 교환 가능 ${available}주 · 매도 가격 ${money(priceFor(game.companies[defunct]))}</p>
    <form id="merger-form" data-form="merger-shares">
      <div class="choice-grid">
        <label>매도 <input name="sell" type="number" value="0" min="0" max="${owned}"></label>
        <label>교환 <input name="exchange" type="number" value="0" min="0" max="${maxExchange}"><small>1주당 기존 주식 2주</small></label>
      </div>
      <div class="actions">
        <button class="primary">확인</button>
        <button type="button" data-action="sell-all">전량 매도</button>
      </div>
    </form>`);
}

function renderBuyModal() {
  if (!isHumanTurn("buy") || buySelection === null) return "";
  const total = buySelection.reduce((sum, id) => sum + priceFor(game.companies[id]), 0);
  const full = buySelection.length >= MAX_SHARES_PER_TURN;
  const choices = buyableChains().map(chain => html`
    <button class="choice" data-action="add-buy" data-chain="${chain.id}" style="border-left:5px solid ${chainColor(chain.id)}" ${full && "disabled"}>
      ${chainName(chain.id)}<br>${money(priceFor(chain))} · ${chain.shares}주
    </button>`);

  return modal("주식 구매", html`
    <p class="muted">한 턴에 최대 ${MAX_SHARES_PER_TURN}주 · 선택 ${buySelection.length}주 · 합계 ${money(total)}</p>
    <div class="choice-grid">${choices}</div>
    <div class="actions">
      <button class="primary" data-action="confirm-buy">구매 확정</button>
      <button data-action="close-buy">취소</button>
    </div>`);
}

function renderResultsModal() {
  const ranked = [...game.players].sort((a, b) => b.cash - a.cash);
  const rows = ranked.map((player, i) =>
    html`<tr><td>${i + 1}</td><td>${escapeHtml(player.name)}</td><td>${money(player.cash)}</td></tr>`);

  return modal("최종 순위", html`
    <table class="result-table">
      <thead><tr><th>순위</th><th>이름</th><th>자산</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="actions"><button class="primary" data-action="restart">새 게임</button></div>`);
}

// ---------------------------------------------------------------------------
// Events: one delegated listener per event type, routed by data-action / data-form
// ---------------------------------------------------------------------------

/**
 * Runs a human move, lets the bots play until it is the human's turn again, then re-renders.
 * If the engine rejects the move, its message is shown and the UI selection is kept.
 */
function act(move) {
  try {
    notice = "";
    move();
    selectedTile = null;
    buySelection = null;
    game.runBots();
  } catch (error) {
    notice = error.message;
  }
  render();
}

const ACTIONS = {
  "select-tile": button => { selectedTile = Number(button.dataset.tile); notice = ""; render(); },
  "place-tile": () => act(() => game.chooseTile(selectedTile)),
  "pass-tile": () => act(() => game.passTile()),
  "choose-chain": button => {
    const id = Number(button.dataset.chain);
    act(() => game.phase === "found" ? game.chooseFounder(id) : game.chooseMergeWinner(id));
  },
  "open-buy": () => { buySelection = []; render(); },
  "add-buy": button => { buySelection.push(Number(button.dataset.chain)); render(); },
  "confirm-buy": () => act(() => game.buyShares(buySelection)),
  "close-buy": () => { buySelection = null; render(); },
  "skip-buy": () => act(() => game.buyShares([])),
  "sell-all": () => act(() => game.resolveMergerShares({ sell: humanPlayer().shares[game.pending.defunct] })),
  "restart": () => { game.reset(); selectedTile = null; render(); },
};

const FORMS = {
  "setup": data => { game.start(data.get("name"), Number(data.get("ai"))); selectedTile = null; render(); },
  "merger-shares": data => act(() => game.resolveMergerShares({ sell: Number(data.get("sell")), exchange: Number(data.get("exchange")) })),
};

app.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (button && !button.disabled) ACTIONS[button.dataset.action](button);
});

app.addEventListener("submit", event => {
  event.preventDefault();
  FORMS[event.target.dataset.form](new FormData(event.target));
});

render();
