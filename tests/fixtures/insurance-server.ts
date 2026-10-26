// Test-only bootstrap. Never imported or copied into the production images.
// Two initial seats: 10+6, 9+7; dealer Ace, second card King after decisions.
import { Shoe } from "../../apps/server/src/games/blackjack/Shoe.js";
const ranks = ["10", "9", "A", "6", "7", "K"];
const draws = new WeakMap<Shoe, number>();
Shoe.prototype.draw = function () {
  const i = draws.get(this) ?? 0;
  draws.set(this, i + 1);
  return { id: `fixture-${i}`, rank: ranks[i % ranks.length], suit: "♠" };
};
await import("../../apps/server/src/index.js");
