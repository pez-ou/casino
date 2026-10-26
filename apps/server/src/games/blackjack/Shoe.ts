import { randomInt } from "node:crypto";
import type { Card } from "../../../../../packages/shared/types.js";
export function shuffle<T>(
  cards: T[],
  rng: (max: number) => number = randomInt,
): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export class Shoe {
  private cards: Card[] = [];
  readonly total = 416;
  constructor() {
    this.reset();
  }
  reset() {
    this.cards = shuffle(
      Array.from({ length: 8 }, (_, deck) =>
        ["♠", "♥", "♦", "♣"].flatMap((suit) =>
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
          ].map((rank) => ({ id: `${deck}-${suit}-${rank}`, rank, suit })),
        ),
      ).flat(),
    );
  }
  get remaining() {
    return this.cards.length;
  }
  draw() {
    const card = this.cards.pop();
    if (!card) throw new Error("Sabot épuisé");
    return card;
  }
}
export function score(cards: Card[]) {
  let total = 0,
    aces = 0;
  for (const c of cards) {
    if (c.rank === "A") {
      total += 11;
      aces++;
    } else total += ["J", "Q", "K"].includes(c.rank) ? 10 : Number(c.rank);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}
export function natural(cards: Card[], split = false) {
  return (
    !split &&
    cards.length === 2 &&
    cards.some((c) => c.rank === "A") &&
    cards.some((c) => ["10", "J", "Q", "K"].includes(c.rank))
  );
}
