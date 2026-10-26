import { test } from "node:test";
import assert from "node:assert/strict";
import { SPOTS, spotFor } from "../packages/shared/roulette.js";
import {
  TABLE,
  TARGETS,
  betTarget,
  numberCenter,
  spotKey,
} from "../packages/shared/rouletteLayout.js";
const spot = (type: Parameters<typeof spotFor>[0], numbers: number[]) => {
  const s = spotFor(type, numbers);
  assert.ok(s);
  return s;
};
test("horizontal European orientation: rows 3/6/36, 2/5/35, 1/4/34; columns at right, dozens below", () => {
  assert.deepEqual(numberCenter(3), { x: 112, y: 32 });
  assert.deepEqual(numberCenter(1), { x: 112, y: 160 });
  assert.deepEqual(numberCenter(36), { x: 816, y: 32 });
  assert.deepEqual(numberCenter(34), { x: 816, y: 160 });
  for (let c = 1; c <= 3; c++) {
    const s = SPOTS.find((s) => s.type === "COLUMN" && s.numbers[0] === c)!;
    assert.equal(betTarget(s).x, 888);
    assert.equal(betTarget(s).y, numberCenter(c).y);
    assert.deepEqual(
      s.numbers,
      Array.from({ length: 12 }, (_, i) => c + 3 * i),
    );
  }
  for (let d = 0; d < 3; d++) {
    const s = SPOTS.find(
      (s) => s.type === "DOZEN" && s.numbers[0] === d * 12 + 1,
    )!;
    assert.equal(betTarget(s).y, 238);
    assert.equal(betTarget(s).x, 208 + d * 256);
    assert.deepEqual(
      s.numbers,
      Array.from({ length: 12 }, (_, i) => d * 12 + 1 + i),
    );
  }
});
test("every legal split, corner, zero trio and official outer street/six-line has exact anchor", () => {
  for (const s of SPOTS) {
    const t = betTarget(s);
    if (s.type === "SPLIT") {
      const [a, b] = s.numbers;
      if (a === 0) {
        assert.equal(t.x, 80);
        assert.equal(t.y, numberCenter(b).y);
      } else {
        const p = numberCenter(a),
          q = numberCenter(b);
        assert.ok((a % 3 !== 0 && b === a + 1) || b === a + 3);
        assert.equal(t.x, (p.x + q.x) / 2);
        assert.equal(t.y, (p.y + q.y) / 2);
      }
    }
    if (s.type === "CORNER") {
      const [a, b, c, d] = s.numbers;
      assert.ok(a % 3 !== 0);
      assert.deepEqual([b, c, d], [a + 1, a + 3, a + 4]);
      assert.equal(t.x, numberCenter(a).x + 32);
      assert.equal(t.y, numberCenter(a).y - 32);
    }
    if (s.type === "STREET" && s.numbers[0] !== 0) {
      assert.equal(t.y, 192);
      assert.equal(t.x, numberCenter(s.numbers[0]).x);
      assert.equal(s.numbers[0] % 3, 1);
    }
    if (s.type === "SIX_LINE") {
      assert.equal(t.y, 192);
      assert.equal(t.x, numberCenter(s.numbers[0]).x + 32);
      assert.deepEqual(
        s.numbers,
        Array.from({ length: 6 }, (_, i) => s.numbers[0] + i),
      );
    }
  }
  assert.deepEqual(betTarget(spot("FIRST_FOUR", [0, 1, 2, 3])), {
    x: 80,
    y: 192,
    width: 20,
    height: 20,
  });
  assert.equal(betTarget(spot("STREET", [0, 1, 2])).y, 128);
  assert.equal(betTarget(spot("STREET", [0, 2, 3])).y, 64);
});
test("finite official target whitelist: no collisions or overlapping hitboxes, exact payments preserved", () => {
  assert.equal(TARGETS.length, SPOTS.length);
  assert.equal(
    new Set(TARGETS.map((t) => `${t.x},${t.y}`)).size,
    TARGETS.length,
  );
  for (const [i, t] of TARGETS.entries()) {
    assert.equal(
      spotKey(t.spot),
      spotKey(spotFor(t.spot.type, t.spot.numbers)!),
    );
    assert.ok(
      t.x >= 0 && t.x <= TABLE.width && t.y >= 0 && t.y <= TABLE.height,
    );
    for (const other of TARGETS.slice(i + 1))
      assert.ok(
        Math.abs(t.x - other.x) >= (t.width + other.width) / 2 ||
          Math.abs(t.y - other.y) >= (t.height + other.height) / 2,
        `${spotKey(t.spot)} overlaps ${spotKey(other.spot)}`,
      );
  }
  for (const [x, y] of [
    [40, 212],
    [10, 10],
    [70, 250],
    [400, 206],
    [900, 300],
  ])
    assert.ok(
      !TARGETS.some(
        (t) =>
          Math.abs(x - t.x) < t.width / 2 && Math.abs(y - t.y) < t.height / 2,
      ),
      "empty space must not accept a bet",
    );
});
