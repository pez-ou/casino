import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RouletteEngine } from "../apps/server/src/games/roulette/RouletteEngine.js";
import type { Action, Player } from "../packages/shared/types.js";
const player = (id: string): Player => ({
  id,
  name: id,
  connected: true,
  ready: false,
  balance: 1000,
  bet: 0,
  hands: [],
  stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
});
const action = (type: Action["type"], extra: Partial<Action> = {}): Action => ({
  type,
  requestId: randomUUID(),
  round: 1,
  ...extra,
});
test("solo acceleration gives exactly ten seconds, is idempotent and does not reveal outcome", () => {
  const e = new RouletteEngine(),
    a = player("a"),
    ps = [a];
  const request = action("ACCELERATE_ROUND");
  const before = Date.now();
  e.action(a, request, ps);
  assert.ok(e.deadline >= before + 10000 && e.deadline <= Date.now() + 10000);
  assert.equal(e.roulette.bettingEndsAt, e.deadline);
  assert.equal(e.roulette.winningNumber, undefined);
  const end = e.deadline;
  e.action(a, request, ps);
  assert.equal(e.deadline, end);
  assert.throws(() => e.action(a, action("ACCELERATE_ROUND"), ps));
  e.tick(ps, end);
  assert.equal(e.phase, "BETS_CLOSED");
  assert.throws(() => e.action(a, action("ACCELERATE_ROUND"), ps));
});
test("multiplayer requires every connected member even without bets; votes survive snapshots and reset next round", async () => {
  const e = new RouletteEngine(),
    a = player("a"),
    b = player("b"),
    ps = [a, b];
  const end = e.deadline;
  await Promise.all(
    ps
      .slice(0, 1)
      .map(async (p) => e.action(p, action("ACCELERATE_ROUND"), ps)),
  );
  assert.equal(e.deadline, end);
  e.action(a, action("ACCELERATE_ROUND"), ps);
  assert.deepEqual(e.state().roulette!.accelerationVotes, ["a"]);
  e.action(b, action("ACCELERATE_ROUND"), ps);
  assert.ok(e.deadline < end);
  e.tick(ps, e.deadline);
  e.tick(ps, e.deadline);
  e.tick(ps, e.deadline);
  e.tick(ps, e.deadline);
  assert.equal(e.round, 2);
  assert.deepEqual(e.roulette.accelerationVotes, []);
});
test("join needs own vote; disconnect cannot block voters; ten seconds never extended", () => {
  const e = new RouletteEngine(),
    a = player("a"),
    b = player("b"),
    c = player("c"),
    ps = [a, b];
  e.action(a, action("ACCELERATE_ROUND"), ps);
  ps.push(c);
  e.action(b, action("ACCELERATE_ROUND"), ps);
  assert.ok(e.deadline - Date.now() > 10000);
  c.connected = false;
  assert.equal(e.tick(ps, Date.now()), true);
  const end = e.deadline;
  assert.ok(end - Date.now() <= 10000);
  e.tick(ps, Date.now());
  assert.equal(e.deadline, end);
  const late = new RouletteEngine();
  late.deadline = Date.now() + 9000;
  assert.throws(() => late.action(a, action("ACCELERATE_ROUND"), [a]));
  assert.throws(() =>
    new RouletteEngine().action(c, action("ACCELERATE_ROUND"), [c]),
  );
});
test("moving own chip changes only official target, keeps wallet and undo refund; cannot move others or locked bets", () => {
  const e = new RouletteEngine(),
    a = player("a"),
    b = player("b"),
    ps = [a, b];
  const bet = action("ROULETTE_BET", {
    betType: "STRAIGHT",
    numbers: [17],
    amount: 25,
  });
  e.action(a, bet, ps);
  const move = action("MOVE_BET", {
    betId: bet.requestId,
    betType: "SPLIT",
    numbers: [1, 2],
  });
  assert.throws(() => e.action(b, move, ps));
  assert.throws(() => e.action(a, { ...move, numbers: [1, 5] }, ps));
  e.action(a, move, ps);
  e.action(a, move, ps);
  assert.equal(a.balance, 975);
  assert.equal(a.bet, 25);
  assert.equal(e.roulette.bets.length, 1);
  assert.deepEqual(e.roulette.bets[0].numbers, [1, 2]);
  assert.equal(e.roulette.bets[0].payout, 17);
  e.deadline = Date.now() - 1;
  assert.throws(() =>
    e.action(
      a,
      action("MOVE_BET", {
        betId: bet.requestId,
        betType: "STRAIGHT",
        numbers: [0],
      }),
      ps,
    ),
  );
  e.deadline = Date.now() + 10000;
  e.action(a, action("UNDO_BET"), ps);
  assert.equal(a.balance, 1000);
});

test("repeated chips retain movable IDs and exact reserved amount", () => {
  const e = new RouletteEngine(), a = player("a"), ps = [a];
  e.action(a, action("ROULETTE_BET", {betType:"STRAIGHT", numbers:[17], amount:25}), ps);
  e.roulette.winningNumber = 0; e.settle(ps);
  e.phase = "RESULT"; e.tick(ps, e.deadline);
  e.action(a, action("REPEAT_BETS", {round:2}), ps);
  const bet = e.roulette.bets[0], balance = a.balance;
  assert.ok(bet.id.endsWith("-0"));
  e.action(a, action("MOVE_BET", {round:2, betId:bet.id, betType:"STRAIGHT", numbers:[0]}), ps);
  assert.equal(a.balance, balance); assert.equal(bet.amount,25); assert.deepEqual(bet.numbers,[0]);
});
