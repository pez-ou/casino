import { autoDealForRulesTests } from './helpers/rules-round.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BlackjackEngine } from "../apps/server/src/games/blackjack/BlackjackEngine.js";
import { natural } from "../apps/server/src/games/blackjack/Shoe.js";
import { Room } from "../apps/server/src/rooms/Room.js";
import type { Player, Action, Card } from "../packages/shared/types.js";
const player = (id = "a", balance = 10000): Player => ({
  id,
  name: id,
  balance,
  connected: true,
  ready: true,
  hands: [],
  bet: 0,
  stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
});
const a = (type: Action["type"], extra: Partial<Action> = {}): Action => ({
  type,
  requestId: randomUUID(),
  ...extra,
});
const cards = (ranks: string[]): Card[] =>
  ranks.map((rank, i) => ({ rank, id: String(i), suit: "♠" }));
function rig(e: BlackjackEngine, ranks: string[]) {
  autoDealForRulesTests(e);
  const deck = cards(ranks);
  e.shoe.draw = () => {
    assert.ok(deck.length, "unnecessary draw");
    return deck.shift()!;
  };
}
function begin(ranks: string[], balance = 10000) {
  const e = new BlackjackEngine(),
    p = player("a", balance);
  rig(e, ranks);
  e.start([p]);
  e.action(p, a("BET", { amount: 100 }), [p]);
  return { e, p };
}
function finish(e: BlackjackEngine, ps: Player[]) {
  for (let i = 0; i < 30 && e.phase === "DEALER_TURN"; i++)
    e.tick(ps, Date.now() + 100000 + i * 1000);
  assert.equal(e.phase, "ROUND_END");
}
test("Ace opens ten-second insurance, all play blocked, no peek and automatic refusal", () => {
  const before = Date.now(),
    { e, p } = begin(["10", "A", "6", "K"]);
  assert.equal(e.phase, "INSURANCE");
  assert.equal(e.dealer.length, 1);
  assert.equal(e.seats[0].insurance!.decision, "PENDING");
  assert.ok(e.deadline! >= before + 10000 && e.deadline! <= Date.now() + 10000);
  for (const type of ["HIT", "STAND", "DOUBLE", "SPLIT"] as const)
    assert.throws(() => e.action(p, a(type), [p]));
  assert.equal(e.tick([p], e.deadline! - 1), false);
  assert.equal(e.dealer.length, 1);
  e.tick([p], e.deadline!);
  assert.equal(e.phase, "PLAYER_TURN");
  assert.equal(e.seats[0].insurance!.decision, "DECLINED");
  assert.equal(p.balance, 9900);
  assert.equal(e.dealer.length, 1);
});
test("dealer without Ace has no insurance and requests are rejected", () => {
  const { e, p } = begin(["10", "9", "6"]);
  assert.equal(e.phase, "PLAYER_TURN");
  assert.equal(e.seats[0].insurance, undefined);
  assert.throws(() => e.action(p, a("TAKE_INSURANCE", { seatId: 1 }), [p]));
});
test("half initial stake reserved, dealer natural pays independent insurance 2:1 and main loss nets zero", () => {
  const { e, p } = begin(["10", "A", "6", "K"]);
  e.action(p, a("TAKE_INSURANCE", { seatId: 1 }), [p]);
  assert.equal(e.phase, "PLAYER_TURN");
  assert.equal(e.dealer.length, 1);
  assert.equal(p.balance, 9850);
  assert.equal(p.insuranceEscrow, 50);
  assert.equal(e.seats[0].insurance!.amount, 50);
  e.action(p, a("STAND"), [p]);
  finish(e, [p]);
  assert.equal(p.hands[0].profit, -100);
  assert.deepEqual(e.seats[0].insurance, {
    decision: "TAKEN",
    amount: 50,
    returned: 150,
    profit: 100,
    result: "WIN",
  });
  assert.equal(p.balance, 10000);
  assert.equal(p.stats.profit, 0);
  assert.equal(p.insuranceEscrow, 0);
  e.settle([p]);
  assert.equal(p.balance, 10000);
});
test("insurance loses independently when dealer has ordinary 21 and player natural pays 3:2", () => {
  const e = new BlackjackEngine(),
    ps = [player(), player("b")];
  rig(e, ["A", "10", "A", "K", "8", "5", "5"]);
  e.start(ps);
  for (const p of ps) e.action(p, a("BET", { amount: 100 }), ps);
  e.action(ps[0], a("TAKE_INSURANCE", { seatId: 1 }), ps);
  e.action(ps[1], a("DECLINE_INSURANCE", { seatId: 2 }), ps);
  e.action(ps[1], a("STAND"), ps);
  finish(e, ps);
  assert.equal(e.dealer.length, 3);
  assert.equal(ps[0].hands[0].result, "BLACKJACK");
  assert.equal(e.seats[0].insurance!.result, "LOSE");
  assert.equal(ps[0].balance, 10100);
});
test("ordinary hand can still win normally after insurance loss", () => {
  const { e, p } = begin(["10", "A", "8", "6"]);
  e.action(p, a("TAKE_INSURANCE", { seatId: 1 }), [p]);
  e.action(p, a("STAND"), [p]);
  finish(e, [p]);
  assert.equal(p.hands[0].result, "WIN");
  assert.equal(e.seats[0].insurance!.profit, -50);
  assert.equal(p.balance, 10050);
});
test("all bust with insurance: exactly second dealer card, never complete dealer 13 to 17", () => {
  for (const second of ["K", "2"]) {
    const { e, p } = begin(["10", "A", "9", "5", second]);
    e.action(p, a("TAKE_INSURANCE", { seatId: 1 }), [p]);
    e.action(p, a("HIT"), [p]);
    assert.equal(e.phase, "DEALER_TURN");
    assert.equal(e.dealer.length, 1);
    finish(e, [p]);
    assert.equal(e.dealer.length, 2);
    assert.equal(p.balance, second === "K" ? 10000 : 9850);
  }
});
test("all bust without insurance immediately settle without second dealer card", () => {
  const { e, p } = begin(["10", "A", "9", "5"]);
  e.action(p, a("DECLINE_INSURANCE", { seatId: 1 }), [p]);
  e.action(p, a("HIT"), [p]);
  assert.equal(e.phase, "ROUND_END");
  assert.equal(e.dealer.length, 1);
  assert.equal(p.balance, 9900);
});
test("dealer natural without insurance beats ordinary three-card 21", () => {
  const { e, p } = begin(["10", "A", "5", "6", "K"]);
  e.action(p, a("DECLINE_INSURANCE", { seatId: 1 }), [p]);
  e.action(p, a("HIT"), [p]);
  finish(e, [p]);
  assert.equal(p.hands[0].status, "STAND");
  assert.equal(p.hands[0].result, "DEALER BLACKJACK");
  assert.equal(p.balance, 9900);
});
test("natural versus natural pushes initial bet, independent insurance still wins", () => {
  for (const insured of [false, true]) {
    const { e, p } = begin(["A", "A", "K", "10"]);
    e.action(
      p,
      a(insured ? "TAKE_INSURANCE" : "DECLINE_INSURANCE", { seatId: 1 }),
      [p],
    );
    finish(e, [p]);
    assert.equal(p.hands[0].result, "PUSH");
    assert.equal(p.balance, insured ? 10100 : 10000);
  }
});
test("ordinary 21 versus ordinary 21 pushes; natural classification excludes split and three cards", () => {
  for (const ranks of [
    ["7", "7", "7"],
    ["10", "5", "6"],
  ])
    assert.equal(natural(cards(ranks)), false);
  assert.equal(natural(cards(["A", "K"])), true);
  assert.equal(natural(cards(["A", "10"]), true), false);
  const { e, p } = begin(["10", "6", "5", "6", "10", "5"]);
  e.action(p, a("HIT"), [p]);
  finish(e, [p]);
  assert.equal(p.hands[0].result, "PUSH");
  assert.equal(p.balance, 10000);
});
test("multi-seat decisions share wallet, reject ownership/double subscription and remain through reconnect", async () => {
  const e = new BlackjackEngine(),
    ps = [player("a", 400), player("b")];
  for (const seatId of [1, 2]) e.action(ps[0], a("TAKE_SEAT", { seatId }), ps);
  e.action(ps[1], a("TAKE_SEAT", { seatId: 3 }), ps);
  e.start(ps);
  rig(e, ["10", "9", "10", "A", "6", "7", "9", "K"]);
  for (const seatId of [1, 2, 3])
    e.action(
      ps[seatId === 3 ? 1 : 0],
      a("BET_ON_SEAT", { seatId, amount: seatId === 2 ? 200 : 100 }),
      ps,
    );
  assert.equal(e.phase, "INSURANCE");
  const decision = a("TAKE_INSURANCE", { seatId: 1 });
  e.action(ps[0], decision, ps);
  e.action(ps[0], decision, ps);
  assert.equal(ps[0].balance, 50);
  assert.throws(() => e.action(ps[0], a("TAKE_INSURANCE", { seatId: 1 }), ps));
  assert.throws(() => e.action(ps[0], a("TAKE_INSURANCE", { seatId: 2 }), ps));
  assert.throws(() => e.action(ps[1], a("TAKE_INSURANCE", { seatId: 2 }), ps));
  assert.equal(e.seats[1].insurance!.decision, "PENDING");
  ps[0].connected = false;
  ps[0].connected = true;
  assert.equal(e.state().seats![0].insurance!.decision, "TAKEN");
  assert.equal(e.phase, "INSURANCE");
  e.action(ps[0], a("DECLINE_INSURANCE", { seatId: 2 }), ps);
  e.action(ps[1], a("DECLINE_INSURANCE", { seatId: 3 }), ps);
  while (e.phase === "PLAYER_TURN") {
    const t = e.turn!;
    e.action(
      ps.find((p) => p.id === t.playerId)!,
      a("STAND", { seatId: t.seatId, hand: t.hand }),
      ps,
    );
  }
  finish(e, ps);
  assert.equal(e.seats[0].insurance!.returned, 150);
  assert.equal(e.seats[1].insurance!.amount, 0);
});
test("concurrent insurance reservations cannot exceed common balance, timeout rejects late subscription", async () => {
  const e = new BlackjackEngine(),
    p = player("a", 250);
  for (const seatId of [1, 2]) e.action(p, a("TAKE_SEAT", { seatId }), [p]);
  e.start([p]);
  rig(e, ["10", "10", "A", "8", "8"]);
  for (const seatId of [1, 2])
    e.action(p, a("BET_ON_SEAT", { seatId, amount: 100 }), [p]);
  const room = new Room("ABC234", "blackjack", p.id, e);
  const out = await Promise.allSettled(
    [1, 2].map((seatId) =>
      room.run(() => e.action(p, a("TAKE_INSURANCE", { seatId }), [p])),
    ),
  );
  assert.equal(out.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(p.balance, 0);
  assert.equal(p.insuranceEscrow, 50);
  e.deadline = Date.now() - 1;
  assert.throws(() => e.action(p, a("DECLINE_INSURANCE", { seatId: 2 }), [p]));
  e.tick([p], Date.now());
  assert.equal(e.seats[1].insurance!.decision, "DECLINED");
});
test("splits and doubles never create new insurance or change its original half stake", () => {
  const { e, p } = begin(["8", "A", "8", "3", "2", "10", "K"]);
  e.action(p, a("TAKE_INSURANCE", { seatId: 1 }), [p]);
  e.action(p, a("SPLIT"), [p]);
  assert.equal(e.seats[0].hands.length, 2);
  assert.equal(e.seats[0].insurance!.amount, 50);
  assert.throws(() => e.action(p, a("TAKE_INSURANCE", { seatId: 1 }), [p]));
  e.action(p, a("DOUBLE"), [p]);
  e.action(p, a("STAND"), [p]);
  finish(e, [p]);
  assert.equal(p.balance, 9800);
  assert.equal(e.seats[0].insurance!.returned, 150);
});
