import { test } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import type { RoomState, Action } from "../packages/shared/types.js";
const url = process.env.SERVER_URL;
async function client(token?: string) {
  const socket = io(url!, {
    auth: { token },
    transports: ["websocket"],
    extraHeaders: {
      Origin: process.env.PUBLIC_ORIGIN || "http://localhost:8097",
    },
  });
  let state: RoomState | undefined;
  let nextActionAt = 0;
  socket.on("room_state", (s) => (state = s));
  const session = await new Promise<{ token: string; playerId: string }>(
    (resolve, reject) => {
      socket.on("session", resolve);
      socket.on("connect_error", (error) => { socket.disconnect(); reject(error); });
    },
  );
  return {
    socket,
    session,
    get state() {
      return state;
    },
    async send(type: Action["type"], extra: Partial<Action> = {}) {
      const scheduled = Math.max(Date.now(), nextActionAt);
      nextActionAt = scheduled + 125;
      await new Promise((resolve) =>
        setTimeout(resolve, scheduled - Date.now()),
      );
      return new Promise<any>((resolve, reject) =>
        socket.timeout(5000).emit(
          "action",
          {
            requestId: randomUUID(),
            type,
            version: state?.version,
            round: state?.game.round,
            ...extra,
          },
          (e: unknown, r: unknown) => (e ? reject(e) : resolve(r)),
        ),
      );
    },
  };
}
async function launch(
  a: Awaited<ReturnType<typeof client>>,
  b: Awaited<ReturnType<typeof client>>,
) {
  await a.send("READY");
  await b.send("READY");
  await until(() => a.state!.version === b.state!.version);
  assert.equal((await a.send("START")).ok, true);
  await until(() => a.state!.game.phase !== "DEALING");
}
async function declineInsurance(clients: Awaited<ReturnType<typeof client>>[]) {
  for (const c of clients)
    for (const seat of c.state?.game.seats ?? [])
      if (
        c.state?.game.phase === "INSURANCE" &&
        seat.playerId === c.session.playerId &&
        seat.insurance?.decision === "PENDING"
      )
        assert.equal(
          (await c.send("DECLINE_INSURANCE", { seatId: seat.id })).ok,
          true,
        );
}
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error("Timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
}
test(
  "live rooms: idempotence, concurrent actions, ENHC, reconnection, full round, leak protection",
  { skip: !url, timeout: 45000 },
  async () => {
    const a = await client(),
      b = await client();
    let replacement: Awaited<ReturnType<typeof client>> | undefined;
    try {
      assert.equal((await a.send("CREATE", { name: "Alice" })).ok, true);
      const code = a.state!.code;
      assert.equal((await b.send("JOIN", { name: "Bob", code })).ok, true);
      await until(() => a.state!.players.length === 2);
      await a.send("START");
      await until(() => a.state!.version === b.state!.version);
      const requestId = randomUUID();
      assert.equal((await a.send("BET", { amount: 100, requestId })).ok, true);
      const v = a.state!.version;
      assert.equal((await a.send("BET", { amount: 100, requestId })).ok, true);
      assert.equal(a.state!.version, v);
      assert.equal(
        a.state!.players.find((p) => p.id === a.session.playerId)!.balance,
        9900,
      );
      await until(() => a.state!.version === b.state!.version);
      await b.send("BET", { amount: 100 });
      await launch(a, b);
      await until(() => a.state!.version === b.state!.version);
      assert.equal(a.state!.game.dealer.length, 1);
      assert.ok(!JSON.stringify(a.state).includes("token"));
      assert.ok(!("cards" in a.state!.game.shoe));
      a.socket.disconnect();
      replacement = await client(a.session.token);
      await until(() => replacement!.state?.code === code);
      assert.equal(
        replacement.state!.players.find((p) => p.id === a.session.playerId)!
          .balance,
        9900,
      );
      await until(() => replacement!.state!.version === b.state!.version);
      await declineInsurance([replacement, b]);
      await until(() => replacement!.state!.version === b.state!.version);
      let concurrentChecked = false;
      while (replacement.state!.game.phase === "PLAYER_TURN") {
        const current =
          replacement.state!.game.turn!.playerId === a.session.playerId
            ? replacement
            : b;
        const version = current.state!.version;
        if (!concurrentChecked) {
          const responses = await Promise.all([
            current.send("STAND", { version }),
            current.send("STAND", { version }),
          ]);
          assert.equal(responses.filter((r) => r.ok).length, 1);
          concurrentChecked = true;
        } else await current.send("STAND");
        await new Promise((r) => setTimeout(r, 30));
      }
      await until(() => replacement!.state!.game.phase === "ROUND_END");
      assert.ok(replacement.state!.game.dealer.length >= 2);
      assert.equal(
        replacement.state!.players.every((p) =>
          p.hands.every((h) => !!h.result),
        ),
        true,
      );
      assert.equal((await replacement.send("HIT")).ok, false);
      assert.equal((await replacement.send("START")).ok, true);
      assert.equal(replacement.state!.game.round, 2);
    } finally {
      a.socket.disconnect();
      b.socket.disconnect();
      replacement?.socket.disconnect();
    }
  },
);
test(
  "second connection replaces first session and malformed payloads are rejected",
  { skip: !url, timeout: 15000 },
  async () => {
    const a = await client();
    let b: Awaited<ReturnType<typeof client>> | undefined;
    try {
      const replaced = new Promise((resolve) =>
        a.socket.once("replaced", resolve),
      );
      b = await client(a.session.token);
      await replaced;
      assert.equal(b.session.playerId, a.session.playerId);
      await until(() => !a.socket.connected);
      assert.equal(
        (await b.send("CREATE", { name: "<script>alert(1)</script>" })).ok,
        false,
      );
      const reply = await new Promise<any>((resolve) =>
        b!.socket.emit(
          "action",
          { requestId: randomUUID(), type: "READY", unexpected: "field" },
          resolve,
        ),
      );
      assert.equal(reply.ok, false);
    } finally {
      a.socket.disconnect();
      b?.socket.disconnect();
    }
  },
);

test(
  "V2 network: seven seats, ownership, concurrent claims, duplicate bets and reconnect",
  { skip: !url, timeout: 30000 },
  async () => {
    const a = await client(),
      b = await client();
    let back: Awaited<ReturnType<typeof client>> | undefined;
    try {
      assert.equal((await a.send("CREATE", { name: "Alice V2" })).ok, true);
      const code = a.state!.code;
      assert.equal((await b.send("JOIN", { name: "Bob V2", code })).ok, true);
      const claimed = await Promise.all([
        a.send("TAKE_SEAT", { seatId: 1 }),
        b.send("TAKE_SEAT", { seatId: 1 }),
      ]);
      assert.equal(claimed.filter((x) => x.ok).length, 1);
      await until(() => a.state!.version === b.state!.version);
      const first =
        a.state!.game.seats![0].playerId === a.session.playerId ? a : b;
      const other = first === a ? b : a;
      for (let seatId = 2; seatId <= 7; seatId++) {
        assert.equal(
          (await (seatId <= 3 ? first : other).send("TAKE_SEAT", { seatId }))
            .ok,
          true,
        );
        await new Promise((r) => setTimeout(r, 150));
      }
      assert.equal((await a.send("TAKE_SEAT", { seatId: 8 })).ok, false);
      await until(() => a.state!.version === b.state!.version);
      assert.equal((await a.send("START")).ok, true);
      await until(() => a.state!.version === b.state!.version);
      const requestId = randomUUID();
      const replies = await Promise.all([
        first.send("BET_ON_SEAT", { seatId: 1, amount: 100, requestId }),
        first.send("BET_ON_SEAT", { seatId: 1, amount: 100, requestId }),
      ]);
      assert.ok(replies.every((r) => r.ok));
      assert.equal(
        first.state!.players.find((p) => p.id === first.session.playerId)!
          .balance,
        9900,
      );
      assert.equal(
        (await other.send("BET_ON_SEAT", { seatId: 2, amount: 100 })).ok,
        false,
      );
      for (let seatId = 2; seatId <= 7; seatId++) {
        assert.equal(
          (
            await (seatId <= 3 ? first : other).send("BET_ON_SEAT", {
              seatId,
              amount: seatId * 100,
            })
          ).ok,
          true,
        );
        await new Promise((r) => setTimeout(r, 150));
      }
      await launch(a, b);
      first.socket.disconnect();
      back = await client(first.session.token);
      await until(() => back!.state?.code === code);
      assert.equal(
        back.state!.game.seats!.filter(
          (s) => s.playerId === first.session.playerId,
        ).length,
        3,
      );
      await declineInsurance([back, other]);
      while (back.state!.game.phase === "PLAYER_TURN") {
        await until(() => back!.state!.version === other.state!.version);
        const turn = back.state!.game.turn!;
        const who = turn.playerId === first.session.playerId ? back : other;
        assert.equal(
          (await who.send("STAND", { seatId: turn.seatId, hand: turn.hand }))
            .ok,
          true,
        );
        await new Promise((r) => setTimeout(r, 30));
      }
      await until(() => back!.state!.game.phase === "ROUND_END");
      assert.ok(
        back.state!.game.seats!.every((s) => s.hands.every((h) => h.result)),
      );
    } finally {
      a.socket.disconnect();
      b.socket.disconnect();
      back?.socket.disconnect();
    }
  },
);
test(
  "V2 roulette network: concurrent own bets, no early result, deadline lock, reconnect during spin and same outcome",
  { skip: !url, timeout: 70000 },
  async () => {
    const a = await client(),
      b = await client();
    let back: Awaited<ReturnType<typeof client>> | undefined;
    try {
      assert.equal(
        (
          await a.send("CREATE", {
            name: "Roulette Alice",
            gameType: "roulette",
          })
        ).ok,
        true,
      );
      const code = a.state!.code;
      assert.equal(
        (await b.send("JOIN", { name: "Roulette Bob", code })).ok,
        true,
      );
      await until(() => a.state!.version === b.state!.version);
      assert.equal(a.state!.game.roulette!.winningNumber, undefined);
      const requestId = randomUUID();
      const replies = await Promise.all([
        a.send("ROULETTE_BET", {
          betType: "STRAIGHT",
          numbers: [0],
          amount: 100,
          requestId,
        }),
        a.send("ROULETTE_BET", {
          betType: "STRAIGHT",
          numbers: [0],
          amount: 100,
          requestId,
        }),
        b.send("ROULETTE_BET", {
          betType: "RED",
          numbers: [
            1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
          ],
          amount: 25,
        }),
      ]);
      assert.ok(replies.every((r) => r.ok));
      await until(() => a.state!.version === b.state!.version);
      assert.equal(a.state!.game.roulette!.bets.length, 2);
      assert.equal(
        a.state!.players.find((p) => p.id === a.session.playerId)!.balance,
        9900,
      );
      // A client's attempted foreign owner field is rejected by strict schema.
      const forged = await new Promise<any>((resolve) =>
        a.socket.emit(
          "action",
          {
            requestId: randomUUID(),
            type: "ROULETTE_BET",
            round: a.state!.game.round,
            betType: "STRAIGHT",
            numbers: [1],
            amount: 1,
            playerId: b.session.playerId,
          },
          resolve,
        ),
      );
      assert.equal(forged.ok, false);
      const close = a.state!.game.roulette!.bettingEndsAt;
      await until(() => a.state!.game.phase === "SPINNING", 40000);
      assert.equal(a.state!.game.roulette!.spinStartedAt, close);
      assert.equal(
        (
          await a.send("ROULETTE_BET", {
            betType: "STRAIGHT",
            numbers: [0],
            amount: 100,
          })
        ).ok,
        false,
      );
      a.socket.disconnect();
      back = await client(a.session.token);
      await until(() => back!.state?.code === code);
      await until(() => back!.state!.version === b.state!.version);
      assert.equal(
        back.state!.game.roulette!.winningNumber,
        b.state!.game.roulette!.winningNumber,
      );
      assert.equal(
        back.state!.game.roulette!.spinEndsAt,
        b.state!.game.roulette!.spinEndsAt,
      );
      await until(() => back!.state!.game.phase === "RESULT", 15000);
      await until(() => back!.state!.version === b.state!.version);
      const r = back.state!.game.roulette!;
      assert.equal(r.history[0], r.winningNumber);
      assert.equal(r.results[a.session.playerId].wager, 100);
      assert.equal(r.results[b.session.playerId].wager, 25);
      assert.ok(back.state!.players.every((p) => p.balance >= 0));
      await until(() => back!.state!.game.phase === "BETTING", 10000);
      assert.equal(back.state!.game.round, 2);
      assert.equal(back.state!.game.roulette!.winningNumber, undefined);
      assert.equal((await back.send("REPEAT_BETS")).ok, true);
      assert.equal(back.state!.game.roulette!.bets.length, 1);
      assert.equal((await back.send("CLEAR_BETS")).ok, true);
    } finally {
      a.socket.disconnect();
      b.socket.disconnect();
      back?.socket.disconnect();
    }
  },
);
test(
  "network security keeps the twelve actions per second limit",
  { skip: !url, timeout: 15000 },
  async () => {
    const a = await client();
    try {
      const started = Date.now(),
        responses: any[] = [];
      for (let i = 0; i < 13; i++)
        responses.push(
          await new Promise((resolve) =>
            a.socket.emit(
              "action",
              { requestId: randomUUID(), type: "READY", version: 0 },
              resolve,
            ),
          ),
        );
      assert.ok(
        Date.now() - started < 1000,
        "burst must stay in one rate-limit window",
      );
      assert.ok(responses.slice(0, 12).every((r) => r.error === "Aucun salon"));
      assert.equal(responses[12].error, "Trop de requêtes");
    } finally {
      a.socket.disconnect();
    }
  },
);
test(
  "insurance network: concurrent seats, no peek, duplicate reserve and reconnect during decision phase",
  { skip: !process.env.INSURANCE_FIXTURE, timeout: 25000 },
  async () => {
    const a = await client(),
      b = await client();
    let back: Awaited<ReturnType<typeof client>> | undefined;
    try {
      assert.equal(
        (await a.send("CREATE", { name: "Assurance Alice" })).ok,
        true,
      );
      const code = a.state!.code;
      assert.equal(
        (await b.send("JOIN", { name: "Assurance Bob", code })).ok,
        true,
      );
      await a.send("TAKE_SEAT", { seatId: 1 });
      await b.send("TAKE_SEAT", { seatId: 2 });
      await until(() => a.state!.version === b.state!.version);
      await a.send("START");
      await until(() => a.state!.version === b.state!.version);
      await Promise.all([
        a.send("BET_ON_SEAT", { seatId: 1, amount: 100 }),
        b.send("BET_ON_SEAT", { seatId: 2, amount: 200 }),
      ]);
      await launch(a, b);
      await until(() => a.state!.game.phase === "INSURANCE");
      assert.equal(a.state!.game.dealer.length, 1);
      assert.ok(a.state!.game.deadline! - a.state!.serverTime <= 10000);
      assert.equal((await a.send("HIT", { seatId: 1, hand: 0 })).ok, false);
      const requestId = randomUUID();
      assert.equal(
        (await a.send("TAKE_INSURANCE", { seatId: 1, requestId })).ok,
        true,
      );
      assert.equal(
        (await a.send("TAKE_INSURANCE", { seatId: 1, requestId })).ok,
        true,
      );
      assert.equal((await a.send("TAKE_INSURANCE", { seatId: 1 })).ok, false);
      assert.equal(
        a.state!.players.find((p) => p.id === a.session.playerId)!.balance,
        9850,
      );
      a.socket.disconnect();
      back = await client(a.session.token);
      await until(() => back!.state?.code === code);
      assert.equal(back.state!.game.phase, "INSURANCE");
      assert.equal(back.state!.game.seats![0].insurance!.amount, 50);
      assert.equal(back.state!.game.dealer.length, 1);
      assert.equal((await b.send("TAKE_INSURANCE", { seatId: 1 })).ok, false);
      assert.equal((await b.send("DECLINE_INSURANCE", { seatId: 2 })).ok, true);
      await until(() => back!.state!.game.phase === "PLAYER_TURN");
      assert.equal(back.state!.game.dealer.length, 1);
      while (back.state!.game.phase === "PLAYER_TURN") {
        await until(() => back!.state!.version === b.state!.version);
        const t = back.state!.game.turn!,
          who = t.playerId === a.session.playerId ? back : b;
        assert.equal(
          (await who.send("STAND", { seatId: t.seatId, hand: t.hand })).ok,
          true,
        );
        await new Promise((r) => setTimeout(r, 30));
      }
      await until(() => back!.state!.game.phase === "ROUND_END");
      assert.equal(back.state!.game.dealer.length, 2);
      assert.equal(
        back.state!.players.find((p) => p.id === a.session.playerId)!.balance,
        10000,
      );
      assert.equal(
        back.state!.players.find((p) => p.id === b.session.playerId)!.balance,
        9800,
      );
      assert.equal(back.state!.game.seats![0].insurance!.returned, 150);
    } finally {
      a.socket.disconnect();
      b.socket.disconnect();
      back?.socket.disconnect();
    }
  },
);

test(
  "roulette network: unanimous acceleration, reconnect votes, owned move and locked requests",
  { skip: !url, timeout: 25000 },
  async () => {
    const a = await client(),
      b = await client();
    let back: Awaited<ReturnType<typeof client>> | undefined;
    try {
      assert.equal(
        (await a.send("CREATE", { name: "Vote Alice", gameType: "roulette" }))
          .ok,
        true,
      );
      const code = a.state!.code;
      assert.equal((await b.send("JOIN", { name: "Vote Bob", code })).ok, true);
      await until(() => a.state!.players.length === 2);
      const end = a.state!.game.deadline!;
      const betId = randomUUID();
      assert.equal(
        (
          await a.send("ROULETTE_BET", {
            requestId: betId,
            betType: "STRAIGHT",
            numbers: [17],
            amount: 25,
          })
        ).ok,
        true,
      );
      assert.equal(
        (await b.send("MOVE_BET", { betId, betType: "STRAIGHT", numbers: [0] }))
          .ok,
        false,
      );
      assert.equal(
        (await a.send("MOVE_BET", { betId, betType: "SPLIT", numbers: [1, 2] }))
          .ok,
        true,
      );
      assert.equal(
        a.state!.players.find((p) => p.id === a.session.playerId)!.balance,
        9975,
      );
      assert.deepEqual(a.state!.game.roulette!.bets[0].numbers, [1, 2]);
      const requestId = randomUUID();
      assert.equal((await a.send("ACCELERATE_ROUND", { requestId })).ok, true);
      assert.equal((await a.send("ACCELERATE_ROUND", { requestId })).ok, true);
      assert.equal(a.state!.game.deadline, end);
      back = await client(a.session.token);
      await until(() => back!.state?.code === code);
      assert.deepEqual(back.state!.game.roulette!.accelerationVotes, [
        a.session.playerId,
      ]);
      assert.equal((await b.send("ACCELERATE_ROUND")).ok, true);
      await until(() => back!.state!.game.deadline === b.state!.game.deadline);
      assert.ok(b.state!.game.deadline! < end);
      assert.ok(b.state!.game.deadline! - b.state!.serverTime <= 10000);
      assert.equal((await back.send("ACCELERATE_ROUND")).ok, false);
      assert.equal(b.state!.game.roulette!.winningNumber, undefined);
      await until(() => b.state!.game.phase !== "BETTING");
      assert.equal(
        (
          await back.send("MOVE_BET", {
            betId,
            betType: "STRAIGHT",
            numbers: [0],
          })
        ).ok,
        false,
      );
      assert.equal((await b.send("ACCELERATE_ROUND")).ok, false);
    } finally {
      a.socket.disconnect();
      b.socket.disconnect();
      back?.socket.disconnect();
    }
  },
);
