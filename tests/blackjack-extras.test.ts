import { autoDealForRulesTests } from './helpers/rules-round.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSideBet } from "../packages/shared/blackjack.js";
import { BlackjackEngine } from "../apps/server/src/games/blackjack/BlackjackEngine.js";
import { Room } from "../apps/server/src/rooms/Room.js";
import type { Card, Player } from "../packages/shared/types.js";
const cards = (...faces: string[]): Card[] =>
  faces.map((face, i) => ({
    id: String(i),
    rank: face.slice(0, -1),
    suit: face.slice(-1),
  }));
const player = (): Player => ({
  id: "p",
  name: "Test",
  balance: 10000,
  ready: true,
  connected: true,
  bet: 0,
  hands: [],
  stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
});
test("PP distinguishes matching suit, matching color and mixed colors", () => {
  for (const [faces, expected] of [
    [["Q♥", "Q♥"], 25],
    [["Q♥", "Q♦"], 12],
    [["Q♥", "Q♠"], 6],
    [["Q♥", "K♥"], 0],
  ] as const)
    assert.equal(evaluateSideBet("PP", cards(...faces)).payout, expected);
});
test("21+3 pays highest combination and handles low and high ace straights", () => {
  for (const [faces, expected] of [
    [["Q♥", "Q♥", "Q♥"], 100],
    [["A♥", "2♥", "3♥"], 40],
    [["Q♥", "Q♠", "Q♦"], 30],
    [["Q♥", "K♠", "A♦"], 10],
    [["2♥", "6♥", "Q♥"], 5],
    [["K♥", "A♠", "2♦"], 0],
    [["2♥", "6♠", "Q♥"], 0],
  ] as const)
    assert.equal(evaluateSideBet("21+3", cards(...faces)).payout, expected);
});
test("side bets reserve funds atomically, use initial cards, survive splitting and settle once", () => {
  const e = new BlackjackEngine(),
    p = player();
  const queue = cards("8♥", "8♥", "8♥", "3♠", "2♦", "9♣");
  autoDealForRulesTests(e);
  e.shoe.draw = () => queue.shift()!;
  e.start([p]);
  assert.throws(() =>
    e.action(
      p,
      {
        type: "BET_ON_SEAT",
        seatId: 1,
        amount: 100,
        sideBets: { PP: 1001 },
        requestId: "bad",
      },
      [p],
    ),
  );
  assert.equal(p.balance, 10000);
  e.action(
    p,
    {
      type: "BET_ON_SEAT",
      seatId: 1,
      amount: 25,
      sideBets: { PP: 5, "21+3": 2 },
      requestId: "bet",
    },
    [p],
  );
  assert.equal(p.balance, 9968);
  e.action(p, { type: "SPLIT", requestId: "split" }, [p]);
  while (e.phase === "PLAYER_TURN")
    e.action(p, { type: "STAND", requestId: crypto.randomUUID() }, [p]);
  while (e.phase === "DEALER_TURN") e.tick([p], Date.now() + 100000);
  assert.equal(e.seats[0].sideBets?.[0].returned, 130);
  assert.equal(e.seats[0].sideBets?.[1].returned, 202);
  assert.equal(
    p.balance,
    10000 + p.hands.reduce((n, h) => n + h.profit!, 0) + 125 + 200,
  );
  const balance = p.balance;
  e.settle([p]);
  assert.equal(p.balance, balance);
});
test("face down double hides card and bust status in both network views until dealer finishes", () => {
  const e = new BlackjackEngine(),
    p = player();
  const queue = cards("10♥", "9♠", "6♦", "K♣", "8♥");
  autoDealForRulesTests(e);
  e.shoe.draw = () => queue.shift()!;
  const r = new Room("ABCDEF", "blackjack", p.id, e);
  r.members = [{ player: p }] as typeof r.members;
  e.start([p]);
  e.action(p, { type: "BET", amount: 100, requestId: "bet" }, [p]);
  e.action(p, { type: "DOUBLE", faceDown: true, requestId: "double" }, [p]);
  assert.equal(e.phase, "DEALER_TURN");
  for (const h of [
    r.state().players[0].hands[0],
    r.state().game.seats![0].hands[0],
  ]) {
    assert.equal(h.cards[2].rank, "?");
    assert.equal(h.status, "STAND");
    assert.equal(JSON.stringify(h).includes("K♣"), false);
  }
  assert.equal(p.hands[0].cards[2].rank, "K");
  while (e.phase === "DEALER_TURN") e.tick([p], Date.now() + 100000);
  assert.equal(r.state().players[0].hands[0].cards[2].rank, "K");
  assert.equal(p.balance, 9800);
});

test("unsettled side bet escrow is refunded on restart, settled winnings are kept", async () => {
  const { SessionStore } = await import("../apps/server/src/sessions/Store.js");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "blackjack-extra-"));
  try {
    const file = join(dir, "wallets.json");
    const store = new SessionStore(file);
    const { session, token } = store.resolve();
    session.player.ready = true;
    session.player.connected = true;
    const e = new BlackjackEngine(),
      p = session.player;
    const queue = cards("Q♥", "9♠", "Q♥", "8♦");
    autoDealForRulesTests(e);
  e.shoe.draw = () => queue.shift()!;
    e.start([p]);
    e.action(
      p,
      {
        type: "BET_ON_SEAT",
        seatId: 1,
        amount: 25,
        sideBets: { PP: 5 },
        requestId: "bet",
      },
      [p],
    );
    store.save();
    assert.equal(
      new SessionStore(file).resolve(token).session.player.balance,
      10000,
    );
    e.action(p, { type: "STAND", requestId: "stand" }, [p]);
    while (e.phase === "DEALER_TURN") e.tick([p], Date.now() + 100000);
    store.save();
    assert.equal(p.sideBetEscrow, 0);
    assert.equal(
      new SessionStore(file).resolve(token).session.player.balance,
      p.balance,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("principal cap is 2000 and each side bet cap is 200, validation is atomic", () => {
  const e = new BlackjackEngine(),
    p = player();
  e.start([p]);
  for (const [amount, sideBets] of [
    [2001, {}],
    [2000, { PP: 201 }],
    [2000, { "21+3": 201 }],
  ] as const) {
    assert.throws(() =>
      e.action(
        p,
        {
          type: "BET_ON_SEAT",
          seatId: 1,
          amount,
          sideBets,
          requestId: crypto.randomUUID(),
        },
        [p],
      ),
    );
    assert.equal(p.balance, 10000);
    assert.equal(e.seats[0].bet, 0);
  }
  const queue = cards("10♥", "9♠", "6♦");
  autoDealForRulesTests(e);
  e.shoe.draw = () => queue.shift()!;
  e.action(
    p,
    {
      type: "BET_ON_SEAT",
      seatId: 1,
      amount: 2000,
      sideBets: { PP: 200, "21+3": 200 },
      requestId: "max",
    },
    [p],
  );
  assert.equal(p.balance, 7600);
  assert.equal(e.seats[0].bet, 2000);
});

test("all ten-valued ranks may split, but do not count as a Perfect Pair", () => {
  for (const first of ["10", "J", "Q", "K"])
    for (const second of ["10", "J", "Q", "K"]) {
      const e = new BlackjackEngine(),
        p = player();
      const queue = cards(`${first}♥`, "9♠", `${second}♦`, "2♣", "3♥", "8♣");
      autoDealForRulesTests(e);
  e.shoe.draw = () => queue.shift()!;
      e.start([p]);
      e.action(
        p,
        { type: "BET_ON_SEAT", seatId: 1, amount: 100, requestId: "bet" },
        [p],
      );
      e.action(p, { type: "SPLIT", requestId: "split" }, [p]);
      assert.equal(p.hands.length, 2);
      assert.equal(p.hands[0].cards[0].rank, first);
      assert.equal(p.hands[1].cards[0].rank, second);
      assert.equal(p.balance, 9800);
      if (first !== second)
        assert.equal(
          evaluateSideBet("PP", cards(`${first}♥`, `${second}♦`)).payout,
          0,
        );
      while (e.phase === "PLAYER_TURN")
        e.action(p, { type: "STAND", requestId: crypto.randomUUID() }, [p]);
      while (e.phase === "DEALER_TURN") e.tick([p], Date.now() + 100000);
      assert.equal(
        p.balance,
        10000 + p.hands.reduce((sum, h) => sum + h.profit!, 0),
      );
    }
});
