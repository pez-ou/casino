import { autoDealForRulesTests } from './helpers/rules-round.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BlackjackEngine } from "../apps/server/src/games/blackjack/BlackjackEngine.js";
import { RouletteEngine } from "../apps/server/src/games/roulette/RouletteEngine.js";
import { Room } from "../apps/server/src/rooms/Room.js";
import {
  SPOTS,
  WHEEL,
  RED,
  color,
  spotFor,
} from "../packages/shared/roulette.js";
import type { Player, Action } from "../packages/shared/types.js";
const player = (id = "a"): Player => ({
  id,
  name: id,
  balance: 10000,
  connected: true,
  ready: true,
  hands: [],
  bet: 0,
  stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
});
const action = (type: Action["type"], extra: Partial<Action> = {}): Action => ({
  requestId: randomUUID(),
  type,
  ...extra,
});
function rig(e: BlackjackEngine, ranks: string[]) {
  autoDealForRulesTests(e);
  let i = 0;
  e.shoe.draw = () => {
    assert.ok(i < ranks.length, "no unnecessary dealer draw");
    return { id: String(i), rank: ranks[i++], suit: "♠" };
  };
}
function decline(e: BlackjackEngine, ps: Player[]) {
  if (e.phase !== "INSURANCE") return;
  for (const seat of e.seats)
    if (seat.insurance?.decision === "PENDING")
      e.action(
        ps.find((p) => p.id === seat.playerId)!,
        action("DECLINE_INSURANCE", { seatId: seat.id }),
        ps,
      );
}
function play(e: BlackjackEngine, p: Player[], type: Action["type"]) {
  decline(e, p);
  const t = e.turn!;
  e.action(
    p.find((p) => p.id === t.playerId)!,
    action(type, { seatId: t.seatId, hand: t.hand }),
    p,
  );
}
function finish(e: BlackjackEngine, ps: Player[]) {
  decline(e, ps);
  while (e.phase === "PLAYER_TURN") play(e, ps, "STAND");
  for (let i = 0; i < 30 && e.phase === "DEALER_TURN"; i++)
    e.tick(ps, Date.now() + 100000 + i * 1000);
  assert.equal(e.phase, "ROUND_END");
}
test("one busted seat settles immediately and keeps only dealer upcard; settlement idempotent", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, ["10", "A", "9", "5"]);
  e.start([p]);
  e.action(p, action("BET", { amount: 100 }), [p]);
  play(e, [p], "HIT");
  assert.equal(e.phase, "ROUND_END");
  assert.equal(e.dealer.length, 1);
  assert.equal(p.balance, 9900);
  e.settle([p]);
  assert.equal(p.balance, 9900);
  assert.equal(p.stats.hands, 1);
});
test("all players bust including doubled hands: no second dealer card", () => {
  const e = new BlackjackEngine(),
    ps = [player(), player("b")];
  rig(e, ["10", "10", "A", "9", "9", "5", "6"]);
  e.start(ps);
  for (const p of ps) e.action(p, action("BET", { amount: 100 }), ps);
  play(e, ps, "DOUBLE");
  play(e, ps, "HIT");
  assert.equal(e.phase, "ROUND_END");
  assert.equal(e.dealer.length, 1);
  assert.deepEqual(
    ps.map((p) => p.balance),
    [9800, 9900],
  );
});
test("seven independent seats shared by two players, no eighth, wagers from one wallet, individual outcomes", () => {
  const e = new BlackjackEngine(),
    ps = [player(), player("b")];
  for (let seatId = 1; seatId <= 7; seatId++)
    e.action(ps[seatId <= 3 ? 0 : 1], action("TAKE_SEAT", { seatId }), ps);
  assert.equal(e.seats.filter((s) => s.playerId === ps[0].id).length, 3);
  assert.throws(() => e.action(ps[0], action("TAKE_SEAT", { seatId: 8 }), ps));
  assert.throws(() => e.action(ps[0], action("TAKE_SEAT", { seatId: 4 }), ps));
  e.start(ps);
  rig(e, [...Array(7).fill("10"), "10", ...Array(7).fill("8"), "7"]);
  for (const seat of e.seats)
    e.action(
      ps.find((p) => p.id === seat.playerId)!,
      action("BET_ON_SEAT", { seatId: seat.id, amount: seat.id * 100 }),
      ps,
    );
  assert.equal(ps[0].balance, 9400);
  assert.equal(
    new Set(ps.flatMap((p) => p.hands.flatMap((h) => h.cards.map((c) => c.id))))
      .size,
    14,
  );
  assert.throws(() =>
    e.action(ps[0], action("STAND", { seatId: 2, hand: 1 }), ps),
  );
  assert.throws(() => e.action(ps[0], action("STAND"), ps));
  const turns: number[] = [];
  while (e.phase === "PLAYER_TURN") {
    turns.push(e.turn!.seatId!);
    play(e, ps, "STAND");
  }
  assert.deepEqual(turns, [1, 2, 3, 4, 5, 6, 7]);
  finish(e, ps);
  assert.equal(ps[0].balance, 10600);
  assert.equal(ps[1].balance, 12200);
  assert.ok(e.seats.every((s) => s.hands[0].result === "WIN"));
  ps.forEach((p) => (p.ready = true));
  e.start(ps);
  assert.equal(e.seats.filter((s) => s.playerId).length, 7);
});
test("splits stay on their original seat, all split hands bust without dealer drawing", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, ["10", "A", "10", "9", "8", "5", "6"]);
  e.start([p]);
  e.action(p, action("BET", { amount: 100 }), [p]);
  play(e, [p], "SPLIT");
  assert.equal(e.seats.filter((s) => s.playerId).length, 1);
  assert.ok(p.hands.every((h) => h.seatId === 1));
  play(e, [p], "HIT");
  play(e, [p], "HIT");
  assert.equal(e.dealer.length, 1);
  assert.equal(e.phase, "ROUND_END");
  assert.equal(p.balance, 9800);
});
test("one split bust and a surviving seat still require dealer comparison", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, ["8", "10", "8", "10", "10", "10", "7"]);
  e.start([p]);
  e.action(p, action("BET", { amount: 100 }), [p]);
  play(e, [p], "SPLIT");
  play(e, [p], "HIT");
  play(e, [p], "STAND");
  finish(e, [p]);
  assert.equal(e.dealer.length, 2);
  assert.equal(p.hands[0].result, "BUST");
  assert.equal(p.hands[1].result, "WIN");
  assert.equal(p.balance, 10000);
});
test("seat reservation atomic under concurrent ownership claims; same owner take is idempotent", async () => {
  const e = new BlackjackEngine(),
    r = new Room("ABC234", "blackjack", "a", e),
    ps = [player(), player("b")];
  const results = await Promise.allSettled(
    ps.map((p) =>
      r.run(() => e.action(p, action("TAKE_SEAT", { seatId: 1 }), ps)),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  e.action(ps[0], action("TAKE_SEAT", { seatId: 1 }), ps);
  assert.equal(e.seats.filter((s) => s.playerId).length, 1);
});
test("concurrent wagers cannot overspend shared wallet; leaving an unlocked seat refunds it", async () => {
  const e = new BlackjackEngine(),
    p = player();
  p.balance = 100;
  e.action(p, action("TAKE_SEAT", { seatId: 1 }), [p]);
  e.action(p, action("TAKE_SEAT", { seatId: 2 }), [p]);
  e.start([p]);
  const r = new Room("ABC234", "blackjack", "a", e);
  const out = await Promise.allSettled(
    [1, 2].map((seatId) =>
      r.run(() =>
        e.action(p, action("BET_ON_SEAT", { seatId, amount: 100 }), [p]),
      ),
    ),
  );
  assert.equal(out.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(p.balance, 0);
  e.action(p, action("LEAVE_SEAT", { seatId: 1 }), [p]);
  assert.equal(p.balance, 100);
  assert.throws(() =>
    e.action(p, action("BET_ON_SEAT", { seatId: 2, amount: 1 }), [p]),
  );
});
test("roulette wheel authentic, exactly 37 pockets, correct 18 red and 18 black", () => {
  assert.deepEqual(
    WHEEL,
    [
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
      24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
    ],
  );
  assert.equal(new Set(WHEEL).size, 37);
  assert.deepEqual(
    [...WHEEL].sort((a, b) => a - b),
    Array.from({ length: 37 }, (_, i) => i),
  );
  assert.equal(RED.length, 18);
  assert.equal(WHEEL.filter((n) => color(n) === "black").length, 18);
  assert.equal(color(0), "green");
});
test("every legal bet pays exact odds on every number, including zero losses and first four", () => {
  for (const spot of SPOTS)
    for (let winning = 0; winning <= 36; winning++) {
      const e = new RouletteEngine(),
        p = player();
      e.action(
        p,
        action("ROULETTE_BET", {
          betType: spot.type,
          numbers: spot.numbers,
          amount: 10,
        }),
        [p],
      );
      e.roulette.winningNumber = winning;
      e.settle([p]);
      const returned = spot.numbers.includes(winning)
        ? 10 * (spot.payout + 1)
        : 0;
      assert.equal(
        p.balance,
        9990 + returned,
        `${spot.type} ${spot.label} -> ${winning}`,
      );
      e.settle([p]);
      assert.equal(p.balance, 9990 + returned);
      assert.equal(p.bet, 0);
    }
  assert.ok(!spotFor("SPLIT", [1, 3]));
  assert.ok(!spotFor("CORNER", [1, 2, 3, 4]));
  assert.ok(!spotFor("STRAIGHT", [37]));
  assert.ok(!spotFor("SPLIT", [1, 1]));
});
test("roulette countdown locks at original deadline, cryptographic outcome hidden until lock, reconnection snapshots and automatic next round", () => {
  const e = new RouletteEngine({ betting: 30, spin: 10, result: 5 }),
    ps = [player(), player("b")],
    start = e.deadline;
  assert.equal(e.state().roulette!.winningNumber, undefined);
  e.tick(ps, start - 5000);
  assert.equal(e.phase, "BETTING");
  assert.equal(e.deadline, start);
  for (const p of ps)
    e.action(
      p,
      action("ROULETTE_BET", {
        betType: "STRAIGHT",
        numbers: [0],
        amount: 100,
      }),
      ps,
    );
  e.tick(ps, start);
  assert.equal(e.phase, "BETS_CLOSED");
  assert.ok(Number.isInteger(e.roulette.winningNumber));
  assert.ok(e.roulette.winningNumber! >= 0 && e.roulette.winningNumber! < 37);
  assert.throws(() => e.action(ps[0], action("CLEAR_BETS"), ps));
  e.tick(ps, start + 250);
  assert.equal(e.phase, "SPINNING");
  const snapshot = JSON.parse(JSON.stringify(e.state()));
  assert.equal(snapshot.roulette.spinEndsAt, start + 10000);
  assert.equal(
    snapshot.roulette.winningNumber,
    e.state().roulette!.winningNumber,
  );
  e.tick(ps, start + 10000);
  assert.equal(e.phase, "RESULT");
  assert.equal(e.roulette.results.a.returned, e.roulette.results.b.returned);
  const balances = ps.map((p) => p.balance);
  e.settle(ps);
  assert.deepEqual(
    ps.map((p) => p.balance),
    balances,
  );
  e.tick(ps, start + 15000);
  assert.equal(e.phase, "BETTING");
  assert.equal(e.round, 2);
  assert.equal(e.roulette.winningNumber, undefined);
  e.action(ps[0], action("REPEAT_BETS"), ps);
  assert.equal(e.roulette.bets[0].amount, 100);
});
test("roulette independent simultaneous bets, undo/clear, invalid geometry, deadline enforced without tick", async () => {
  const e = new RouletteEngine(),
    r = new Room("ABC234", "roulette", "a", e),
    ps = [player(), player("b")];
  ps[0].balance = 100;
  const out = await Promise.allSettled(
    [0, 0, 1].map((i) =>
      r.run(() =>
        e.action(
          ps[i],
          action("ROULETTE_BET", {
            betType: "STRAIGHT",
            numbers: [i],
            amount: 100,
          }),
          ps,
        ),
      ),
    ),
  );
  assert.equal(out.filter((r) => r.status === "fulfilled").length, 2);
  assert.deepEqual(
    ps.map((p) => p.balance),
    [0, 9900],
  );
  e.action(ps[0], action("UNDO_BET"), ps);
  assert.equal(ps[0].balance, 100);
  assert.equal(e.roulette.bets[0].playerId, "b");
  e.action(ps[1], action("CLEAR_BETS"), ps);
  assert.equal(ps[1].balance, 10000);
  assert.throws(() =>
    e.action(
      ps[0],
      action("ROULETTE_BET", { betType: "SPLIT", numbers: [1, 3], amount: 10 }),
      ps,
    ),
  );
  e.deadline = Date.now() - 1;
  assert.throws(() =>
    e.action(
      ps[0],
      action("ROULETTE_BET", { betType: "STRAIGHT", numbers: [0], amount: 1 }),
      ps,
    ),
  );
});
test("roulette duplicate bet/undo IDs cannot debit or refund twice and old round requests rejected", () => {
  const e = new RouletteEngine(),
    p = player();
  const bet = action("ROULETTE_BET", {
    betType: "STRAIGHT",
    numbers: [0],
    amount: 100,
    round: 1,
  });
  e.action(p, bet, [p]);
  e.action(p, bet, [p]);
  assert.equal(p.balance, 9900);
  assert.equal(e.roulette.bets.length, 1);
  const undo = action("UNDO_BET", { round: 1 });
  e.action(p, undo, [p]);
  e.action(p, undo, [p]);
  assert.equal(p.balance, 10000);
  e.roulette.winningNumber = 0;
  e.settle([p]);
  e.phase = "RESULT";
  e.tick([p], e.deadline);
  assert.throws(() => e.action(p, bet, [p]));
  assert.equal(p.balance, 10000);
});
test("roulette RNG independent of Math.random and outcomes stay in European range", () => {
  const original = Math.random;
  try {
    Math.random = () => {
      throw Error("non cryptographic RNG forbidden");
    };
    for (let i = 0; i < 100; i++) {
      const e = new RouletteEngine();
      e.tick([], e.deadline);
      assert.ok(Number.isInteger(e.roulette.winningNumber));
      assert.ok(
        e.roulette.winningNumber! >= 0 && e.roulette.winningNumber! <= 36,
      );
    }
  } finally {
    Math.random = original;
  }
});
test("same request UUID from different players cannot erase another wallet’s roulette bets", () => {
  const e = new RouletteEngine(),
    ps = [player(), player("b")],
    requestId = randomUUID();
  for (const p of ps)
    e.action(
      p,
      action("ROULETTE_BET", {
        requestId,
        betType: "STRAIGHT",
        numbers: [0],
        amount: 100,
      }),
      ps,
    );
  e.action(ps[0], action("UNDO_BET"), ps);
  assert.equal(e.roulette.bets.length, 1);
  assert.equal(e.roulette.bets[0].playerId, "b");
  assert.deepEqual(
    ps.map((p) => p.balance),
    [10000, 9900],
  );
  e.roulette.winningNumber = 0;
  e.settle(ps);
  assert.deepEqual(
    ps.map((p) => p.balance),
    [10000, 13500],
  );
});
