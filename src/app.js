import { AcquireGame, COMPANIES, ROWS, COLS, priceFor, tileName } from "./engine.js";

const app = document.querySelector("#app");
let game = new AcquireGame();
let selectedTile = null;
let buySelection = null;
let notice = "";

const money = value => `$${value.toLocaleString("en-US")}`;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[c]);
function companyButton(id, label = COMPANIES[id][0]) { return `<button class="choice" data-chain="${id}" style="border-left:5px solid ${COMPANIES[id][1]}">${label}</button>`; }

function renderSetup() {
  app.innerHTML = `<section class="card setup"><h1>Acquire</h1><p class="muted">호텔 체인을 키우고, 주식을 사고, 가장 큰 자산을 만드세요.</p><form id="setup-form"><label>플레이어 이름<input name="name" maxlength="18" value="나" required></label><label>컴퓨터 상대<select name="ai"><option value="2">2명</option><option value="3" selected>3명</option><option value="4">4명</option><option value="5">5명</option></select></label><button class="primary">게임 시작</button></form></section>`;
  document.querySelector("#setup-form").addEventListener("submit", e => { e.preventDefault(); const data = new FormData(e.currentTarget); game.start(data.get("name"), Number(data.get("ai"))); selectedTile = null; render(); });
}
function renderBoard() {
  return `<div class="board-wrap"><div class="board" role="grid" aria-label="게임 보드">${game.board.map((cell, tile) => {
    const color = Number.isInteger(cell) ? COMPANIES[cell][1] : ""; const playable = game.phase === "tile" && game.current.human && game.evaluate(tile).type !== "invalid" && game.current.hand.includes(tile);
    return `<button class="tile ${cell === "loose" ? "loose" : Number.isInteger(cell) ? "chain" : ""} ${playable ? "playable" : ""} ${selectedTile === tile ? "selected" : ""}" data-board-tile="${tile}" ${playable ? "" : "disabled"} style="${color ? `background:${color}` : ""}" aria-label="${tileName(tile)}">${tileName(tile)}</button>`;
  }).join("")}</div></div>`;
}
function render() {
  if (game.phase === "setup") return renderSetup();
  const human = game.players[0]; const active = game.activeChains();
  app.innerHTML = `<div class="app"><header class="topbar"><div><h1>Acquire</h1><p class="subtitle">웹 에디션 · ${game.phase === "results" ? "최종 결과" : `${game.current.name}의 차례`}</p></div><div class="pill">남은 타일 ${game.deck.length}</div></header><div class="layout"><section class="card"><h2 class="section-title">보드</h2>${renderBoard()}<div class="actions">${game.phase === "tile" && game.current.human ? `<button id="place-tile" class="primary" ${selectedTile == null ? "disabled" : ""}>선택한 타일 놓기</button>` : ""}${game.phase === "buy" && game.current.human ? `<button id="open-buy" class="primary">주식 구매 단계</button><button id="skip-buy">구매하지 않기</button>` : ""}${game.phase === "results" ? `<button id="restart" class="primary">새 게임</button>` : ""}</div>${notice ? `<p class="muted">${escape(notice)}</p>` : ""}</section><aside class="side"><section class="card"><h2 class="section-title">호텔 체인</h2><div class="companies">${game.companies.map(c => `<div class="company" style="border-color:${COMPANIES[c.id][1]}"><b>${COMPANIES[c.id][0]}</b><small>${c.active ? `${c.size}칸 · ${money(priceFor(c))} · ${c.shares}주` : `미창설 · ${c.shares}주`}</small></div>`).join("")}</div></section><section class="card"><h2 class="section-title">내 자산 · ${money(human.cash)}</h2><div class="hand">${human.hand.map(tile => { const e = game.evaluate(tile, human); return `<button data-hand-tile="${tile}" ${game.phase === "tile" ? "" : "disabled"}>${tileName(tile)}<small>${labelFor(e)}</small></button>`; }).join("")}</div><div class="stock-grid" style="margin-top:.7rem">${human.shares.map((n,id) => `<div class="stock" style="border-color:${COMPANIES[id][1]}">${COMPANIES[id][0]} <b>${n}주</b></div>`).join("")}</div></section><section class="card"><h2 class="section-title">플레이어</h2><div class="players">${game.players.map((p,i) => `<div class="player ${i === game.turn ? "current" : ""}"><span>${escape(p.name)}${p.human ? " (나)" : ""}</span><b>${money(p.cash)}</b></div>`).join("")}</div></section><section class="card"><h2 class="section-title">게임 기록</h2><ul class="log">${game.log.map(line => `<li>${escape(line)}</li>`).join("")}</ul></section></aside></div>${modal()}</div>`;
  bind();
}
function labelFor(e) { return ({ isolated:"고립", grow:"확장", found:"창설", merge:"합병", invalid:"불가" })[e.type] || "창설"; }
function modal() {
  if (game.phase === "found") return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><h2>새 체인 창설</h2><p class="muted">창설할 호텔 체인을 선택하세요. 창설 보너스 1주를 받습니다.</p><div class="choice-grid">${game.availableFounders().map(id => companyButton(id)).join("")}</div></section></div>`;
  if (game.phase === "mergeWinner") return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><h2>합병 체인 선택</h2><p class="muted">동일한 크기의 체인입니다. 살아남을 체인을 선택하세요.</p><div class="choice-grid">${game.pending.choices.map(id => companyButton(id, `${COMPANIES[id][0]} · ${game.companies[id].size}칸`)).join("")}</div></section></div>`;
  if (game.phase === "mergerShares") { const p = game.pending, owned = game.players[0].shares[p.defunct], stock = game.companies[p.winner].shares; return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><h2>${COMPANIES[p.defunct][0]} 주식 처리</h2><p class="muted">보유 ${owned}주 · ${COMPANIES[p.winner][0]} 교환 가능 ${stock}주 · 매도 가격 ${money(priceFor(game.companies[p.defunct]))}</p><form id="merger-form"><div class="choice-grid"><label>매도 <input name="sell" type="number" value="0" min="0" max="${owned}"></label><label>교환 <input name="exchange" type="number" value="0" min="0" max="${Math.min(Math.floor(owned/2),stock)}"><small>1주당 기존 주식 2주</small></label></div><div class="actions"><button class="primary">확인</button><button type="button" id="sell-all">전량 매도</button></div></form></section></div>`; }
  if (game.phase === "buy" && game.current.human && buySelection !== null) return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><h2>주식 구매</h2><p class="muted">한 턴에 최대 3주 · 선택 ${buySelection.length}주 · 합계 ${money(buySelection.reduce((n,id)=>n+priceFor(game.companies[id]),0))}</p><div class="choice-grid">${activeCompaniesForBuy().map(c => `<button data-buy-chain="${c.id}" class="choice" style="border-left:5px solid ${COMPANIES[c.id][1]}" ${buySelection.length >= 3 ? "disabled" : ""}>${COMPANIES[c.id][0]}<br>${money(priceFor(c))} · ${c.shares}주</button>`).join("")}</div><div class="actions"><button id="confirm-buy" class="primary">구매 확정</button><button id="close-buy">취소</button></div></section></div>`;
  if (game.phase === "results") { const ranked = [...game.players].sort((a,b) => b.cash-a.cash); return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><h2>최종 순위</h2><table class="result-table"><thead><tr><th>순위</th><th>이름</th><th>자산</th></tr></thead><tbody>${ranked.map((p,i)=>`<tr><td>${i+1}</td><td>${escape(p.name)}</td><td>${money(p.cash)}</td></tr>`).join("")}</tbody></table><div class="actions"><button id="restart-modal" class="primary">새 게임</button></div></section></div>`; }
  return "";
}
function activeCompaniesForBuy() { return game.activeChains().filter(c => c.shares > 0 && priceFor(c) <= game.current.cash); }
function act(fn) { try { notice = ""; fn(); selectedTile = null; buySelection = null; game.runBots(); } catch (error) { notice = error.message; } render(); }
function bind() {
  document.querySelectorAll("[data-hand-tile], [data-board-tile]").forEach(button => button.addEventListener("click", () => { selectedTile = Number(button.dataset.handTile ?? button.dataset.boardTile); notice = ""; render(); }));
  document.querySelector("#place-tile")?.addEventListener("click", () => act(() => game.chooseTile(selectedTile)));
  document.querySelectorAll("[data-chain]").forEach(button => button.addEventListener("click", () => act(() => game.phase === "found" ? game.chooseFounder(Number(button.dataset.chain)) : game.chooseMergeWinner(Number(button.dataset.chain)) )));
  document.querySelector("#open-buy")?.addEventListener("click", () => { buySelection = []; render(); }); document.querySelector("#skip-buy")?.addEventListener("click", () => act(() => game.buyShares([])));
  document.querySelectorAll("[data-buy-chain]").forEach(button => button.addEventListener("click", () => { buySelection.push(Number(button.dataset.buyChain)); render(); })); document.querySelector("#confirm-buy")?.addEventListener("click", () => act(() => game.buyShares(buySelection))); document.querySelector("#close-buy")?.addEventListener("click", () => { buySelection = null; render(); });
  document.querySelector("#merger-form")?.addEventListener("submit", e => { e.preventDefault(); const d = new FormData(e.currentTarget); act(() => game.resolveMergerShares({ sell:Number(d.get("sell")), exchange:Number(d.get("exchange")) })); }); document.querySelector("#sell-all")?.addEventListener("click", () => act(() => game.resolveMergerShares({ sell: game.players[0].shares[game.pending.defunct] })));
  document.querySelectorAll("#restart,#restart-modal").forEach(button => button.addEventListener("click", () => { game.reset(); selectedTile = null; render(); }));
}
render();
