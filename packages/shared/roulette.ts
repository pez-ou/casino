import type { RouletteBetType } from "./types.js";
export const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
export const RED = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];
export const color = (n: number) =>
  n === 0 ? "green" : RED.includes(n) ? "red" : "black";
export type BetSpot = {
  type: RouletteBetType;
  numbers: number[];
  payout: number;
  label: string;
};
export const SPOTS: BetSpot[] = [];
const add = (
  type: RouletteBetType,
  numbers: number[],
  payout: number,
  label = numbers.join(" / "),
) => SPOTS.push({ type, numbers, payout, label });
for (let n = 0; n <= 36; n++) add("STRAIGHT", [n], 35, String(n));
for (let n = 1; n <= 36; n++) {
  if (n % 3) add("SPLIT", [n, n + 1], 17);
  if (n <= 33) add("SPLIT", [n, n + 3], 17);
  if (n <= 32 && n % 3) add("CORNER", [n, n + 1, n + 3, n + 4], 8);
}
for (const n of [1, 2, 3]) add("SPLIT", [0, n], 17);
add("STREET", [0, 1, 2], 11);
add("STREET", [0, 2, 3], 11);
for (let n = 1; n <= 34; n += 3) {
  add("STREET", [n, n + 1, n + 2], 11, `Transversale ${n}–${n + 2}`);
  if (n <= 31)
    add(
      "SIX_LINE",
      [n, n + 1, n + 2, n + 3, n + 4, n + 5],
      5,
      `Sixain ${n}–${n + 5}`,
    );
}
add("FIRST_FOUR", [0, 1, 2, 3], 8, "Premiers quatre");
add("RED", RED, 1, "Rouge");
add(
  "BLACK",
  WHEEL.filter((n) => n !== 0 && !RED.includes(n)).sort((a, b) => a - b),
  1,
  "Noir",
);
add(
  "EVEN",
  Array.from({ length: 18 }, (_, i) => 2 + 2 * i),
  1,
  "Pair",
);
add(
  "ODD",
  Array.from({ length: 18 }, (_, i) => 1 + 2 * i),
  1,
  "Impair",
);
add(
  "LOW",
  Array.from({ length: 18 }, (_, i) => i + 1),
  1,
  "Manque 1–18",
);
add(
  "HIGH",
  Array.from({ length: 18 }, (_, i) => i + 19),
  1,
  "Passe 19–36",
);
for (let i = 0; i < 3; i++) {
  add(
    "DOZEN",
    Array.from({ length: 12 }, (_, j) => i * 12 + j + 1),
    2,
    `${i + 1}e douzaine`,
  );
  add(
    "COLUMN",
    Array.from({ length: 12 }, (_, j) => i + 1 + j * 3),
    2,
    `${i + 1}e colonne`,
  );
}
export function spotFor(type: RouletteBetType, numbers: number[]) {
  const key = [...numbers].sort((a, b) => a - b).join(",");
  return SPOTS.find(
    (s) =>
      s.type === type && [...s.numbers].sort((a, b) => a - b).join(",") === key,
  );
}
