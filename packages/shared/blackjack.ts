import type { Card } from "./types.js";
export const blackjackChips = [2, 5, 10, 25, 50, 100, 500];
export const sideBetPayouts = {
  PP: [
    ["Perfect pair", 25],
    ["Colored pair", 12],
    ["Mixed pair", 6],
  ],
  "21+3": [
    ["Suited trips", 100],
    ["Straight flush", 40],
    ["Three of a kind", 30],
    ["Straight", 10],
    ["Flush", 5],
  ],
} as const;
export function evaluateSideBet(type: "PP" | "21+3", cards: Card[]) {
  const [a, b] = cards;
  if (type === "PP") {
    if (a.rank !== b.rank) return { label: "Perdu", payout: 0 };
    const red = (c: Card) => ["♥", "♦"].includes(c.suit);
    const index = a.suit === b.suit ? 0 : red(a) === red(b) ? 1 : 2;
    const [label, payout] = sideBetPayouts.PP[index];
    return { label, payout };
  }
  const flush = cards.every((c) => c.suit === a.suit);
  const trips = cards.every((c) => c.rank === a.rank);
  const ranks = cards
    .map(
      (c) =>
        [
          "A",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "10",
          "J",
          "Q",
          "K",
        ].indexOf(c.rank) + 1,
    )
    .sort((a, b) => a - b);
  const straight =
    new Set(ranks).size === 3 &&
    (ranks[2] - ranks[0] === 2 || ranks.join(",") === "1,12,13");
  const index =
    trips && flush
      ? 0
      : straight && flush
        ? 1
        : trips
          ? 2
          : straight
            ? 3
            : flush
              ? 4
              : -1;
  if (index === -1) return { label: "Perdu", payout: 0 };
  const [label, payout] = sideBetPayouts["21+3"][index];
  return { label, payout };
}

export function canSplitCards(cards: Card[]) {
  const value = (rank: string) =>
    ["10", "J", "Q", "K"].includes(rank) ? "10" : rank;
  return cards.length === 2 && value(cards[0].rank) === value(cards[1].rank);
}
