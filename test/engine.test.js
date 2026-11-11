import test from "node:test";
import assert from "node:assert/strict";
import { AcquireGame, COLS, ROWS, priceFor, tileName } from "../src/engine.js";

const fixedRandom = () => .42;
const at = (row, col) => row * COLS + col;
function readyGame() { const game = new AcquireGame(fixedRandom); game.start("테스터", 2); return game; }
function cleanGame() {
  const game = readyGame(); game.turn = 0; game.phase = "tile"; game.board.fill(null); game.pending = null;
  game.companies.forEach(c => Object.assign(c, { active:false, size:0, shares:25 }));
  game.players.forEach(p => { p.shares.fill(0); p.cash = 6000; });
  return game;
}

test("board is 9 rows (A-I) by 12 columns (1-12)", () => {
  assert.equal(ROWS, 9); assert.equal(COLS, 12);
  assert.equal(tileName(0), "A1"); assert.equal(tileName(11), "A12"); assert.equal(tileName(12), "B1"); assert.equal(tileName(107), "I12");
});

test("stock price tiers match the applet", () => {
  const game = new AcquireGame(); const chain = game.companies[0];
  chain.size = 2; assert.equal(priceFor(chain), 200);
  chain.size = 11; assert.equal(priceFor(chain), 700);
  chain.size = 41; assert.equal(priceFor(chain), 1000);
});

test("a founder receives one available share and creates a chain", () => {
  const game = cleanGame();
  game.players[0].hand = [at(1, 1)]; game.board[at(0, 1)] = "loose";
  game.chooseTile(at(1, 1)); assert.equal(game.phase, "found"); game.chooseFounder(0);
  assert.equal(game.companies[0].active, true); assert.equal(game.companies[0].size, 2); assert.equal(game.players[0].shares[0], 1);
});

test("safe chains prevent a merger tile", () => {
  const game = cleanGame();
  game.players[0].hand = [at(1, 1)]; game.board[at(0, 1)] = 0; game.board[at(2, 1)] = 1;
  Object.assign(game.companies[0], { active:true, size:12 }); Object.assign(game.companies[1], { active:true, size:11 });
  assert.equal(game.evaluate(at(1, 1)).type, "invalid");
});

test("merger share exchange consumes two defunct shares for one surviving share", () => {
  const game = cleanGame();
  game.players[0].hand = [at(1, 1)]; game.board[at(0, 1)] = 0; game.board[at(2, 1)] = 1;
  Object.assign(game.companies[0], { active:true, size:7, shares:10 }); Object.assign(game.companies[1], { active:true, size:4, shares:20 });
  game.players[0].shares[1] = 4; game.chooseTile(at(1, 1));
  assert.equal(game.phase, "mergerShares"); game.resolveMergerShares({ sell:0, exchange:2 });
  assert.equal(game.players[0].shares[1], 0); assert.equal(game.players[0].shares[0], 2); assert.equal(game.companies[0].size, 12);
});

test("bots dispose of defunct shares even when the human also holds them", () => {
  const game = cleanGame();
  game.players[0].hand = [at(1, 1)]; game.board[at(0, 1)] = 0; game.board[at(2, 1)] = 1;
  Object.assign(game.companies[0], { active:true, size:7, shares:10 }); Object.assign(game.companies[1], { active:true, size:4, shares:14 });
  game.players[0].shares[1] = 2; game.players[1].shares[1] = 6; game.players[2].shares[1] = 3;
  game.chooseTile(at(1, 1)); assert.equal(game.phase, "mergerShares");
  game.resolveMergerShares({ sell:2 });
  // Bots with plenty of cash keep no defunct pairs: 6 → 3 survivor shares, 3 → 1 survivor share (+1 odd share kept).
  assert.equal(game.players[1].shares[1], 0); assert.equal(game.players[1].shares[0], 3);
  assert.equal(game.players[2].shares[1], 1); assert.equal(game.players[2].shares[0], 1);
  const held = game.players.reduce((n, p) => n + p.shares[1], 0);
  assert.equal(held + game.companies[1].shares, 25, "defunct shares are conserved");
});

test("a human with only unplayable tiles can pass to the buy phase", () => {
  const game = cleanGame();
  game.board[at(0, 1)] = 0; game.board[at(2, 1)] = 1;
  Object.assign(game.companies[0], { active:true, size:12 }); Object.assign(game.companies[1], { active:true, size:11 });
  game.players[0].hand = [at(1, 1)];
  assert.equal(game.hasPlayableTile(), false);
  game.passTile();
  assert.equal(game.phase, "buy"); assert.deepEqual(game.players[0].hand, [at(1, 1)]);
});

test("passing is refused while a playable tile is in hand", () => {
  const game = cleanGame(); game.players[0].hand = [at(5, 5)];
  assert.throws(() => game.passTile(), /놓을 수 있는 타일/);
});

test("share purchase is capped at three and cannot exceed cash", () => {
  const game = readyGame(); game.turn = 0; game.phase = "buy"; Object.assign(game.companies[0], { active:true, size:2, shares:25 }); game.players[0].cash = 500;
  assert.throws(() => game.buyShares([0,0,0,0]), /최대/);
  assert.throws(() => game.buyShares([0,0,0]), /현금/);
});

test("a seeded game advances computer turns without entering an invalid state", () => {
  const game = readyGame();
  assert.ok(["tile", "buy", "found", "mergeWinner", "mergerShares", "results"].includes(game.phase));
  assert.ok(game.players.every(player => player.hand.length <= 6));
  assert.ok(game.companies.every(chain => chain.shares >= 0));
});

test("bots never try to buy more shares than they can afford in total", () => {
  const game = cleanGame(); game.turn = 1; game.phase = "buy";
  Object.assign(game.companies[0], { active:true, size:2 }); Object.assign(game.companies[1], { active:true, size:2 });
  game.players[1].cash = 300; // each share costs $200, so only one fits the budget
  game.botBuy();
  assert.equal(game.players[1].cash, 100); assert.equal(game.players[1].shares[0] + game.players[1].shares[1], 1);
});

// Two safe chains on rows A and C (12 tiles each) make every row-B tile permanently unplayable.
// A small third chain keeps the game from ending because "all chains are safe".
function twoSafeChains(game) {
  for (let col = 0; col < COLS; col++) { game.board[at(0, col)] = 0; game.board[at(2, col)] = 1; }
  Object.assign(game.companies[0], { active:true, size:12 }); Object.assign(game.companies[1], { active:true, size:12 });
  game.board[at(7, 10)] = 2; game.board[at(7, 11)] = 2; Object.assign(game.companies[2], { active:true, size:2 });
}

test("a tile joining two safe chains is marked permanently unplayable", () => {
  const game = cleanGame(); twoSafeChains(game); game.players[0].hand = [at(1, 3), at(5, 5)];
  assert.deepEqual(game.evaluate(at(1, 3)), { type: "invalid", permanent: true, reason: "안전한 체인은 합병할 수 없습니다." });
  assert.deepEqual(game.deadTiles(game.players[0]), [at(1, 3)]);
});

test("dead tiles are discarded at the end of the turn and replaced, including dead replacements", () => {
  const game = cleanGame(); twoSafeChains(game);
  const keep = [at(5, 0), at(5, 2), at(5, 4), at(5, 6), at(5, 8)];
  game.players[0].hand = [at(1, 0), ...keep];
  game.deck = [at(8, 0), at(8, 2), at(8, 4), at(8, 6), at(8, 8), at(1, 1)]; // pop() draws from the end: B2 (dead) first
  game.phase = "buy"; game.buyShares([]);
  const hand = game.players[0].hand;
  assert.equal(hand.length, 6);
  assert.ok(keep.every(t => hand.includes(t)));
  assert.ok(hand.includes(at(8, 8)), "second replacement drawn after the dead replacement");
  for (const dead of [at(1, 0), at(1, 1)]) {
    assert.ok(game.players.every(p => !p.hand.includes(dead)) && !game.deck.includes(dead), `${tileName(dead)} is out of the game`);
  }
  assert.ok(game.log.some(line => line.includes("B1") && line.includes("버리고")));
});

test("a tile that would found an 8th chain is only temporarily unplayable and is kept", () => {
  const game = cleanGame();
  game.companies.forEach(c => Object.assign(c, { active:true, size:2 }));
  game.board[at(4, 4)] = "loose"; game.players[0].hand = [at(4, 5), at(8, 0)];
  const result = game.evaluate(at(4, 5));
  assert.equal(result.type, "invalid"); assert.equal(result.permanent, undefined);
  game.phase = "buy"; game.buyShares([]);
  assert.ok(game.players[0].hand.includes(at(4, 5)));
});
