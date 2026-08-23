import test from "node:test";
import assert from "node:assert/strict";
import { AcquireGame, priceFor, tileName } from "../src/engine.js";

const fixedRandom = () => .42;
function readyGame() { const game = new AcquireGame(fixedRandom); game.start("테스터", 2); return game; }

test("tile coordinates and stock price tiers match the applet", () => {
  assert.equal(tileName(0), "A1"); assert.equal(tileName(107), "L9");
  const game = new AcquireGame(); const chain = game.companies[0];
  chain.size = 2; assert.equal(priceFor(chain), 200);
  chain.size = 11; assert.equal(priceFor(chain), 700);
  chain.size = 41; assert.equal(priceFor(chain), 1000);
});

test("a founder receives one available share and creates a chain", () => {
  const game = readyGame(); game.turn = 0; game.phase = "tile";
  game.board.fill(null); game.companies.forEach(c => Object.assign(c, { active:false, size:0, shares:25 }));
  game.players[0].hand = [10]; game.board[1] = "loose";
  game.chooseTile(10); assert.equal(game.phase, "found"); game.chooseFounder(0);
  assert.equal(game.companies[0].active, true); assert.equal(game.companies[0].size, 2); assert.equal(game.players[0].shares[0], 1);
});

test("safe chains prevent a merger tile", () => {
  const game = readyGame(); game.turn = 0; game.phase = "tile"; game.board.fill(null);
  game.players[0].hand = [10]; game.board[1] = 0; game.board[19] = 1;
  Object.assign(game.companies[0], { active:true, size:12 }); Object.assign(game.companies[1], { active:true, size:11 });
  assert.equal(game.evaluate(10).type, "invalid");
});

test("merger share exchange consumes two defunct shares for one surviving share", () => {
  const game = readyGame(); game.turn = 0; game.phase = "tile"; game.board.fill(null);
  game.players[0].hand = [10]; game.board[1] = 0; game.board[19] = 1;
  Object.assign(game.companies[0], { active:true, size:7, shares:10 }); Object.assign(game.companies[1], { active:true, size:4, shares:20 });
  game.players[0].shares[1] = 4; game.chooseTile(10);
  assert.equal(game.phase, "mergerShares"); game.resolveMergerShares({ sell:0, exchange:2 });
  assert.equal(game.players[0].shares[1], 0); assert.equal(game.players[0].shares[0], 2); assert.equal(game.companies[0].size, 12);
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
