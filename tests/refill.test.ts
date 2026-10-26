import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

test(
  "server refill is idempotent and survives reconnect inside and outside rooms",
  { skip: !process.env.SERVER_URL },
  async () => {
    const socket = io(process.env.SERVER_URL!, { autoConnect: false });
    const session = new Promise<any>((resolve) =>
      socket.once("session", resolve),
    );
    socket.connect();
    const initial = await session;
    const send = (data: object) =>
      new Promise<any>((resolve) =>
        socket.emit("action", { requestId: randomUUID(), ...data }, resolve),
      );
    try {
      const requestId = randomUUID();
      for (const amount of [0, -1, 10001, 1.5]) {
        assert.equal((await send({ type: "REFILL", amount })).ok, false);
      }
      const customId = randomUUID();
      const custom = await send({
        type: "REFILL",
        amount: 1234,
        requestId: customId,
      });
      assert.equal(custom.balance, initial.balance + 1234);
      assert.deepEqual(
        await send({ type: "REFILL", amount: 1234, requestId: customId }),
        custom,
      );
      initial.balance += 1234;
      const first = await send({ type: "REFILL", requestId });
      assert.equal(first.balance, initial.balance + 10000);
      assert.deepEqual(await send({ type: "REFILL", requestId }), first);
      const state = new Promise<any>((resolve) =>
        socket.once("room_state", resolve),
      );
      assert.equal(
        (await send({ type: "CREATE", name: "Refill test" })).ok,
        true,
      );
      assert.equal((await state).players[0].balance, initial.balance + 10000);
      const updated = new Promise<any>((resolve) =>
        socket.once("room_state", resolve),
      );
      assert.equal(
        (await send({ type: "REFILL" })).balance,
        initial.balance + 20000,
      );
      assert.equal((await updated).players[0].balance, initial.balance + 20000);
      socket.disconnect();
      socket.auth = { token: initial.token };
      const restored = new Promise<any>((resolve) =>
        socket.once("session", resolve),
      );
      socket.connect();
      assert.equal((await restored).balance, initial.balance + 20000);
    } finally {
      socket.disconnect();
    }
  },
);
