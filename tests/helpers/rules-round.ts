import { BlackjackEngine } from "../../apps/server/src/games/blackjack/BlackjackEngine.js";
// Payout/rules fixtures explicitly complete readiness and distribution instantly.
// Rhythm tests exercise the real clock and manual lifecycle without this helper.
export function autoDealForRulesTests(engine: BlackjackEngine) {
  Object.assign(engine.rules, { dealCardMs: 0, dealLeadMs: 0 });
  const tick = engine.tick.bind(engine);
  engine.tick = (players, now) =>
    tick(
      players,
      engine.phase === "DEALER_TURN"
        ? Math.max(now, engine.deadline ?? now)
        : now,
    );
  const original = engine.action.bind(engine);
  engine.action = (player, action, players) => {
    original(player, action, players);
    if (
      ["BET", "BET_ON_SEAT"].includes(action.type) &&
      engine.phase === "BETTING" &&
      engine.seats.filter((s) => s.playerId).every((s) => s.bet > 0)
    ) {
      for (const participant of players.filter((p) => p.bet > 0))
        original(
          participant,
          { type: "READY", requestId: crypto.randomUUID() },
          players,
        );
      engine.start(players);
      engine.tick(players, Date.now());
    }
  };
}
