import { test } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import type { RoomState, Action } from "../packages/shared/types.js";
const url = process.env.SERVER_URL;
async function client(token?: string) {
  const socket = io(url!, {
    transports: ["websocket"],
    auth: { token },
    extraHeaders: {
      Origin: process.env.PUBLIC_ORIGIN || "http://localhost:8097",
    },
  });
  let state: RoomState | undefined;
  let exclusion: any;
  socket.on("room_state", (s) => (state = s));
  socket.on("room_excluded", (s) => (exclusion = s));
  const session = await new Promise<any>((resolve, reject) => {
    socket.on("session", resolve);
    socket.on("connect_error", reject);
  });
  return {
    socket,
    session,
    get state() {
      return state!;
    },
    get exclusion() {
      return exclusion;
    },
    async send(type: Action["type"], extra: Partial<Action> = {}) {
      await new Promise((r) => setTimeout(r, 140));
      return new Promise<any>((resolve) =>
        socket.emit(
          "action",
          {
            type,
            requestId: crypto.randomUUID(),
            round: state?.game.round,
            version: state?.version,
            ...extra,
          },
          resolve,
        ),
      );
    },
  };
}
async function until(check: () => boolean, ms = 20000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error("Network condition timed out");
    await new Promise((r) => setTimeout(r, 30));
  }
}
test(
  "live ready, ordered deal, reconnect, host exclusion, refunds and session ban",
  { skip: !url, timeout: 60000 },
  async () => {
    const a = await client(),
      b = await client(),
      observer = await client();
    let back: Awaited<ReturnType<typeof client>> | undefined;
    try {
      assert.equal((await a.send("CREATE", { name: "Rhythm host" })).ok, true);
      const code = a.state.code;
      assert.equal(
        (await b.send("JOIN", { code, name: "Rhythm guest" })).ok,
        true,
      );
      await observer.send("JOIN", { code, name: "Observer" });
      await a.send("TAKE_SEAT", { seatId: 1 });
      await b.send("TAKE_SEAT", { seatId: 2 });
      await a.send("START");
      assert.equal(a.state.game.deadline, null);
      await b.send("BET_ON_SEAT", {
        seatId: 2,
        amount: 100,
        sideBets: { PP: 5, "21+3": 10 },
      });
      assert.equal(
        (await b.send("KICK_PLAYER", { targetPlayerId: a.session.playerId }))
          .ok,
        false,
      );
      assert.equal(
        (await a.send("KICK_PLAYER", { targetPlayerId: a.session.playerId }))
          .ok,
        false,
      );
      await a.send("KICK_PLAYER", { targetPlayerId: b.session.playerId });
      await until(() => !!b.exclusion);
      assert.equal(b.exclusion.balance, 10000);
      assert.equal(a.state.game.seats![1].playerId, undefined);
      assert.equal(
        (await b.send("JOIN", { code, name: "Blocked guest" })).ok,
        false,
      );
      await a.send("BET_ON_SEAT", { seatId: 1, amount: 100 });
      await a.send("READY");
      assert.equal(
        (await a.send("BET_ON_SEAT", { seatId: 1, amount: 200 })).ok,
        false,
      );
      await a.send("CANCEL_READY");
      assert.equal(
        (await a.send("BET_ON_SEAT", { seatId: 1, amount: 200 })).ok,
        true,
      );
      await observer.send("TAKE_SEAT", { seatId: 3 });
      await observer.send("BET_ON_SEAT", { seatId: 3, amount: 100 });
      assert.equal((await a.send("START")).ok, false);
      await a.send("READY");
      await observer.send("READY");
      await a.send("START");
      assert.equal(a.state.game.phase, "DEALING");
      assert.equal(a.state.game.dealing!.events.length, 0);
      await a.send("KICK_PLAYER", {
        targetPlayerId: observer.session.playerId,
      });
      assert.equal(observer.exclusion.pending, true);
      const released: any[] = [];
      a.socket.on("room_state", (s: RoomState) => {
        if (s.game.phase === "DEALING") {
          const d = s.game.dealing!;
          assert.equal(
            s.game.dealer.length +
              s.game.seats!.reduce(
                (n, x) => n + x.hands.reduce((n, h) => n + h.cards.length, 0),
                0,
              ),
            d.events.length,
          );
          released.push(d.events.length);
        }
      });
      await until(() => a.state.game.dealing!.events.length >= 1);
      a.socket.disconnect();
      back = await client(a.session.token);
      await until(() => back!.state?.code === code);
      assert.equal(
        back.state.game.dealing!.events.length,
        back.state.game.seats!.reduce(
          (n, s) => n + s.hands.reduce((n, h) => n + h.cards.length, 0),
          0,
        ) + back.state.game.dealer.length,
      );
      await until(() => back!.state.game.phase !== "DEALING");
      assert.deepEqual(
        back.state.game.dealing!.events.map((e) => e.seatId),
        [1, 3, null, 1, 3],
      );
      assert.equal(back.state.game.dealer.length, 1);
      for (const c of [back, observer])
        for (const s of c.state.game.seats!)
          if (
            s.playerId === c.session.playerId &&
            s.insurance?.decision === "PENDING"
          )
            await c.send("DECLINE_INSURANCE", { seatId: s.id });
      await until(() => back!.state.game.phase !== "INSURANCE");
      if (
        back.state.game.phase === "PLAYER_TURN" &&
        back.state.game.turn?.seatId === 1
      ) {
        const h = observer.state.game.seats![2].hands[0];
        if (h.status === "PLAYING") {
          const before = h.cards.length;
          assert.equal(
            (
              await observer.send("PLAN_ACTION", {
                seatId: 3,
                handId: h.id,
                decision: "HIT",
              })
            ).ok,
            true,
          );
          assert.equal(
            observer.state.game.seats![2].hands[0].cards.length,
            before,
          );
          await observer.send("PLAN_ACTION", {
            seatId: 3,
            handId: h.id,
            decision: "STAND",
          });
          await observer.send("CANCEL_PLAN", { seatId: 3, handId: h.id });
          await observer.send("PLAN_ACTION", {
            seatId: 3,
            handId: h.id,
            decision: "STAND",
          });
        }
      }
      for (let i = 0; i < 12 && back.state.game.phase === "PLAYER_TURN"; i++) {
        const c =
          back.state.game.turn!.playerId === back.session.playerId
            ? back
            : observer;
        assert.equal((await c.send("STAND")).ok, true);
      }
      await until(() => back!.state.game.phase === "ROUND_END");
      await until(() => observer.exclusion?.pending === false);
      assert.equal(back.state.players.length, 1);
      assert.equal(back.state.game.seats![2].playerId, undefined);
      assert.equal(
        (await observer.send("JOIN", { code, name: "Blocked again" })).ok,
        false,
      );
      assert.ok(released.every((n, i) => i === 0 || n >= released[i - 1]));
    } finally {
      a.socket.disconnect();
      b.socket.disconnect();
      observer.socket.disconnect();
      back?.socket.disconnect();
    }
  },
);
