import {
  evaluateSideBet,
  canSplitCards,
} from "../../../../../packages/shared/blackjack.js";
import type {
  Action,
  Card,
  GameState,
  Hand,
  Player,
  Rules,
  Phase,
  Seat,
  DealSequence,
} from "../../../../../packages/shared/types.js";
import { UserError, type GameEngine } from "../GameEngine.js";
import { Shoe, score, natural } from "./Shoe.js";
export const defaultRules: Rules = {
  minBet: 10,
  maxBet: 2000,
  maxSideBet: 200,
  maxPlayers: 7,
  maxSplits: 3,
  doubleAfterSplit: true,
  hitSoft17: false,
  blackjackPayout: 1.5,
  turnSeconds: 20,
  bettingSeconds: 20,
  dealCardMs: 320,
  dealLeadMs: 1200,
  cutRatio: 0.25,
};
// Upper bound: every active hand consumes at most 30 points (21 + a bust card).
// Rank all 416 physical cards by their minimum value. The longest prefix below
// the total point budget bounds the number of cards any round can consume.
export function reserveCards(hands: number) {
  let sum = 0,
    count = 0;
  const values = Array.from({ length: 8 }, () =>
    Array.from({ length: 4 }, () => [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10,
    ]),
  )
    .flat(2)
    .sort((a, b) => a - b);
  for (const value of values) {
    if (sum + value > hands * 30) break;
    sum += value;
    count++;
  }
  return count + 1;
}
export class BlackjackEngine implements GameEngine {
  readonly shoe = new Shoe();
  phase: Phase = "WAITING_FOR_PLAYERS";
  round = 0;
  dealer: Card[] = [];
  seats: Seat[] = Array.from({ length: 7 }, (_, id) => ({
    id: id + 1,
    bet: 0,
    hands: [],
  }));
  turn?: { playerId: string; hand: number; seatId?: number };
  dealing?: DealSequence;
  private dealTargets: (number | null)[] = [];
  private settledRound = -1;
  private processed = new Set<string>();
  deadline: number | null = null;
  history: string[] = [];
  constructor(readonly rules: Rules = { ...defaultRules }) {}
  state(): GameState {
    return {
      seats: this.seats,
      dealing: this.dealing,
      phase: this.phase,
      round: this.round,
      dealer: this.dealer,
      turn: this.turn,
      deadline: this.deadline,
      shoe: {
        remaining: this.shoe.remaining,
        total: this.shoe.total,
        shuffleSoon:
          this.shoe.remaining <= this.shoe.total * this.rules.cutRatio,
      },
      history: this.history,
      rules: this.rules,
    };
  }
  start(players: Player[]) {
    if (this.phase === "BETTING") {
      const participants = players.filter((p) => p.bet > 0);
      if (
        !participants.length ||
        participants.some((p) => !p.connected || !p.ready)
      )
        throw new UserError(
          "Tous les participants ayant misé doivent être connectés et prêts",
        );
      this.deal(players);
      return;
    }
    if (!["WAITING_FOR_PLAYERS", "ROUND_END"].includes(this.phase))
      throw new UserError("Manche déjà en cours");
    if (!this.seats.some((s) => s.playerId)) {
      for (const p of players.filter((p) => p.connected).slice(0, 7))
        this.seats.find((s) => !s.playerId)!.playerId = p.id;
    }
    if (
      !players.some(
        (p) =>
          p.connected &&
          p.balance >= this.rules.minBet &&
          this.seats.some((s) => s.playerId === p.id),
      )
    )
      throw new UserError("Un joueur solvable doit occuper un siège");
    if (
      this.shoe.remaining <=
      Math.max(
        this.shoe.total * this.rules.cutRatio,
        reserveCards(7 * (this.rules.maxSplits + 1) + 1),
      )
    ) {
      this.phase = "RESHUFFLE";
      this.shoe.reset();
      this.log("Sabot mélangé · 416 cartes");
    }
    this.processed.clear();
    this.round++;
    this.dealer = [];
    this.dealing = undefined;
    this.dealTargets = [];
    this.turn = undefined;
    for (const seat of this.seats) {
      seat.bet = 0;
      seat.hands = [];
      seat.insurance = undefined;
      seat.sideBets = undefined;
    }
    for (const p of players) {
      p.hands = [];
      p.bet = 0;
      p.insuranceEscrow = 0;
      p.sideBetEscrow = 0;
      p.ready = false;
    }
    this.phase = "BETTING";
    this.deadline = null;
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
    if (a.type === "READY" || a.type === "CANCEL_READY") {
      if (this.phase !== "BETTING")
        throw new UserError("Les mises ne sont pas ouvertes");
      if (
        a.type === "READY" &&
        !this.seats.some(
          (s) => s.playerId === p.id && s.bet >= this.rules.minBet,
        )
      )
        throw new UserError(
          "Placez au moins une mise principale avant d’être prêt",
        );
      p.ready = a.type === "READY";
      return;
    }
    if (a.type === "PLAN_ACTION" || a.type === "CANCEL_PLAN") {
      const seat = this.seats.find(
        (s) => s.id === a.seatId && s.playerId === p.id,
      );
      const hand = seat?.hands.find((h) => h.id === a.handId);
      if (
        this.phase !== "PLAYER_TURN" ||
        !hand ||
        hand.status !== "PLAYING" ||
        (this.turn?.playerId === p.id &&
          p.hands[this.turn.hand]?.id === hand.id)
      )
        throw new UserError(
          "Cette main ne peut pas recevoir de décision anticipée",
        );
      if (a.type === "CANCEL_PLAN") hand.plannedAction = undefined;
      else {
        if (!a.decision) throw new UserError("Décision requise");
        this.validateDecision(p, seat!, hand, a.decision);
        hand.plannedAction = {
          type: a.decision,
          ...(a.faceDown ? { faceDown: true } : {}),
        };
      }
      hand.plannedError = undefined;
      return;
    }
    if (a.type === "TAKE_INSURANCE" || a.type === "DECLINE_INSURANCE") {
      const seat = this.seats.find((s) => s.id === a.seatId);
      if (
        this.phase !== "INSURANCE" ||
        Date.now() >= this.deadline! ||
        !seat ||
        seat.playerId !== p.id ||
        seat.insurance?.decision !== "PENDING"
      )
        throw new UserError("Assurance indisponible");
      const amount = seat.bet / 2;
      if (a.type === "TAKE_INSURANCE") {
        if (p.balance < amount)
          throw new UserError("Solde insuffisant pour l’assurance");
        p.balance -= amount;
        p.insuranceEscrow = (p.insuranceEscrow ?? 0) + amount;
        seat.insurance = { decision: "TAKEN", amount };
      } else seat.insurance = { decision: "DECLINED", amount: 0 };
      if (this.seats.every((s) => s.insurance?.decision !== "PENDING"))
        this.advance(players);
      return;
    }
    if (a.type === "TAKE_SEAT" || a.type === "LEAVE_SEAT") {
      if (!["WAITING_FOR_PLAYERS", "ROUND_END", "BETTING"].includes(this.phase))
        throw new UserError("Sièges verrouillés pendant la manche");
      if (this.phase === "BETTING" && p.ready)
        throw new UserError("Annulez prêt pour modifier vos sièges");
      const seat = this.seats.find((s) => s.id === a.seatId);
      if (!seat) throw new UserError("Siège invalide (1–7)");
      if (a.type === "TAKE_SEAT") {
        if (seat.playerId && seat.playerId !== p.id)
          throw new UserError("Siège occupé");
        seat.playerId = p.id;
      } else {
        if (seat.playerId !== p.id)
          throw new UserError("Libération indisponible");
        if (this.phase === "BETTING") this.refundSeat(p, seat);
        seat.playerId = undefined;
        seat.bet = 0;
        seat.hands = [];
        seat.insurance = undefined;
        seat.sideBets = undefined;
      }
      return;
    }
    if (a.type === "BET" || a.type === "BET_ON_SEAT") {
      const seat =
        a.type === "BET"
          ? this.seats.find((s) => s.playerId === p.id && !s.bet)
          : this.seats.find((s) => s.id === a.seatId);
      if (
        this.phase !== "BETTING" ||
        p.ready ||
        !seat ||
        seat.playerId !== p.id
      )
        throw new UserError("Mise indisponible");
      const amount = a.amount!;
      const oldTotal =
        seat.bet + (seat.sideBets ?? []).reduce((n, b) => n + b.amount, 0);
      if (
        !Number.isSafeInteger(amount) ||
        (amount !== 0 && amount < this.rules.minBet) ||
        amount > this.rules.maxBet ||
        (a.type === "BET" && amount % 2 !== 0) ||
        amount > p.balance + oldTotal
      )
        throw new UserError("Mise paire hors limites ou solde insuffisant");
      const sideBets = (["PP", "21+3"] as const).map((type) => ({
        type,
        amount: a.sideBets?.[type] ?? 0,
      }));
      if (
        sideBets.some(
          (b) =>
            !Number.isSafeInteger(b.amount) ||
            b.amount < 0 ||
            b.amount > (this.rules.maxSideBet ?? 200),
        )
      )
        throw new UserError("Side bet hors limites");
      const total = amount + sideBets.reduce((sum, b) => sum + b.amount, 0);
      if (!amount && total)
        throw new UserError(
          "Une mise principale est nécessaire pour les side bets",
        );
      if (total > p.balance + oldTotal)
        throw new UserError("Solde insuffisant");
      this.refundSeat(p, seat);
      seat.sideBets = sideBets.filter((b) => b.amount > 0);
      p.sideBetEscrow = (p.sideBetEscrow ?? 0) + total - amount;
      p.balance -= total;
      p.bet += amount;
      seat.bet = amount;
      return;
    }
    if (this.phase !== "PLAYER_TURN" || this.turn?.playerId !== p.id)
      throw new UserError("Ce n’est pas votre tour");
    if (
      (a.seatId !== undefined && a.seatId !== this.turn.seatId) ||
      (a.hand !== undefined && a.hand !== this.turn.hand)
    )
      throw new UserError("Main incorrecte");
    if (
      this.seats.filter((s) => s.playerId === p.id).length > 1 &&
      (a.seatId === undefined || a.hand === undefined)
    )
      throw new UserError("Identifiez le siège et la main");
    const seat = this.seats.find((s) => s.id === this.turn!.seatId)!;
    const h = p.hands[this.turn.hand];
    if (h.status !== "PLAYING") throw new UserError("Main terminée");
    if (a.handId && a.handId !== h.id) throw new UserError("Main ancienne");
    this.validateDecision(p, seat, h, a.type);
    h.plannedAction = undefined;
    h.plannedError = undefined;
    if (a.type === "HIT") {
      h.cards.push(this.shoe.draw());
      this.mark(h);
    } else if (a.type === "STAND") h.status = "STAND";
    else if (a.type === "DOUBLE") {
      if (
        h.cards.length !== 2 ||
        (h.split && !this.rules.doubleAfterSplit) ||
        p.balance < h.bet
      )
        throw new UserError("Double indisponible");
      p.balance -= h.bet;
      h.bet *= 2;
      h.cards.push(this.shoe.draw());
      h.faceDown = a.faceDown === true;
      h.status = score(h.cards).total > 21 ? "BUST" : "STAND";
    } else if (a.type === "SPLIT") {
      if (
        h.cards.length !== 2 ||
        !canSplitCards(h.cards) ||
        seat.hands.length > this.rules.maxSplits ||
        p.balance < h.bet
      )
        throw new UserError("Split indisponible");
      p.balance -= h.bet;
      const card = h.cards.pop()!;
      h.split = true;
      const second: Hand = {
        id: crypto.randomUUID(),
        seatId: seat.id,
        cards: [card, this.shoe.draw()],
        bet: h.bet,
        status: "PLAYING",
        split: true,
      };
      h.cards.push(this.shoe.draw());
      p.hands.splice(this.turn.hand + 1, 0, second);
      seat.hands.splice(seat.hands.indexOf(h) + 1, 0, second);
      if (card.rank === "A") {
        h.status = "STAND";
        second.status = "STAND";
      } else {
        this.mark(h);
        this.mark(second);
      }
    } else throw new UserError("Action invalide");
    if (h.status !== "PLAYING") this.advance(players);
    else this.deadline = Date.now() + this.rules.turnSeconds * 1000;
  }
  private mark(h: Hand) {
    const value = score(h.cards).total;
    h.status =
      value > 21
        ? "BUST"
        : natural(h.cards, h.split)
          ? "BLACKJACK"
          : value === 21
            ? "STAND"
            : "PLAYING";
  }
  private validateDecision(
    p: Player,
    seat: Seat,
    h: Hand,
    type: Action["type"],
  ) {
    if (!["HIT", "STAND", "DOUBLE", "SPLIT"].includes(type))
      throw new UserError("Action invalide");
    if (
      type === "DOUBLE" &&
      (h.cards.length !== 2 ||
        (h.split && !this.rules.doubleAfterSplit) ||
        p.balance < h.bet)
    )
      throw new UserError("Double indisponible");
    if (
      type === "SPLIT" &&
      (h.cards.length !== 2 ||
        !canSplitCards(h.cards) ||
        seat.hands.length > this.rules.maxSplits ||
        p.balance < h.bet)
    )
      throw new UserError("Split indisponible");
  }
  private refundSeat(p: Player, seat: Seat) {
    const sides = (seat.sideBets ?? []).reduce((n, b) => n + b.amount, 0);
    p.balance += seat.bet + sides;
    p.bet -= seat.bet;
    p.sideBetEscrow = Math.max(0, (p.sideBetEscrow ?? 0) - sides);
    seat.bet = 0;
    seat.sideBets = undefined;
  }
  disconnect(p: Player) {
    if (this.phase !== "BETTING") return;
    for (const seat of this.seats)
      if (seat.playerId === p.id) this.refundSeat(p, seat);
    p.ready = false;
  }
  private deal(players: Player[]) {
    this.phase = "DEALING";
    this.turn = undefined;
    const seats = this.seats.filter((s) => s.bet > 0);
    for (const seat of seats) {
      const p = players.find((p) => p.id === seat.playerId)!;
      const h: Hand = {
        id: crypto.randomUUID(),
        seatId: seat.id,
        cards: [],
        bet: seat.bet,
        status: "PLAYING",
        split: false,
      };
      seat.hands = [h];
      p.hands.push(h);
    }
    this.dealTargets = [
      ...seats.map((s) => s.id),
      null,
      ...seats.map((s) => s.id),
    ];
    const cardMs = this.rules.dealCardMs ?? 320;
    const startedAt = Date.now() + (this.rules.dealLeadMs ?? 1200);
    this.dealing = {
      round: this.round,
      startedAt,
      endsAt: startedAt + this.dealTargets.length * cardMs,
      cardMs,
      total: this.dealTargets.length,
      events: [],
    };
    this.deadline = this.dealing.endsAt;
  }
  private finishDeal(players: Player[], now: number) {
    for (const seat of this.seats)
      if (seat.bet) {
        this.mark(seat.hands[0]);
        for (const bet of seat.sideBets ?? []) {
          const result = evaluateSideBet(bet.type, [
            ...seat.hands[0].cards,
            this.dealer[0],
          ]);
          bet.label = result.label;
          bet.payout = result.payout;
        }
      }
    if (this.dealer[0].rank === "A") {
      for (const seat of this.seats)
        if (seat.bet) seat.insurance = { decision: "PENDING", amount: 0 };
      this.phase = "INSURANCE";
      this.deadline = now + 10000;
    } else this.advance(players);
  }
  private advance(players: Player[]) {
    for (const seat of this.seats) {
      const p = players.find((p) => p.id === seat.playerId);
      if (!p) continue;
      for (const h of seat.hands)
        if (h.status === "PLAYING") {
          this.phase = "PLAYER_TURN";
          this.turn = {
            playerId: p.id,
            seatId: seat.id,
            hand: p.hands.indexOf(h),
          };
          this.deadline = Date.now() + this.rules.turnSeconds * 1000;
          const planned = h.plannedAction;
          if (planned) {
            h.plannedAction = undefined;
            try {
              this.perform(
                p,
                {
                  requestId: `planned:${h.id}`,
                  type: planned.type,
                  seatId: seat.id,
                  hand: this.turn.hand,
                  handId: h.id,
                  faceDown: planned.faceDown,
                },
                players,
              );
            } catch (error) {
              if (!(error instanceof UserError)) throw error;
              h.plannedError = `${error.message} · choisissez une nouvelle action`;
              this.log(`${p.name} · action prévue annulée : ${error.message}`);
            }
          }
          return;
        }
    }
    for (const p of players)
      for (const h of p.hands) h.plannedAction = undefined;
    if (
      players.flatMap((p) => p.hands).every((h) => h.status === "BUST") &&
      !this.seats.some((s) => s.insurance?.amount) &&
      !players.some((p) => p.hands.some((h) => h.faceDown))
    ) {
      this.turn = undefined;
      this.settle(players);
      return;
    }
    this.turn = undefined;
    this.phase = "DEALER_TURN";
    this.deadline = Date.now() + 800;
  }
  tick(players: Player[], now: number) {
    if (this.phase === "DEALING" && this.dealing) {
      const d = this.dealing;
      let changed = false;
      while (
        d.events.length < d.total &&
        now >= d.startedAt + d.events.length * d.cardMs
      ) {
        const seq = d.events.length;
        const seatId = this.dealTargets[seq];
        const card = this.shoe.draw();
        if (seatId === null) this.dealer.push(card);
        else this.seats.find((s) => s.id === seatId)!.hands[0].cards.push(card);
        d.events.push({
          round: this.round,
          seq,
          seatId,
          at: d.startedAt + seq * d.cardMs,
          card,
        });
        changed = true;
      }
      if (now >= d.endsAt && d.events.length === d.total) {
        this.finishDeal(players, now);
        changed = true;
      }
      return changed;
    }
    if (!this.deadline || now < this.deadline) return false;
    if (this.phase === "INSURANCE") {
      for (const seat of this.seats)
        if (seat.insurance?.decision === "PENDING")
          seat.insurance = { decision: "DECLINED", amount: 0 };
      this.advance(players);
    } else if (this.phase === "PLAYER_TURN") {
      const p = players.find((p) => p.id === this.turn?.playerId)!;
      p.hands[this.turn!.hand].status = "STAND";
      this.advance(players);
    } else if (this.phase === "DEALER_TURN") {
      const comparison = players
        .flatMap((p) => p.hands)
        .some((h) => h.status !== "BUST" && h.status !== "BLACKJACK");
      if (this.dealer.length >= 2 && !comparison) {
        this.settle(players);
        return true;
      }
      const s = score(this.dealer);
      if (
        this.dealer.length < 2 ||
        s.total < 17 ||
        (s.total === 17 && s.soft && this.rules.hitSoft17)
      ) {
        this.dealer.push(this.shoe.draw());
        this.deadline = now + 800;
        if (this.dealer.length === 2 && !comparison) this.settle(players);
      } else this.settle(players);
    }
    return true;
  }
  removePlayer(p: Player) {
    for (const s of this.seats)
      if (s.playerId === p.id) {
        if (this.phase === "BETTING") this.refundSeat(p, s);
        s.sideBets = undefined;
        s.playerId = undefined;
        s.bet = 0;
        s.hands = [];
        s.insurance = undefined;
      }
  }
  settle(players: Player[]) {
    if (this.settledRound === this.round) return;
    this.settledRound = this.round;
    this.phase = "SETTLEMENT";
    for (const p of players) {
      p.ready = false;
      for (const h of p.hands) h.plannedAction = undefined;
    }
    const d = score(this.dealer).total,
      dbj = natural(this.dealer);
    for (const p of players)
      for (const h of p.hands) {
        const bj = natural(h.cards, h.split),
          v = score(h.cards).total;
        let returned = 0;
        if (dbj) {
          if (bj) {
            returned = h.bet;
            h.result = "PUSH";
          } else h.result = "DEALER BLACKJACK";
        } else if (v > 21) h.result = "BUST";
        else if (bj) {
          returned = h.bet * (1 + this.rules.blackjackPayout);
          h.result = "BLACKJACK";
        } else if (d > 21 || v > d) {
          returned = h.bet * 2;
          h.result = "WIN";
        } else if (v === d) {
          returned = h.bet;
          h.result = "PUSH";
        } else h.result = "LOSE";
        p.balance += returned;
        h.profit = returned - h.bet;
        p.stats.hands++;
        p.stats.wins += Number(h.profit > 0);
        p.stats.blackjacks += Number(bj);
        p.stats.profit += h.profit;
        p.stats.biggestWin = Math.max(p.stats.biggestWin, h.profit);
        this.log(
          `${p.name} · ${h.result} · ${h.profit >= 0 ? "+" : ""}${h.profit}`,
        );
      }
    for (const seat of this.seats) {
      const insurance = seat.insurance;
      if (!insurance?.amount || insurance.result) continue;
      const p = players.find((p) => p.id === seat.playerId)!;
      insurance.returned = dbj ? insurance.amount * 3 : 0;
      insurance.profit = insurance.returned - insurance.amount;
      insurance.result = dbj ? "WIN" : "LOSE";
      p.balance += insurance.returned;
      p.insuranceEscrow = (p.insuranceEscrow ?? 0) - insurance.amount;
      p.stats.profit += insurance.profit;
      this.log(
        `${p.name} · siège ${seat.id} · assurance ${insurance.result} · ${insurance.profit >= 0 ? "+" : ""}${insurance.profit}`,
      );
    }
    for (const seat of this.seats) {
      const p = players.find((p) => p.id === seat.playerId);
      if (!p) continue;
      for (const bet of seat.sideBets ?? []) {
        bet.returned = bet.payout ? bet.amount * (1 + bet.payout) : 0;
        bet.profit = bet.returned - bet.amount;
        p.balance += bet.returned;
        p.sideBetEscrow = (p.sideBetEscrow ?? 0) - bet.amount;
        p.stats.profit += bet.profit;
        this.log(
          `${p.name} · ${bet.type} · ${bet.label} · ${bet.profit >= 0 ? "+" : ""}${bet.profit}`,
        );
      }
    }
    for (const p of players) p.bet = 0;
    this.phase = "ROUND_END";
    this.deadline = null;
  }
  private log(s: string) {
    this.history = [s, ...this.history].slice(0, 30);
  }
}
