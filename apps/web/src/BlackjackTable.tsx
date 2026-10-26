import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Plus, Undo2, Trash2, Clock3 } from "lucide-react";
import type {
  Hand,
  Player,
  RoomState,
  Seat,
} from "../../../packages/shared/types";
import { DealProvider } from "./DealAnimation";
import { PlannedActions, decisionLabel } from "./PlannedActions";
import { canSplitCards } from "../../../packages/shared/blackjack";
import {
  Cards,
  ChipPicker,
  GainBanner,
  Modal,
  money,
  points,
  type Act,
} from "./GameUI";
const seatWagers = (seat?: Seat): Partial<Record<Zone, number>> => ({
  MAIN: seat?.bet ?? 0,
  PP: seat?.sideBets?.find((b) => b.type === "PP")?.amount ?? 0,
  "21+3": seat?.sideBets?.find((b) => b.type === "21+3")?.amount ?? 0,
});
type Zone = "MAIN" | "PP" | "21+3";
type Props = {
  room: RoomState;
  id: string;
  now: number;
  offset: number;
  pending: boolean;
  connected: boolean;
  act: Act;
  onError: (s: string) => void;
};
const positions = [
  [9, 50],
  [22.5, 57],
  [36, 62],
  [50, 64],
  [64, 62],
  [77.5, 57],
  [91, 50],
];
const statusText = (h: Hand) =>
  h.result
    ? ({
        WIN: "Gagné",
        LOSE: "Perdu",
        PUSH: "Égalité",
        BLACKJACK: "Blackjack",
        BUST: "Dépassé",
        "DEALER BLACKJACK": "Blackjack croupier",
      }[h.result] ?? h.result)
    : h.status === "BLACKJACK"
      ? "Blackjack"
      : h.status === "BUST"
        ? "Dépassé"
        : h.status === "STAND"
          ? "Terminé"
          : "";
const TableSeat = memo(function TableSeat({
  seat,
  player,
  mine,
  active,
  selected,
  phase,
  draft,
  zone,
  onBet,
  onSelect,
  onInspect,
  activeCardId,
  act,
  pending,
  connected,
}: {
  seat: Seat;
  player?: Player;
  mine: boolean;
  active: boolean;
  selected: boolean;
  phase: string;
  draft?: Partial<Record<Zone, number>>;
  zone: string;
  onBet: (seatId: number, zone: Zone) => void;
  onSelect: (id: number) => void;
  onInspect: (id: number) => void;
  activeCardId?: string;
  act: Act;
  pending: boolean;
  connected: boolean;
}) {
  const [x, y] = positions[seat.id - 1];
  const editable = mine && phase === "BETTING";
  const amounts = draft ?? seatWagers(seat);
  const selectable = ["BETTING", "WAITING_FOR_PLAYERS", "ROUND_END"].includes(
    phase,
  );
  return (
    <div
      className={`seat ${mine ? "my-seat" : ""} ${active ? "on-turn" : ""} ${selected ? "selected-seat" : ""} ${!player ? "empty-seat" : ""} ${seat.hands.length > 1 ? "has-splits" : ""}`}
      data-seat={seat.id}
      style={
        { "--seat-x": `${x}%`, "--seat-y": `${y}%` } as React.CSSProperties
      }
    >
      {!player ? (
        <button
          className="take-seat"
          aria-label="S’installer"
          title={`Prendre cette place · siège ${seat.id}`}
          disabled={pending || !connected || !selectable}
          onClick={() => act("TAKE_SEAT", { seatId: seat.id })}
        >
          <Plus size={23} />
          <span>Siège {seat.id}</span>
        </button>
      ) : (
        <>
          <div className="hands">
            {seat.hands.map((h, i) => (
              <div
                key={h.id ?? `${h.cards[0]?.id}-${i}`}
                className={`table-hand ${active && h.cards[0]?.id === activeCardId ? "current-hand" : ""}`}
              >
                <div className="hand-total">
                  <b>{h.cards.length ? points(h.cards) : "·"}</b>
                  <span
                    className={`hand-status ${h.profit && h.profit > 0 ? "won" : ""}`}
                  >
                    {statusText(h) || `Main ${i + 1}`}
                    {h.profit !== undefined
                      ? ` · ${h.profit >= 0 ? "+" : ""}${money(h.profit)}`
                      : ""}
                  </span>
                </div>
                <Cards cards={h.cards} />
                {h.profit !== undefined && h.profit > 0 && (
                  <strong className="hand-win-amount" role="status">
                    +{money(h.profit)} jetons
                  </strong>
                )}
                {h.plannedAction && (
                  <small className="planned-label">
                    Action prévue : {decisionLabel[h.plannedAction.type]}
                  </small>
                )}
                <span className="bet-chip" aria-label={`Mise ${h.bet}`}>
                  {money(h.bet)}
                </span>
              </div>
            ))}
          </div>
          {editable ? (
            <div className="bet-spots">
              {(["PP", "21+3", "MAIN"] as const).map((type) => (
                <button
                  key={type}
                  className={`bet-spot ${type === "MAIN" ? "main-spot" : "side-spot"} ${zone === `${seat.id}-${type}` ? "selected-spot" : ""}`}
                  aria-label={
                    type === "MAIN"
                      ? `Ajouter un jeton principal au siège ${seat.id}`
                      : `Ajouter ${type} siège ${seat.id}`
                  }
                  aria-pressed={zone === `${seat.id}-${type}`}
                  disabled={pending || !connected}
                  onClick={() => onBet(seat.id, type)}
                >
                  <small>{type === "MAIN" ? "MISE" : type}</small>
                  <b
                    key={amounts[type] ?? 0}
                    className={amounts[type] ? "wager-chip" : "empty-wager"}
                    aria-live="polite"
                  >
                    {amounts[type] ?? 0}
                  </b>
                </button>
              ))}
            </div>
          ) : !seat.hands.length ? (
            <div className="seat-wait">
              <span className="seat-outline">
                {seat.bet ? money(seat.bet) : "♠"}
              </span>
              <small>{seat.bet ? "Mise confirmée" : "En attente"}</small>
            </div>
          ) : null}
          {phase === "BETTING" && !!seat.bet && (
            <small className="seat-ready">
              {player.ready ? "Prêt ✓" : "Mise confirmée · modifiable"}
            </small>
          )}
          {!!seat.sideBets?.length && (
            <div className="side-results">
              {seat.sideBets.map((b) => (
                <span key={b.type} className={b.payout ? "side-bet-won" : ""}>
                  {b.type} · {b.amount}
                  {b.payout
                    ? ` · +${money(b.amount * b.payout)} net`
                    : b.profit !== undefined
                      ? ` · ${money(b.profit)}`
                      : ""}
                </span>
              ))}
            </div>
          )}
          {seat.insurance && (
            <small className="seat-insurance" data-insurance={seat.id}>
              Assurance :{" "}
              {seat.insurance.decision === "PENDING"
                ? "À décider"
                : seat.insurance.decision === "DECLINED"
                  ? "Refusée"
                  : `${seat.insurance.amount} crédits engagés`}
              {seat.insurance.result
                ? ` · ${seat.insurance.result === "WIN" ? "Gagnée" : "Perdue"} · retour ${seat.insurance.returned} · net ${seat.insurance.profit}`
                : ""}
            </small>
          )}
          <button
            className="seat-identity"
            disabled={pending}
            onClick={() =>
              mine && selectable ? onSelect(seat.id) : onInspect(seat.id)
            }
            aria-label={
              mine && selectable
                ? `Sélectionner siège ${seat.id}`
                : `Voir les mains siège ${seat.id}`
            }
            aria-pressed={selected}
          >
            <span className="seat-number">{seat.id}</span>
            <span className="seat-name">
              <b>{player.name}</b>
              <small>
                {active
                  ? mine
                    ? "À vous de jouer"
                    : "En jeu"
                  : `${money(player.balance)} jetons${mine ? " · vous" : ""}`}
              </small>
            </span>
          </button>
        </>
      )}
    </div>
  );
});
export function BlackjackTable({
  room,
  id,
  now,
  offset,
  pending: networkPending,
  connected,
  act,
  onError,
}: Props) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [repeating, setRepeating] = useState(false);
  const pending = networkPending || repeating;
  const [betFeedback, setBetFeedback] = useState("");
  const previousKey = `velvet.blackjack.previous.${room.code}.${id}`;
  const [previous, setPrevious] = useState<{
    round: number;
    bets: Record<number, Partial<Record<Zone, number>>>;
  } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(previousKey) || "null");
      return saved &&
        Number.isSafeInteger(saved.round) &&
        saved.bets &&
        typeof saved.bets === "object" &&
        !Array.isArray(saved.bets)
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const g = room.game,
    me = room.players.find((p) => p.id === id),
    seats = g.seats ?? [];
  const [plannedHandId, setPlannedHandId] = useState("");
  const [inspected, setInspected] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<
    Record<number, Partial<Record<Zone, number>>>
  >({});
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [chip, setChip] = useState(25),
    [selected, setSelected] = useState<number>(1),
    [zone, setZone] = useState("1-MAIN"),
    [doubleChoice, setDoubleChoice] = useState(false);
  useEffect(() => {
    setDrafts({});
    setHistory({});
    setDoubleChoice(false);
    setBetFeedback("");
  }, [room.code, g.round]);
  useEffect(() => {
    if (g.turn?.playerId === id) {
      setSelected(g.turn.seatId ?? 1);
      setDoubleChoice(false);
    }
  }, [g.turn?.seatId, g.turn?.hand, g.turn?.playerId, id]);
  useEffect(() => {
    if (!seats.some((s) => s.id === selected && s.playerId === id)) {
      const first = seats.find((s) => s.playerId === id);
      if (first) {
        setSelected(first.id);
        setZone(`${first.id}-MAIN`);
      }
    }
  }, [seats, id, selected]);
  useEffect(() => {
    const table = tableRef.current;
    const surface = table?.querySelector<HTMLElement>(".felt-surface");
    if (!table || !surface) return;
    const fit = () => {
      const naturalHeight = Math.max(
        surface.offsetHeight,
        surface.scrollHeight,
      );
      const ratio = Math.min(
        1,
        table.clientHeight / Math.max(1, naturalHeight),
      );
      surface.style.setProperty("--table-fit", String(ratio));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(table);
    observer.observe(surface);
    fit();
    return () => observer.disconnect();
  }, [
    g.phase,
    seats.map((s) => s.hands.map((h) => h.cards.length).join(",")).join("|"),
  ]);
  useEffect(() => {
    if (g.phase === "BETTING") return;
    const bets: Record<number, Partial<Record<Zone, number>>> = {};
    for (const seat of seats)
      if (seat.playerId === id && seat.bet > 0) {
        bets[seat.id] = {
          MAIN: seat.bet,
          PP: seat.sideBets?.find((b) => b.type === "PP")?.amount ?? 0,
          "21+3": seat.sideBets?.find((b) => b.type === "21+3")?.amount ?? 0,
        };
      }
    if (!Object.keys(bets).length) return;
    const saved = { round: g.round, bets };
    setPrevious(saved);
    try {
      localStorage.setItem(previousKey, JSON.stringify(saved));
    } catch {
      /* Repetition remains available in memory. */
    }
  }, [g.phase, g.round, seats, id, previousKey]);
  const seconds = g.deadline
    ? Math.max(0, Math.ceil((g.deadline - now - offset) / 1000))
    : 0;
  const waiting = ["WAITING_FOR_PLAYERS", "ROUND_END"].includes(g.phase),
    betting = g.phase === "BETTING";
  const ownTurn = g.phase === "PLAYER_TURN" && g.turn?.playerId === id;
  const activePlayer = room.players.find((p) => p.id === g.turn?.playerId),
    hand = activePlayer?.hands[g.turn?.hand ?? 0];
  const activeSeat = seats.find((s) => s.id === g.turn?.seatId);
  const selectedSeat = seats.find(
    (s) => s.id === selected && s.playerId === id,
  );
  const currentDraft = drafts[selected] ?? seatWagers(selectedSeat),
    total =
      (currentDraft.MAIN ?? 0) +
      (currentDraft.PP ?? 0) +
      (currentDraft["21+3"] ?? 0);
  const engaged = room.players.filter((p) => p.bet > 0);
  const canStart =
    engaged.length > 0 && engaged.every((p) => p.connected && p.ready);
  const canOpen = room.players.some(
    (p) =>
      p.connected &&
      p.balance >= g.rules.minBet &&
      seats.some((s) => s.playerId === p.id),
  );
  const nextHands = (me?.hands ?? []).filter(
    (h) => h.status === "PLAYING" && h.id && h.id !== hand?.id,
  );
  const plannedHand =
    nextHands.find((h) => h.id === plannedHandId) ?? nextHands[0];
  const plannedSeat = seats.find((s) => s.id === plannedHand?.seatId);
  const onSelect = useCallback((seatId: number) => {
    setSelected(seatId);
    setZone(`${seatId}-MAIN`);
  }, []);
  const onBet = useCallback(
    (seatId: number, type: Zone) => {
      setSelected(seatId);
      setZone(`${seatId}-${type}`);
      if (me?.ready) return;
      onError("");
      const base =
        drafts[seatId] ?? seatWagers(seats.find((s) => s.id === seatId));
      const limit =
          type === "MAIN" ? g.rules.maxBet : (g.rules.maxSideBet ?? 200),
        amount = base[type] ?? 0;
      if (amount + chip > limit) {
        onError(
          `Mise maximale ${type === "MAIN" ? "principale" : type} : ${money(limit)} jetons`,
        );
        return;
      }
      const seatTotal = Object.values(base).reduce((n, v) => n + (v ?? 0), 0);
      if (
        seatTotal + chip >
        (me?.balance ?? 0) +
          Object.values(seatWagers(seats.find((s) => s.id === seatId))).reduce(
            (n, v) => n + (v ?? 0),
            0,
          )
      ) {
        onError("Solde insuffisant pour ce jeton");
        return;
      }
      setDrafts((old) => ({
        ...old,
        [seatId]: { ...base, [type]: amount + chip },
      }));
      setHistory((old) => ({
        ...old,
        [`${seatId}-${type}`]: [...(old[`${seatId}-${type}`] ?? []), chip],
      }));
    },
    [
      chip,
      drafts,
      me?.balance,
      me?.ready,
      seats,
      g.rules.maxBet,
      g.rules.maxSideBet,
      onError,
    ],
  );
  const undo = () => {
    const stack = history[zone] ?? [],
      last = stack.at(-1);
    if (!last) return;
    const seatId = Number(zone.split("-")[0]),
      type = zone.split("-")[1] as Zone;
    setDrafts((old) => ({
      ...old,
      [seatId]: { ...old[seatId], [type]: (old[seatId]?.[type] ?? 0) - last },
    }));
    setHistory((old) => ({ ...old, [zone]: stack.slice(0, -1) }));
    onError("");
  };
  const confirm = async () => {
    const ok = await act("BET_ON_SEAT", {
      seatId: selected,
      amount: currentDraft.MAIN ?? 0,
      sideBets: { PP: currentDraft.PP ?? 0, "21+3": currentDraft["21+3"] ?? 0 },
    });
    if (ok) {
      setDrafts((old) => {
        const next = { ...old };
        delete next[selected];
        return next;
      });
      setHistory({});
    }
  };
  const setReady = async () => {
    if (me?.ready) {
      await act("CANCEL_READY");
      return;
    }
    const own = seats.filter((s) => s.playerId === id);
    const staged = own.map((s) => ({
      seat: s,
      bet: drafts[s.id] ?? seatWagers(s),
    }));
    if (!staged.some((s) => (s.bet.MAIN ?? 0) >= g.rules.minBet)) {
      onError("Placez au moins une mise principale avant d’être prêt.");
      return;
    }
    if (
      staged.some(
        ({ bet: b }) =>
          (b.MAIN ?? 0) > g.rules.maxBet ||
          ((b.MAIN ?? 0) > 0 && b.MAIN! < g.rules.minBet) ||
          [b.PP ?? 0, b["21+3"] ?? 0].some(
            (n) => n > (g.rules.maxSideBet ?? 200),
          ) ||
          (!(b.MAIN ?? 0) && (b.PP ?? 0) + (b["21+3"] ?? 0) > 0),
      )
    ) {
      onError("Vérifiez vos mises et les limites de la table.");
      return;
    }
    const cost = staged.reduce(
      (n, s) => n + Object.values(s.bet).reduce((n, v) => n + (v ?? 0), 0),
      0,
    );
    const available =
      (me?.balance ?? 0) +
      own.reduce(
        (n, s) =>
          n + Object.values(seatWagers(s)).reduce((n, v) => n + (v ?? 0), 0),
        0,
      );
    if (cost > available) {
      onError(`Solde insuffisant : ${money(cost)} jetons nécessaires.`);
      return;
    }
    setRepeating(true);
    try {
      for (const { seat, bet } of staged)
        if (drafts[seat.id]) {
          if (
            !(await act("BET_ON_SEAT", {
              seatId: seat.id,
              amount: bet.MAIN ?? 0,
              sideBets: { PP: bet.PP ?? 0, "21+3": bet["21+3"] ?? 0 },
            }))
          )
            return;
        }
      if (await act("READY")) {
        setDrafts({});
        setHistory({});
        setBetFeedback("Mises verrouillées · vous êtes prêt.");
      }
    } finally {
      setRepeating(false);
    }
  };
  const clearBets = async (only?: number) => {
    setRepeating(true);
    try {
      for (const s of seats.filter(
        (s) => s.playerId === id && s.bet > 0 && (!only || s.id === only),
      ))
        if (
          !(await act("BET_ON_SEAT", {
            seatId: s.id,
            amount: 0,
            sideBets: { PP: 0, "21+3": 0 },
          }))
        )
          return;
      setDrafts((old) => (only ? { ...old, [only]: {} } : {}));
      setHistory({});
      setBetFeedback("Mises effacées.");
    } finally {
      setRepeating(false);
    }
  };
  const repeatBets = async () => {
    if (
      pending ||
      !connected ||
      me?.ready ||
      !previous ||
      previous.round >= g.round
    )
      return;
    const eligible = seats.filter(
      (s) => s.playerId === id && !s.bet && previous.bets[s.id],
    );
    const valid = eligible.filter((s) => {
      const b = previous.bets[s.id];
      return (
        Number.isSafeInteger(b.MAIN) &&
        b.MAIN! >= g.rules.minBet &&
        b.MAIN! <= g.rules.maxBet &&
        [b.PP ?? 0, b["21+3"] ?? 0].every(
          (n) =>
            Number.isSafeInteger(n) &&
            n >= 0 &&
            n <= (g.rules.maxSideBet ?? 200),
        )
      );
    });
    if (!valid.length) {
      onError(
        "Aucune mise précédente ne peut être répétée sur vos sièges disponibles.",
      );
      return;
    }
    const cost = valid.reduce(
      (sum, s) =>
        sum +
        Object.values(previous.bets[s.id]).reduce((n, v) => n + (v ?? 0), 0),
      0,
    );
    if (cost > (me?.balance ?? 0)) {
      onError(
        `Solde insuffisant : ${money(cost)} jetons nécessaires pour répéter les mises.`,
      );
      return;
    }
    setRepeating(true);
    setBetFeedback("");
    let applied = 0;
    try {
      for (const seat of valid) {
        const b = previous.bets[seat.id];
        const ok = await act("BET_ON_SEAT", {
          seatId: seat.id,
          amount: b.MAIN,
          sideBets: { PP: b.PP ?? 0, "21+3": b["21+3"] ?? 0 },
        });
        if (!ok) break; // Server refusals and interrupted acknowledgements stop the batch.
        applied++;
        setDrafts((old) => {
          const next = { ...old };
          delete next[seat.id];
          return next;
        });
        setHistory((old) => ({
          ...old,
          [`${seat.id}-MAIN`]: [],
          [`${seat.id}-PP`]: [],
          [`${seat.id}-21+3`]: [],
        }));
      }
      const skipped = Object.keys(previous.bets).length - valid.length;
      setBetFeedback(
        `${applied} / ${valid.length} siège${valid.length > 1 ? "s" : ""} confirmé${applied > 1 ? "s" : ""}${skipped ? ` · ${skipped} ignoré(s) : déjà misé, indisponible ou hors limites.` : ""}`,
      );
    } finally {
      setRepeating(false);
    }
  };
  const resultSeats = seats.filter((s) => s.playerId === id);
  const profit =
    (me?.hands ?? []).reduce((n, h) => n + (h.profit ?? 0), 0) +
    resultSeats.reduce(
      (n, s) =>
        n +
        (s.insurance?.profit ?? 0) +
        (s.sideBets ?? []).reduce((n, b) => n + (b.profit ?? 0), 0),
      0,
    );
  const returned =
    (me?.hands ?? []).reduce((n, h) => n + h.bet + (h.profit ?? 0), 0) +
    resultSeats.reduce(
      (n, s) =>
        n +
        (s.insurance?.returned ?? 0) +
        (s.sideBets ?? []).reduce((n, b) => n + (b.returned ?? 0), 0),
      0,
    );
  const status = waiting
    ? g.round
      ? "La manche est terminée"
      : "Installez-vous à la table"
    : betting
      ? "Placez vos mises"
      : g.phase === "INSURANCE"
        ? "Le croupier montre un As"
        : g.phase === "DEALER_TURN"
          ? "Le croupier joue"
          : ownTurn
            ? "À vous de jouer"
            : `${activePlayer?.name ?? "La table"} joue`;
  return (
    <main
      className={`table-page blackjack-page ${g.phase === "PLAYER_TURN" && !ownTurn && plannedHand ? "has-planner" : ""} ${me?.ready ? "is-ready" : ""} ${betting ? "is-betting" : ""} ${g.phase === "INSURANCE" ? "is-insurance" : ""}`}
    >
      <div className="table-info">
        <span>
          Blackjack <b>européen</b> <span className="table-tag">8 jeux</span>
        </span>
        <div>
          <span>Manche {g.round.toString().padStart(2, "0")}</span>
          <span>
            {g.shoe.remaining} / {g.shoe.total} cartes
          </span>
          <span>{seats.filter((s) => s.playerId).length}/7 sièges</span>
        </div>
      </div>
      <div ref={tableRef} className="felt">
        <div className="felt-ring" />
        <div className="felt-surface">
          <DealProvider sequence={g.dealing} offset={offset}>
            <div className="dealer">
              <span className="eyebrow">
                Croupier{" "}
                {g.dealer.length > 0 && (
                  <b className="dealer-total">{points(g.dealer)}</b>
                )}
              </span>
              {g.dealer.length ? (
                <Cards cards={g.dealer} />
              ) : (
                <div className="dealer-empty">♠</div>
              )}
            </div>
            {!g.dealer.length && (
              <div className="table-brand">
                velvet<span>.</span>
                <small>BLACKJACK · {g.rules.blackjackPayout}:1</small>
              </div>
            )}
            <div className="table-status" role="status">
              <span className="green-dot" />
              {status}
              {g.deadline && (
                <span className={`timer ${seconds <= 5 ? "urgent" : ""}`}>
                  <Clock3 size={15} />
                  {seconds}s
                </span>
              )}
            </div>
            <div className="seats">
              {seats.map((seat) => (
                <TableSeat
                  key={seat.id}
                  seat={seat}
                  player={room.players.find((p) => p.id === seat.playerId)}
                  mine={seat.playerId === id}
                  active={g.turn?.seatId === seat.id}
                  selected={selected === seat.id && seat.playerId === id}
                  phase={g.phase}
                  draft={drafts[seat.id]}
                  zone={zone}
                  onBet={onBet}
                  onSelect={onSelect}
                  onInspect={setInspected}
                  activeCardId={hand?.cards[0]?.id}
                  act={act}
                  pending={pending || (betting && !!me?.ready)}
                  connected={connected}
                />
              ))}
            </div>
          </DealProvider>
        </div>
      </div>
      {resultSeats.some((s) =>
        s.sideBets?.some((b) => (b.payout ?? 0) > 0),
      ) && (
        <section className="blackjack-payouts" aria-label="Gains des side bets">
          {resultSeats.flatMap((s) =>
            (s.sideBets ?? [])
              .filter((b) => (b.payout ?? 0) > 0)
              .map((b) => (
                <div
                  className="payout-card"
                  key={`${g.round}-${s.id}-${b.type}`}
                  role="status"
                >
                  <span className="payout-symbol" aria-hidden="true">
                    ✦
                  </span>
                  <div className="payout-description">
                    <strong>
                      {b.type === "PP" ? "Perfect Pairs" : "21+3"} gagné !
                    </strong>
                    <span>
                      Siège {s.id} · {b.label} · {b.payout}:1
                    </span>
                  </div>
                  <div className="payout-amount">
                    <strong>
                      +{money(b.amount * b.payout!)} <small>jetons</small>
                    </strong>
                    <span>
                      Bénéfice net ·{" "}
                      {money(b.returned ?? b.amount * (1 + b.payout!))}{" "}
                      {b.returned === undefined ? "à reverser" : "reversés"},
                      mise incluse
                    </span>
                  </div>
                </div>
              )),
          )}
        </section>
      )}
      <div
        className={`action-dock ${ownTurn ? "your-turn" : ""} ${betting ? "betting-dock" : ""}`}
      >
        {ownTurn && hand ? (
          <>
            <div className="active-hand-preview">
              <Cards cards={hand.cards} />
            </div>
            <div className="action-context">
              <strong>
                À vous de jouer <span className="timer">{seconds}s</span>
              </strong>
              <span>
                Siège {g.turn!.seatId} · Main {g.turn!.hand + 1} ·{" "}
                <b>{points(hand.cards)} points</b> · Mise {money(hand.bet)}
              </span>
            </div>
            {hand.plannedError && (
              <small role="alert" className="planned-error">
                {hand.plannedError}
              </small>
            )}
            <div className="action-buttons gameplay-actions">
              {(["HIT", "STAND", "DOUBLE", "SPLIT"] as const).map((type, i) => (
                <button
                  key={type}
                  className={type === "HIT" ? "primary" : "secondary"}
                  disabled={
                    pending ||
                    !connected ||
                    !seconds ||
                    (type === "DOUBLE" &&
                      (hand.cards.length !== 2 ||
                        (hand.split && !g.rules.doubleAfterSplit) ||
                        (me?.balance ?? 0) < hand.bet)) ||
                    (type === "SPLIT" &&
                      (!canSplitCards(hand.cards) ||
                        (activeSeat?.hands.length ?? 0) > g.rules.maxSplits ||
                        (me?.balance ?? 0) < hand.bet))
                  }
                  onClick={() =>
                    type === "DOUBLE"
                      ? setDoubleChoice(!doubleChoice)
                      : act(type, {
                          seatId: g.turn!.seatId,
                          hand: g.turn!.hand,
                        })
                  }
                >
                  {["Tirer", "Rester", "Doubler", "Séparer"][i]}
                </button>
              ))}
            </div>
            {doubleChoice && (
              <div
                className="double-options"
                role="group"
                aria-label="Choisir le double"
              >
                <span>Dernière carte du double</span>
                {[false, true].map((faceDown) => (
                  <button
                    key={String(faceDown)}
                    className="secondary"
                    disabled={pending || !connected || !seconds}
                    onClick={() => {
                      act("DOUBLE", {
                        seatId: g.turn!.seatId,
                        hand: g.turn!.hand,
                        faceDown,
                      });
                      setDoubleChoice(false);
                    }}
                  >
                    {faceDown ? "Face cachée" : "Face visible"}
                  </button>
                ))}
                <button
                  className="icon-button"
                  aria-label="Annuler le double"
                  onClick={() => setDoubleChoice(false)}
                >
                  ×
                </button>
              </div>
            )}
          </>
        ) : betting ? (
          <>
            <div className="betting-dock-heading">
              <span className="dock-countdown">Mises sans limite de temps</span>
              <strong>
                {selectedSeat
                  ? `Siège ${selected} · ${total} jetons`
                  : "Choisissez une place sur le tapis"}
              </strong>
              <span className="bet-limits">
                Mise max : {money(g.rules.maxBet)} · PP / 21+3 :{" "}
                {money(g.rules.maxSideBet ?? 200)} chacun
              </span>
            </div>
            {!me?.ready && (
              <ChipPicker
                value={chip}
                onChange={setChip}
                values={[2, 5, 10, 25, 50, 100, 500]}
                max={g.rules.maxBet}
              />
            )}
            <div className="repeat-bet-controls">
              <button
                className="primary ready-bets"
                disabled={
                  pending || !connected || !seats.some((s) => s.playerId === id)
                }
                onClick={setReady}
              >
                {me?.ready ? "Annuler prêt" : "Je suis prêt"}
              </button>
              <button
                className="secondary"
                disabled={
                  pending ||
                  !connected ||
                  me?.ready ||
                  !previous ||
                  previous.round >= g.round
                }
                onClick={repeatBets}
              >
                Répéter la mise
              </button>
              <button
                className="text-button"
                disabled={
                  pending ||
                  !connected ||
                  (!seats.some((s) => s.playerId === id && s.bet > 0) &&
                    !Object.values(drafts).some((b) =>
                      Object.values(b).some(Boolean),
                    )) ||
                  me?.ready
                }
                onClick={() => clearBets()}
              >
                Effacer les mises
              </button>
              {betFeedback && (
                <span role="status" className="bet-feedback">
                  {betFeedback}
                </span>
              )}
            </div>
            <div className="betting-dock-actions">
              {room.hostId === id && canStart && (
                <button
                  className="primary start-deal"
                  disabled={pending || !connected || !canStart}
                  onClick={() => act("START")}
                >
                  Lancer la manche
                </button>
              )}
              <button
                className="secondary undo-zone"
                disabled={
                  pending || !connected || !history[zone]?.length || !!me?.ready
                }
                onClick={undo}
              >
                <Undo2 size={17} />
                <span>
                  Annuler le dernier jeton ·{" "}
                  {zone.endsWith("MAIN") ? "Mise" : zone.split("-")[1]}
                </span>
              </button>
              <button
                className="icon-button"
                aria-label="Effacer les mises du siège sélectionné"
                disabled={pending || !selectedSeat || !!me?.ready}
                onClick={() => clearBets(selected)}
              >
                <Trash2 size={18} />
              </button>
              <button
                className="primary confirm-bet"
                disabled={
                  pending ||
                  !connected ||
                  !selectedSeat ||
                  !!me?.ready ||
                  ((currentDraft.MAIN ?? 0) < g.rules.minBet &&
                    !(
                      (currentDraft.MAIN ?? 0) === 0 &&
                      selectedSeat.bet > 0 &&
                      total === 0
                    )) ||
                  total >
                    (me?.balance ?? 0) +
                      Object.values(seatWagers(selectedSeat)).reduce(
                        (n, v) => n + (v ?? 0),
                        0,
                      ) ||
                  !!me?.ready
                }
                onClick={confirm}
              >
                Miser siège {selected}
              </button>
            </div>
            {selectedSeat && !selectedSeat.bet && (
              <button
                className="text-button release-seat"
                disabled={pending}
                onClick={() => act("LEAVE_SEAT", { seatId: selected })}
              >
                Libérer ce siège
              </button>
            )}
          </>
        ) : g.phase === "INSURANCE" ? (
          <div className="insurance-actions">
            <div className="action-context">
              <strong>
                Assurance <span className="timer">{seconds}s</span>
              </strong>
              <span>Mise facultative · payée 2:1</span>
            </div>
            {seats
              .filter(
                (s) => s.playerId === id && s.insurance?.decision === "PENDING",
              )
              .map((s) => (
                <div
                  key={s.id}
                  className="insurance-offer"
                  aria-label={`Assurance siège ${s.id}`}
                >
                  <b>
                    Siège {s.id} · {s.bet / 2} jetons
                  </b>
                  <div>
                    <button
                      className="primary"
                      disabled={
                        pending ||
                        !connected ||
                        !seconds ||
                        (me?.balance ?? 0) < s.bet / 2
                      }
                      onClick={() => act("TAKE_INSURANCE", { seatId: s.id })}
                    >
                      Prendre l’assurance
                    </button>
                    <button
                      className="secondary"
                      disabled={pending || !connected || !seconds}
                      onClick={() => act("DECLINE_INSURANCE", { seatId: s.id })}
                    >
                      Refuser
                    </button>
                  </div>
                </div>
              ))}
            {!seats.some(
              (s) => s.playerId === id && s.insurance?.decision === "PENDING",
            ) && <span>En attente des décisions des autres joueurs.</span>}
          </div>
        ) : waiting ? (
          <>
            <div className="action-context">
              {g.phase === "ROUND_END" && !!me?.hands.length ? (
                <>
                  <GainBanner
                    profit={profit}
                    returned={returned}
                    round={g.round}
                  />
                  <div className="hand-payout-summary">
                    {resultSeats.flatMap((s) =>
                      s.hands.map((h, i) => (
                        <span
                          key={`${s.id}-${h.id ?? i}`}
                          className={(h.profit ?? 0) > 0 ? "won" : ""}
                        >
                          Siège {s.id} · Main {i + 1} · {statusText(h)} :{" "}
                          <b>
                            {(h.profit ?? 0) > 0 ? "+" : ""}
                            {money(h.profit ?? 0)} jetons net
                          </b>
                        </span>
                      )),
                    )}
                  </div>
                </>
              ) : (
                <strong>Votre table vous attend</strong>
              )}
              <span>
                {room.hostId === id
                  ? "Ouvrez les mises pour la prochaine manche."
                  : "L’hôte va ouvrir les mises."}
              </span>
            </div>
            {room.hostId === id && (
              <button
                className="primary"
                disabled={pending || !connected || !canOpen}
                onClick={() => act("START")}
              >
                {g.round ? "Nouvelle manche" : "Ouvrir les mises"}
              </button>
            )}
            {selectedSeat && (
              <button
                className="text-button release-seat"
                disabled={pending}
                onClick={() => act("LEAVE_SEAT", { seatId: selected })}
              >
                Libérer ce siège
              </button>
            )}
          </>
        ) : g.phase === "PLAYER_TURN" && plannedHand && plannedSeat && me ? (
          <>
            <div className="action-context">
              <strong>
                Préparer mon tour <span className="timer">{seconds}s</span>
              </strong>
              <select
                aria-label="Main à préparer"
                value={plannedHand.id}
                onChange={(e) => setPlannedHandId(e.target.value)}
              >
                {nextHands.map((h) => (
                  <option key={h.id} value={h.id}>
                    Siège {h.seatId} · {points(h.cards)} points
                  </option>
                ))}
              </select>
            </div>
            <PlannedActions
              hand={plannedHand}
              seat={plannedSeat}
              player={me}
              rules={g.rules}
              act={act}
              pending={pending || !connected}
            />
          </>
        ) : (
          <div className="action-context">
            <strong>{status}</strong>
            <span>Les actions apparaîtront ici à votre tour.</span>
          </div>
        )}
      </div>
      {inspected !== null &&
        (() => {
          const seat = seats.find((s) => s.id === inspected);
          if (!seat) return null;
          const player = room.players.find((p) => p.id === seat.playerId);
          return (
            <Modal
              title={`Siège ${seat.id} · ${player?.name ?? "Libre"}`}
              onClose={() => setInspected(null)}
            >
              <p>Solde : {money(player?.balance ?? 0)} jetons</p>
              <div className="inspected-hands">
                {seat.hands.map((h, i) => (
                  <div key={i}>
                    <h3>
                      Main {i + 1} · {points(h.cards)} points
                    </h3>
                    <Cards cards={h.cards} />
                    {g.phase === "PLAYER_TURN" &&
                      player?.id === id &&
                      h.status === "PLAYING" &&
                      h.id !== hand?.id && (
                        <PlannedActions
                          hand={h}
                          seat={seat}
                          player={player}
                          rules={g.rules}
                          act={act}
                          pending={pending || !connected}
                        />
                      )}
                    <p>
                      Mise {money(h.bet)} · {statusText(h) || "En jeu"}
                      {h.profit !== undefined
                        ? ` · ${h.profit >= 0 ? "+" : ""}${money(h.profit)} jetons`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
              {seat.insurance && (
                <p>
                  Assurance :{" "}
                  {seat.insurance.decision === "TAKEN"
                    ? `${seat.insurance.amount} jetons`
                    : seat.insurance.decision === "DECLINED"
                      ? "Refusée"
                      : "À décider"}
                  {seat.insurance.profit !== undefined
                    ? ` · net ${seat.insurance.profit}`
                    : ""}
                </p>
              )}
              {(seat.sideBets ?? []).map((b) => (
                <p key={b.type}>
                  {b.type} · {b.amount} jetons · {b.label ?? "En attente"}
                  {b.profit !== undefined ? ` · net ${b.profit}` : ""}
                </p>
              ))}
            </Modal>
          );
        })()}
      <div className="table-footnote">
        Table privée · Crédits fictifs{" "}
        <span>Assurance · Perfect Pairs · 21+3</span>
      </div>
    </main>
  );
}
