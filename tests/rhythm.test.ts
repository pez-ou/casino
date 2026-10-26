import { test } from "node:test";
import assert from "node:assert/strict";
import { BlackjackEngine } from "../apps/server/src/games/blackjack/BlackjackEngine.js";
import { Room } from "../apps/server/src/rooms/Room.js";
import type { Player, Action } from "../packages/shared/types.js";
const p = (id: string, balance = 10000): Player => ({
  id,
  name: id,
  balance,
  connected: true,
  ready: false,
  hands: [],
  bet: 0,
  stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
});
const a = (type: Action["type"], extra: Partial<Action> = {}): Action => ({
  type,
  requestId: crypto.randomUUID(),
  ...extra,
});
function setup(
  owners: string[],
  ranks: string[],
  balances: Record<string, number> = {},
) {
  const e = new BlackjackEngine(),
    ps = [...new Set(owners)].map((id) => p(id, balances[id]));
  let drawn = 0;
  e.shoe.draw = () => {
    assert.ok(drawn < ranks.length, "shoe unexpectedly advanced");
    return { id: `card-${drawn}`, rank: ranks[drawn++], suit: "♠" };
  };
  owners.forEach((id, i) =>
    e.action(
      ps.find((p) => p.id === id)!,
      a("TAKE_SEAT", { seatId: i + 1 }),
      ps,
    ),
  );
  e.start(ps);
  return { e, ps, draws: () => drawn };
}
function distribute(e: BlackjackEngine, ps: Player[]) {
  for (const player of ps.filter((p) => p.bet))
    e.action(player, a("READY"), ps);
  e.start(ps);
  e.tick(ps, e.dealing!.endsAt);
}
function wager(e: BlackjackEngine, ps: Player[], seatId: number, amount = 100) {
  e.action(
    ps.find((p) => p.id === e.seats[seatId - 1].playerId)!,
    a("BET_ON_SEAT", { seatId, amount }),
    ps,
  );
}
function turn(e: BlackjackEngine, ps: Player[], type: Action["type"]) {
  const t = e.turn!;
  e.action(
    ps.find((p) => p.id === t.playerId)!,
    a(type, { seatId: t.seatId, hand: t.hand }),
    ps,
  );
}
test("untimed editable betting: readiness locks, cancel unlocks, observers do not block", () => {
  const { e, ps, draws } = setup(["a", "b"], ["10", "9", "6", "6", "7"]);
  const observer = p("observer");
  ps.push(observer);
  wager(e, ps, 1);
  assert.equal(e.phase, "BETTING");
  assert.equal(e.deadline, null);
  assert.equal(e.tick(ps, Date.now() + 1e9), false);
  assert.equal(draws(), 0);
  assert.throws(() => e.start(ps));
  e.action(ps[0], a("READY"), ps);
  assert.throws(() => wager(e, ps, 1, 200));
  e.action(ps[0], a("CANCEL_READY"), ps);
  wager(e, ps, 1, 200);
  assert.equal(ps[0].balance, 9800);
  assert.equal(ps[0].bet, 200);
  e.action(ps[0], a("READY"), ps);
  e.start(ps);
  assert.equal(e.phase, "DEALING");
  assert.equal(e.dealing!.total, 3);
});
test("server releases seven seats in order, one dealer card and no future card on reconnect", () => {
  const { e, ps, draws } = setup(
    ["a", "a", "b", "b", "c", "c", "c"],
    [
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "A",
      "6",
      "7",
      "8",
      "9",
      "10",
      "6",
      "7",
    ],
  );
  for (let seat = 1; seat <= 7; seat++) wager(e, ps, seat);
  ps.forEach((player) => e.action(player, a("READY"), ps));
  e.start(ps);
  const d = e.dealing!;
  assert.equal(d.total, 15);
  assert.equal(draws(), 0);
  assert.equal(e.tick(ps, d.startedAt - 1), false);
  const expected = [1, 2, 3, 4, 5, 6, 7, null, 1, 2, 3, 4, 5, 6, 7];
  const room = new Room("ABC234", "blackjack", "a", e);
  room.members = ps.map((player, i) => ({
    key: String(i),
    player,
    seen: 0,
    requests: new Map(),
  }));
  for (let seq = 0; seq < 15; seq++) {
    e.tick(ps, d.startedAt + seq * d.cardMs);
    assert.equal(draws(), seq + 1);
    assert.deepEqual(
      d.events.map((event) => event.seatId),
      expected.slice(0, seq + 1),
    );
    const snapshot = room.state();
    assert.equal(snapshot.game.dealing!.events.length, seq + 1);
    assert.equal(
      snapshot.players
        .flatMap((p) => p.hands)
        .reduce((n, h) => n + h.cards.length, 0) + snapshot.game.dealer.length,
      seq + 1,
    );
    assert.ok(snapshot.game.dealer.length <= 1);
    assert.equal(e.phase, "DEALING");
  }
  e.tick(ps, d.endsAt);
  assert.equal(e.phase, "INSURANCE");
  assert.equal(e.dealer.length, 1);
  assert.equal(e.deadline, d.endsAt + 10000);
  assert.equal(d.events[14].round, e.round);
  assert.equal(new Set(d.events.map((v) => v.seq)).size, 15);
});
test("planned Stand modifies and cancels without touching the shoe, then executes once", () => {
  const { e, ps, draws } = setup(
    ["a", "b"],
    ["10", "9", "6", "6", "7", "10", "4"],
  );
  wager(e, ps, 1);
  wager(e, ps, 2);
  distribute(e, ps);
  const h = ps[1].hands[0],
    plan = a("PLAN_ACTION", { seatId: 2, handId: h.id, decision: "HIT" });
  assert.throws(() => e.action(ps[1], a("HIT", { seatId: 2, hand: 0 }), ps));
  assert.throws(() => e.action(ps[0], plan, ps));
  e.action(ps[1], plan, ps);
  e.action(ps[1], plan, ps);
  assert.equal(draws(), 5);
  e.action(
    ps[1],
    a("PLAN_ACTION", { seatId: 2, handId: h.id, decision: "STAND" }),
    ps,
  );
  e.action(ps[1], a("CANCEL_PLAN", { seatId: 2, handId: h.id }), ps);
  assert.equal(h.plannedAction, undefined);
  e.action(
    ps[1],
    a("PLAN_ACTION", { seatId: 2, handId: h.id, decision: "STAND" }),
    ps,
  );
  const stand = a("STAND", { seatId: 1, hand: 0 });
  e.action(ps[0], stand, ps);
  e.action(ps[0], stand, ps);
  assert.equal(h.status, "STAND");
  assert.equal(h.plannedAction, undefined);
  assert.equal(draws(), 5);
  assert.equal(e.phase, "DEALER_TURN");
});
test("planned Hit is a single draw and leaves a fresh manual decision", () => {
  const { e, ps, draws } = setup(["a", "b"], ["10", "9", "6", "6", "7", "2"]);
  wager(e, ps, 1);
  wager(e, ps, 2);
  distribute(e, ps);
  const h = ps[1].hands[0];
  e.action(
    ps[1],
    a("PLAN_ACTION", { seatId: 2, handId: h.id, decision: "HIT" }),
    ps,
  );
  assert.equal(draws(), 5);
  turn(e, ps, "STAND");
  assert.equal(draws(), 6);
  assert.equal(h.cards.length, 3);
  assert.equal(h.plannedAction, undefined);
  assert.equal(e.turn?.playerId, "b");
  assert.equal(h.status, "PLAYING");
  assert.equal(e.tick(ps, Date.now() + 1000), false);
  assert.equal(draws(), 6);
});
test("planned Double is revalidated after the owner spends its remaining balance", () => {
  const { e, ps, draws } = setup(["a", "a"], ["5", "6", "9", "6", "7", "2"], {
    a: 300,
  });
  wager(e, ps, 1);
  wager(e, ps, 2);
  distribute(e, ps);
  const h = ps[0].hands[1];
  e.action(
    ps[0],
    a("PLAN_ACTION", { seatId: 2, handId: h.id, decision: "DOUBLE" }),
    ps,
  );
  turn(e, ps, "DOUBLE");
  assert.equal(draws(), 6);
  assert.equal(ps[0].balance, 0);
  assert.equal(h.cards.length, 2);
  assert.equal(h.bet, 100);
  assert.equal(h.plannedAction, undefined);
  assert.match(h.plannedError!, /Double indisponible/);
  assert.equal(e.turn?.seatId, 2);
});
test("planned Split assigns independent ids and queued other hands survive index shifts", () => {
  const { e, ps } = setup(
    ["a", "b", "b"],
    ["10", "8", "5", "6", "6", "8", "6", "2", "3", "10"],
  );
  [1, 2, 3].forEach((seat) => wager(e, ps, seat));
  distribute(e, ps);
  const pair = ps[1].hands[0],
    other = ps[1].hands[1];
  e.action(
    ps[1],
    a("PLAN_ACTION", { seatId: 2, handId: pair.id, decision: "SPLIT" }),
    ps,
  );
  e.action(
    ps[1],
    a("PLAN_ACTION", { seatId: 3, handId: other.id, decision: "STAND" }),
    ps,
  );
  turn(e, ps, "STAND");
  assert.equal(e.seats[1].hands.length, 2);
  assert.notEqual(e.seats[1].hands[0].id, e.seats[1].hands[1].id);
  assert.equal(e.seats[1].hands[1].plannedAction, undefined);
  turn(e, ps, "STAND");
  turn(e, ps, "STAND");
  assert.equal(other.status, "STAND");
  assert.equal(other.plannedAction, undefined);
  assert.equal(e.phase, "DEALER_TURN");
});
test("editable side wagers, duplicate requests, disconnect and removal refund exactly once", () => {
  const { e, ps } = setup(["a", "b"], ["10"]);
  const bet = a("BET_ON_SEAT", {
    seatId: 1,
    amount: 100,
    sideBets: { PP: 25, "21+3": 50 },
  });
  e.action(ps[0], bet, ps);
  e.action(ps[0], bet, ps);
  assert.equal(ps[0].balance, 9825);
  e.action(
    ps[0],
    a("BET_ON_SEAT", {
      seatId: 1,
      amount: 200,
      sideBets: { PP: 10, "21+3": 5 },
    }),
    ps,
  );
  assert.equal(ps[0].balance, 9785);
  assert.equal(ps[0].sideBetEscrow, 15);
  e.action(ps[0], a("READY"), ps);
  ps[0].connected = false;
  e.disconnect(ps[0]);
  assert.equal(ps[0].balance, 10000);
  assert.equal(ps[0].bet, 0);
  assert.equal(ps[0].ready, false);
  wager(e, ps, 2);
  e.action(ps[1], a("READY"), ps);
  e.start(ps);
  assert.equal(e.dealing!.total, 3);
  const f = setup(["x"], ["10"]);
  f.e.action(
    f.ps[0],
    a("BET_ON_SEAT", { seatId: 1, amount: 100, sideBets: { PP: 20 } }),
    f.ps,
  );
  f.e.removePlayer(f.ps[0]);
  f.e.removePlayer(f.ps[0]);
  assert.equal(f.ps[0].balance, 10000);
});
