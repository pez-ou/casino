// Deterministic visual fixtures. This file is never part of production images.
import { Shoe } from "../../apps/server/src/games/blackjack/Shoe.js";
import { RouletteEngine } from "../../apps/server/src/games/roulette/RouletteEngine.js";
import { BlackjackEngine } from "../../apps/server/src/games/blackjack/BlackjackEngine.js";
const action = BlackjackEngine.prototype.tick;
BlackjackEngine.prototype.tick = function (players, now) {
  const before = this.phase;
  const changed = action.call(this, players, now);
  // Keep the insurance offer alive while all four visual viewports are captured.
  if (before !== "INSURANCE" && this.phase === "INSURANCE")
    this.deadline = Date.now() + 120000;
  return changed;
};
const ranks = [
  "10",
  "9",
  "8",
  "A",
  "10",
  "6",
  "K",
  "A",
  "J",
  "7",
  "8",
  "K",
  "Q",
  "5",
  "10",
  "2",
  "3",
  "K",
  "8",
  "8",
  "8",
  "8",
  "6",
  "7",
  "9",
  "5",
  "4",
];
const draws = new WeakMap<Shoe, number>();
Shoe.prototype.draw = function () {
  const i = draws.get(this) ?? 0;
  draws.set(this, i + 1);
  return {
    id: `ux-${i}`,
    rank: ranks[i % ranks.length],
    suit: ["♠", "♥", "♣", "♦"][i % 4],
  };
};
const tick = RouletteEngine.prototype.tick;
RouletteEngine.prototype.tick = function (players, now) {
  const before = this.phase;
  const changed = tick.call(this, players, now);
  if (before === "BETTING" && this.phase === "BETS_CLOSED")
    this.roulette.winningNumber = 17;
  return changed;
};
await import("../../apps/server/src/index.js");
