import { randomInt } from "node:crypto";
import type {
  Action,
  GameState,
  Player,
  RouletteState,
  Phase,
  RouletteBet,
} from "../../../../../packages/shared/types.js";
import { spotFor } from "../../../../../packages/shared/roulette.js";
import { UserError, type GameEngine } from "../GameEngine.js";
import { defaultRules } from "../blackjack/BlackjackEngine.js";
export class RouletteEngine implements GameEngine {
  phase: Phase = "BETTING";
  round = 1;
  deadline: number;
  private settledRound = -1;
  private processed = new Set<string>();
  private previous = new Map<string, RouletteBet[]>();
  roulette: RouletteState;
  constructor(readonly durations = { betting: 30, spin: 10, result: 5 }) {
    this.deadline = Date.now() + durations.betting * 1000;
    this.roulette = {
      bets: [],
      bettingEndsAt: this.deadline,
      bettingStartedAt: this.deadline - durations.betting * 1000,
      accelerationVotes: [],
      history: [],
      roundsPlayed: 0,
      results: {},
      durations,
    };
  }
  state(): GameState {
    return {
      phase: this.phase,
      round: this.round,
      deadline: this.deadline,
      dealer: [],
      shoe: { remaining: 0, total: 0, shuffleSoon: false },
      rules: { ...defaultRules },
      history: [],
      roulette: this.roulette,
    };
  }
  start(_players: Player[]) {
    throw new UserError("La roulette démarre automatiquement");
  }
  action(p: Player, a: Action, players: Player[]) {
    if (a.round !== undefined && a.round !== this.round)
      throw new UserError("Manche ancienne");
    const key = p.id + ":" + a.requestId;
    if (this.processed.has(key)) return;
    this.perform(p, a, players);
    this.processed.add(key);
  }
  private perform(p: Player, a: Action, players: Player[]) {
    if (this.phase !== "BETTING" || Date.now() >= this.deadline)
      throw new UserError("Les jeux sont faits — Rien ne va plus");
    if (a.type === "ACCELERATE_ROUND") {
      if (!p.connected || !players.some((v) => v.id === p.id && v.connected))
        throw new UserError("Joueur absent du salon");
      if (this.deadline - Date.now() <= 10000)
        throw new UserError(
          "Le compte à rebours est déjà à 10 secondes ou moins",
        );
      if (!this.roulette.accelerationVotes.includes(p.id))
        this.roulette.accelerationVotes.push(p.id);
      this.accelerate(players, Date.now());
      return;
    }
    if (a.type === "MOVE_BET") {
      const bet = this.roulette.bets.find(
        (b) => b.id === a.betId && b.playerId === p.id,
      );
      const spot = spotFor(a.betType!, a.numbers ?? []);
      if (!bet || !spot) throw new UserError("Déplacement de pari invalide");
      bet.type = spot.type;
      bet.numbers = [...spot.numbers];
      bet.payout = spot.payout;
      return;
    }
    if (a.type === "UNDO_BET" || a.type === "CLEAR_BETS") {
      const own = this.roulette.bets.filter((b) => b.playerId === p.id);
      const removed = a.type === "UNDO_BET" ? own.slice(-1) : own;
      const ids = new Set(removed.map((b) => b.id));
      const refund = removed.reduce((n, b) => n + b.amount, 0);
      p.balance += refund;
      p.bet -= refund;
      this.roulette.bets = this.roulette.bets.filter(
        (b) => b.playerId !== p.id || !ids.has(b.id),
      );
      return;
    }
    if (a.type === "REPEAT_BETS") {
      const old = this.previous.get(p.id) ?? [];
      if (!old.length) throw new UserError("Aucune mise précédente");
      const total = old.reduce((n, b) => n + b.amount, 0);
      if (total > p.balance || this.roulette.bets.length + old.length > 2000)
        throw new UserError("Solde ou limite de paris insuffisant");
      for (const [i, b] of old.entries())
        this.place(p, {
          ...a,
          type: "ROULETTE_BET",
          requestId: `${a.requestId}-${i}`,
          betType: b.type,
          numbers: b.numbers,
          amount: b.amount,
        });
      return;
    }
    if (a.type !== "ROULETTE_BET")
      throw new UserError("Action roulette invalide");
    this.place(p, a);
  }
  private place(p: Player, a: Action) {
    const spot = spotFor(a.betType!, a.numbers ?? []),
      amount = a.amount!;
    if (
      !spot ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 10000 ||
      amount > p.balance ||
      this.roulette.bets.length >= 2000
    )
      throw new UserError("Pari invalide ou solde insuffisant");
    p.balance -= amount;
    p.bet += amount;
    this.roulette.bets.push({
      id: a.requestId,
      playerId: p.id,
      type: spot.type,
      numbers: [...spot.numbers],
      payout: spot.payout,
      amount,
    });
  }
  private accelerate(players: Player[], now: number) {
    const connected = players.filter((p) => p.connected);
    if (
      this.phase !== "BETTING" ||
      this.deadline - now <= 10000 ||
      !connected.length ||
      !connected.every((p) => this.roulette.accelerationVotes.includes(p.id))
    )
      return false;
    this.deadline = now + 10000;
    this.roulette.bettingEndsAt = this.deadline;
    return true;
  }
  tick(players: Player[], now: number) {
    const accelerated = this.accelerate(players, now);
    if (now < this.deadline) return accelerated;
    if (this.phase === "BETTING") {
      this.phase = "BETS_CLOSED";
      this.roulette.winningNumber = randomInt(37);
      this.roulette.spinStartedAt = this.deadline;
      this.roulette.spinEndsAt = this.deadline + this.durations.spin * 1000;
      this.deadline = now;
    } else if (this.phase === "BETS_CLOSED") {
      this.phase = "SPINNING";
      this.deadline = this.roulette.spinEndsAt!;
    } else if (this.phase === "SPINNING") {
      this.settle(players);
      this.phase = "RESULT";
      this.deadline = now + this.durations.result * 1000;
    } else if (this.phase === "RESULT") {
      this.processed.clear();
      this.round++;
      this.phase = "BETTING";
      this.deadline = now + this.durations.betting * 1000;
      this.roulette = {
        ...this.roulette,
        bets: [],
        results: {},
        winningNumber: undefined,
        spinStartedAt: undefined,
        spinEndsAt: undefined,
        bettingEndsAt: this.deadline,
        bettingStartedAt: now,
        accelerationVotes: [],
      };
    }
    return true;
  }
  settle(players: Player[]) {
    if (
      this.settledRound === this.round ||
      this.roulette.winningNumber === undefined
    )
      return;
    this.settledRound = this.round;
    const number = this.roulette.winningNumber;
    for (const p of players) {
      const own = this.roulette.bets.filter((b) => b.playerId === p.id);
      let wager = 0,
        returned = 0;
      for (const b of own) {
        b.returned = b.numbers.includes(number) ? b.amount * (b.payout + 1) : 0;
        wager += b.amount;
        returned += b.returned;
      }
      this.previous.set(
        p.id,
        own.map((b) => ({ ...b, numbers: [...b.numbers] })),
      );
      p.balance += returned;
      p.bet = 0;
      if (wager) {
        p.stats.hands++;
        p.stats.wins += Number(returned > wager);
        p.stats.profit += returned - wager;
        p.stats.biggestWin = Math.max(p.stats.biggestWin, returned - wager);
      }
      this.roulette.results[p.id] = {
        wager,
        returned,
        profit: returned - wager,
      };
    }
    this.roulette.history = [number, ...this.roulette.history].slice(0, 20);
    this.roulette.roundsPlayed++;
  }
}
