import { SPOTS, type BetSpot } from "./roulette.js";
// Horizontal European layout: 3,6,...,36 above 2,5,...,35 above 1,4,...,34.
// Thus the three 12-number columns end on the right; streets run vertically.
export const TABLE = { zero: 80, cell: 64, edge: 192, width: 928, height: 320 };
export type Target = { x: number; y: number; width: number; height: number };
export const spotKey = (s: { type: string; numbers: number[] }) =>
  `${s.type}:${s.numbers.join(",")}`;
export function numberCenter(n: number) {
  return n === 0
    ? { x: 40, y: 96 }
    : {
        x: 80 + Math.floor((n - 1) / 3) * 64 + 32,
        y: (2 - ((n - 1) % 3)) * 64 + 32,
      };
}
export function betTarget(s: BetSpot): Target {
  const box = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
  });
  if (s.type === "STRAIGHT") {
    const p = numberCenter(s.numbers[0]);
    return box(p.x, p.y, 44, 44);
  }
  if (s.type === "SPLIT") {
    const [a, b] = s.numbers;
    if (a === 0) return box(80, numberCenter(b).y, 16, 28);
    const p = numberCenter(a),
      q = numberCenter(b);
    return box(
      (p.x + q.x) / 2,
      (p.y + q.y) / 2,
      p.x === q.x ? 28 : 16,
      p.x === q.x ? 16 : 28,
    );
  }
  if (s.type === "CORNER") {
    const points = s.numbers.map(numberCenter);
    return box(
      points.reduce((n, p) => n + p.x, 0) / 4,
      points.reduce((n, p) => n + p.y, 0) / 4,
      20,
      20,
    );
  }
  if (s.type === "STREET")
    return s.numbers[0] === 0
      ? box(80, s.numbers.includes(1) ? 128 : 64, 20, 20)
      : box(numberCenter(s.numbers[0]).x, 192, 20, 20);
  if (s.type === "SIX_LINE")
    return box(numberCenter(s.numbers[0]).x + 32, 192, 20, 20);
  if (s.type === "FIRST_FOUR") return box(80, 192, 20, 20);
  if (s.type === "COLUMN")
    return box(888, numberCenter(s.numbers[0]).y, 80, 64);
  if (s.type === "DOZEN")
    return box(
      80 + Math.floor((s.numbers[0] - 1) / 12) * 256 + 128,
      238,
      256,
      52,
    );
  const outside = ["LOW", "EVEN", "RED", "BLACK", "ODD", "HIGH"];
  const index = outside.indexOf(s.type);
  if (index < 0) throw new Error("Unknown roulette spot");
  return box(80 + index * 128 + 64, 292, 128, 56);
}
export const TARGETS = SPOTS.map((spot) => ({ spot, ...betTarget(spot) }));
