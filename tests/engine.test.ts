import { autoDealForRulesTests } from './helpers/rules-round.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Shoe,
  score,
  natural,
  shuffle,
} from "../apps/server/src/games/blackjack/Shoe.js";
import { BlackjackEngine } from "../apps/server/src/games/blackjack/BlackjackEngine.js";
import { Room } from "../apps/server/src/rooms/Room.js";
import type { Card, Player, Action } from "../packages/shared/types.js";
const cards = (...ranks: string[]): Card[] =>
  ranks.map((rank, i) => ({ rank, suit: "♠", id: String(i) }));
const player = (id = "p"): Player => ({
  id,
  name: id,
  balance: 10000,
  ready: true,
  connected: true,
  bet: 0,
  hands: [],
  stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
});
const action = (type: Action["type"], amount?: number): Action => ({
  type,
  amount,
  requestId: crypto.randomUUID(),
});
function rig(e: BlackjackEngine, ...ranks: string[]) {
  autoDealForRulesTests(e);
  const queue = cards(...ranks);
  e.shoe.draw = () => {
    const c = queue.shift();
    assert.ok(c, "deterministic shoe exhausted");
    return c;
  };
}
function decline(e: BlackjackEngine, ps: Player[]) {
  if (e.phase !== "INSURANCE") return;
  for (const seat of e.seats)
    if (seat.insurance?.decision === "PENDING")
      e.action(
        ps.find((p) => p.id === seat.playerId)!,
        {
          type: "DECLINE_INSURANCE",
          seatId: seat.id,
          requestId: crypto.randomUUID(),
        },
        ps,
      );
}
function dealer(e: BlackjackEngine, p: Player[]) {
  decline(e, p);
  for (let i = 0; i < 30 && e.phase === "DEALER_TURN"; i++)
    e.tick(p, Date.now() + 999999 + i * 1000);
  assert.equal(e.phase, "ROUND_END");
}
test("8 decks: 416 unique physical cards, eight copies of each face", () => {
  const s = new Shoe();
  const all = Array.from({ length: 416 }, () => s.draw());
  assert.equal(new Set(all.map((c) => c.id)).size, 416);
  assert.equal(all.filter((c) => c.rank === "A" && c.suit === "♠").length, 8);
  assert.throws(() => s.draw());
  s.reset();
  assert.equal(s.remaining, 416);
});
test("Fisher Yates preserves permutation with bounded random calls", () => {
  const bounds: number[] = [];
  assert.deepEqual(
    shuffle([1, 2, 3], (m) => {
      bounds.push(m);
      return 0;
    }),
    [2, 3, 1],
  );
  assert.deepEqual(bounds, [3, 2]);
});
test("aces, soft total, blackjack and bust", () => {
  assert.deepEqual(score(cards("A", "6")), { total: 17, soft: true });
  assert.deepEqual(score(cards("A", "A", "9")), { total: 21, soft: true });
  assert.equal(score(cards("A", "9", "8")).total, 18);
  assert.equal(score(cards("K", "Q", "2")).total, 22);
  assert.ok(natural(cards("A", "K")));
  assert.ok(!natural(cards("A", "K"), true));
});
test("ENHC dealer has exactly one card until players finish", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, "10", "A", "6", "K");
  e.start([p]);
  e.action(p, action("BET", 100), [p]);
  decline(e, [p]);
  assert.equal(e.dealer.length, 1);
  assert.equal(e.phase, "PLAYER_TURN");
  e.action(p, action("STAND"), [p]);
  assert.equal(e.dealer.length, 1);
  assert.equal(e.phase, "DEALER_TURN");
  dealer(e, [p]);
  assert.equal(p.balance, 9900);
  assert.equal(p.hands[0].result, "DEALER BLACKJACK");
});
test("ENHC double loses entire increased wager against dealer blackjack", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, "5", "A", "6", "10", "K");
  e.start([p]);
  e.action(p, action("BET", 100), [p]);
  decline(e, [p]);
  e.action(p, action("DOUBLE"), [p]);
  dealer(e, [p]);
  assert.equal(p.balance, 9800);
  assert.equal(p.hands[0].bet, 200);
});
test("split and double, dealer blackjack loses all split wagers", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, "8", "A", "8", "3", "2", "10", "K");
  e.start([p]);
  e.action(p, action("BET", 100), [p]);
  decline(e, [p]);
  e.action(p, action("SPLIT"), [p]);
  assert.equal(p.hands.length, 2);
  e.action(p, action("DOUBLE"), [p]);
  e.action(p, action("STAND"), [p]);
  dealer(e, [p]);
  assert.equal(p.balance, 9700);
});
test("natural pays 3:2, natural pushes dealer blackjack", () => {
  for (const up of ["9", "A"]) {
    const e = new BlackjackEngine(),
      p = player();
    rig(e, "A", up, "K", "K");
    e.start([p]);
    e.action(p, action("BET", 100), [p]);
    decline(e, [p]);
    dealer(e, [p]);
    assert.equal(p.balance, up === "9" ? 10150 : 10000);
  }
});
test("push, player bust and dealer bust settlement", () => {
  for (const [ranks, move, expected] of [
    [["10", "10", "8", "8"], "STAND", 10000],
    [["10", "9", "8", "9", "8"], "HIT", 9900],
    [["10", "6", "8", "10", "10"], "STAND", 10100],
  ] as const) {
    const e = new BlackjackEngine(),
      p = player();
    rig(e, ...ranks);
    e.start([p]);
    e.action(p, action("BET", 100), [p]);
    decline(e, [p]);
    e.action(p, action(move), [p]);
    dealer(e, [p]);
    assert.equal(p.balance, expected);
  }
});
test("split aces receive one card, split 21 is not natural", () => {
  const e = new BlackjackEngine(),
    p = player();
  rig(e, "A", "10", "A", "K", "K", "7");
  e.start([p]);
  e.action(p, action("BET", 100), [p]);
  decline(e, [p]);
  e.action(p, action("SPLIT"), [p]);
  assert.equal(e.phase, "DEALER_TURN");
  dealer(e, [p]);
  assert.equal(p.balance, 10200);
});
test("soft 17 configurable", () => {
  for (const hit of [false, true]) {
    const e = new BlackjackEngine();
    e.rules.hitSoft17 = hit;
    const p = player();
    rig(e, "10", "A", "8", "6", "2");
    e.start([p]);
    e.action(p, action("BET", 100), [p]);
    decline(e, [p]);
    e.action(p, action("STAND"), [p]);
    dealer(e, [p]);
    assert.equal(e.dealer.length, hit ? 3 : 2);
  }
});
test("timer stands, ready participants skip observers, reshuffle only between rounds", () => {
  const e = new BlackjackEngine(),
    p = player(),
    q = player("q");
  e.start([p, q]);
  e.action(p, action("BET", 100), [p, q]);
  assert.equal(e.tick([p, q], Date.now() + 999999), false);
  e.action(p, action("READY"), [p, q]);
  e.start([p, q]);
  e.tick([p, q], e.dealing!.endsAt);
  decline(e, [p, q]);
  assert.equal(q.hands.length, 0);
  while (e.phase === "PLAYER_TURN") e.tick([p, q], Date.now() + 999999);
  dealer(e, [p, q]);
  while (e.shoe.remaining > 80) e.shoe.draw();
  assert.equal(e.shoe.remaining, 80);
  p.ready = q.ready = true;
  e.start([p, q]);
  assert.equal(e.shoe.remaining, 416);
});
test("insufficient balance, odd wager, invalid split and actions rejected", () => {
  const e = new BlackjackEngine(),
    p = player();
  e.start([p]);
  assert.throws(() => e.action(p, action("BET", 101), [p]));
  assert.throws(() => e.action(p, action("BET", 10002), [p]));
  rig(e, "5", "9", "6");
  e.action(p, action("BET", 100), [p]);
  decline(e, [p]);
  assert.throws(() => e.action(p, action("SPLIT"), [p]));
  const q = player("q");
  assert.throws(() => e.action(q, action("HIT"), [p, q]));
});
test("room operations serialized and failure does not poison queue", async () => {
  const r = new Room("ABC234", "blackjack", "p", new BlackjackEngine());
  const trace: number[] = [];
  await Promise.all([
    r.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      trace.push(1);
    }),
    r.run(() => trace.push(2)),
  ]);
  assert.deepEqual(trace, [1, 2]);
  await assert.rejects(
    r.run(() => {
      throw Error("fail");
    }),
  );
  assert.equal(await r.run(() => 3), 3);
});
test("split limit, double after split disabled, and immutable shoe during a round", () => {
  const e = new BlackjackEngine(),
    p = player();
  e.rules.maxSplits = 1;
  e.rules.doubleAfterSplit = false;
  rig(e, "8", "9", "8", "8", "8");
  e.start([p]);
  e.action(p, action("BET", 100), [p]);
  decline(e, [p]);
  e.action(p, action("SPLIT"), [p]);
  assert.throws(() => e.action(p, action("SPLIT"), [p]));
  assert.throws(() => e.action(p, action("DOUBLE"), [p]));
});
test("200 full six-player rounds preserve valid card supply and bankroll settlement", () => {
  const e = new BlackjackEngine();
  autoDealForRulesTests(e);
  const ps = Array.from({ length: 6 }, (_, i) => player(String(i)));
  for (let round = 0; round < 200; round++) {
    for (const p of ps) {
      p.ready = true;
      p.balance = 10000;
    }
    e.start(ps);
    const remaining = e.shoe.remaining;
    for (const p of ps) e.action(p, action("BET", 100), ps);
    decline(e, ps);
    const seen = new Set<string>();
    let steps = 0;
    while (e.phase === "PLAYER_TURN") {
      assert.ok(++steps < 300);
      const p = ps.find((p) => p.id === e.turn!.playerId)!;
      const h = p.hands[e.turn!.hand];
      if (
        h.cards.length === 2 &&
        h.cards[0].rank === h.cards[1].rank &&
        p.hands.length <= e.rules.maxSplits
      )
        e.action(p, action("SPLIT"), ps);
      else e.action(p, action(score(h.cards).total < 17 ? "HIT" : "STAND"), ps);
    }
    dealer(e, ps);
    for (const c of [
      ...e.dealer,
      ...ps.flatMap((p) => p.hands.flatMap((h) => h.cards)),
    ]) {
      assert.ok(!seen.has(c.id));
      seen.add(c.id);
    }
    assert.equal(remaining - e.shoe.remaining, seen.size);
    for (const p of ps) {
      assert.equal(
        p.balance,
        10000 + p.hands.reduce((n, h) => n + h.profit!, 0),
      );
      assert.ok(Number.isSafeInteger(p.balance));
    }
  }
});
