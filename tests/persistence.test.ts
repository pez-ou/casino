import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../apps/server/src/sessions/Store.js";
test("wallet persistence hashes tokens, refunds unfinished bets, keeps settled results and expires old sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "velvet-"));
  try {
    const file = join(dir, "wallets.json"),
      store = new SessionStore(file);
    const { session, token } = store.resolve();
    session.player.balance = 9700;
    session.player.hands = [
      { cards: [], bet: 200, status: "STAND", split: false },
      { cards: [], bet: 100, status: "STAND", split: true },
    ];
    store.save();
    assert.ok(!readFileSync(file, "utf8").includes(token!));
    const restored = new SessionStore(file).resolve(token).session;
    assert.equal(restored.player.balance, 10000);
    assert.equal(restored.player.hands.length, 0);
    assert.equal(restored.player.id, session.player.id);
    session.player.hands.forEach((h) => {
      h.result = "LOSE";
      h.profit = -h.bet;
    });
    store.save();
    assert.equal(
      new SessionStore(file).resolve(token).session.player.balance,
      9700,
    );
    session.seen = Date.now() - 31 * 86400000;
    store.gc();
    assert.equal(store.sessions.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("roulette escrow refunded after interrupted spin, committed payout never refunded again", () => {
  const dir = mkdtempSync(join(tmpdir(), "velvet-roulette-"));
  try {
    const file = join(dir, "wallets.json"),
      store = new SessionStore(file);
    const { session, token } = store.resolve();
    session.player.balance = 9500;
    session.player.bet = 500;
    store.save();
    assert.equal(
      new SessionStore(file).resolve(token).session.player.balance,
      10000,
    );
    session.player.balance = 10500;
    session.player.bet = 0;
    store.save();
    const restored = new SessionStore(file);
    assert.equal(restored.resolve(token).session.player.balance, 10500);
    restored.save();
    assert.equal(
      new SessionStore(file).resolve(token).session.player.balance,
      10500,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("insurance escrow refunded on restart and settled insurance not refunded twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "velvet-insurance-"));
  try {
    const file = join(dir, "wallets.json"),
      store = new SessionStore(file);
    const { session, token } = store.resolve();
    session.player.balance = 9850;
    session.player.insuranceEscrow = 50;
    session.player.hands = [
      { cards: [], bet: 100, status: "STAND", split: false },
    ];
    store.save();
    const restored = new SessionStore(file).resolve(token).session;
    assert.equal(restored.player.balance, 10000);
    assert.equal(restored.player.insuranceEscrow, 0);
    session.player.balance = 10000;
    session.player.insuranceEscrow = 0;
    session.player.hands[0].result = "LOSE";
    store.save();
    assert.equal(
      new SessionStore(file).resolve(token).session.player.balance,
      10000,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
