import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Action, RoomState } from "../../../packages/shared/types";
import { SPOTS, color, type BetSpot } from "../../../packages/shared/roulette";
import { Wheel } from "./RouletteWheel";
import { ChipPicker, GainBanner, money } from "./GameUI";
import { ZoomIn } from "lucide-react";
type Props = {
  room: RoomState;
  id: string;
  now: number;
  offset: number;
  pending: boolean;
  act: (type: Action["type"], extra?: Partial<Action>) => void;
};
import {
  betTarget,
  spotKey as key,
  TABLE,
} from "../../../packages/shared/rouletteLayout";
export function RouletteTable({ room, id, now, offset, pending, act }: Props) {
  const g = room.game,
    r = g.roulette!;
  const [chip, setChip] = useState(25),
    [selected, setSelected] = useState<BetSpot>(SPOTS[0]);
  const [hovered, setHovered] = useState<BetSpot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(false),
    [scale, setScale] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current!;
    const resize = () =>
      setScale(
        el.clientWidth < 700 ? 0.85 : Math.min(1, el.clientWidth / TABLE.width),
      );
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (g.phase !== "RESULT" || r.winningNumber == null) return;
    const target = betTarget(SPOTS.find(s => s.type === "STRAIGHT" && s.numbers[0] === r.winningNumber)!);
    const el = scrollRef.current;
    if (el && target) el.scrollLeft = target.x * (zoom ? 1.2 : scale) - el.clientWidth / 2;
  }, [g.phase, r.winningNumber, scale, zoom]);
  const connected = room.players.filter((p) => p.connected);
  const votes = r.accelerationVotes.filter((v) =>
    connected.some((p) => p.id === v),
  );
  const voted = votes.includes(id);
  const preview = hovered ?? selected;
  const own = r.bets.filter((b) => b.playerId === id),
    total = own.reduce((n, b) => n + b.amount, 0);
  const open = g.phase === "BETTING" && now + offset < r.bettingEndsAt;
  const seconds = Math.max(
    0,
    Math.ceil(((g.deadline ?? 0) - now - offset) / 1000),
  );
  const place = (s: BetSpot) => {
    setSelected(s);
    act("ROULETTE_BET", { betType: s.type, numbers: s.numbers, amount: chip });
  };
  const beginDrag = (
    e: React.DragEvent,
    payload: { amount?: number; betId?: string },
  ) => {
    e.dataTransfer.setData(
      "application/x-velvet-chip",
      JSON.stringify(payload),
    );
    e.dataTransfer.effectAllowed = payload.betId ? "move" : "copy";
    setDragging(true);
  };
  const drop = (e: React.DragEvent, s: BetSpot) => {
    e.preventDefault();
    setDragging(false);
    if (!open || pending) return;
    try {
      const data = JSON.parse(
        e.dataTransfer.getData("application/x-velvet-chip"),
      );
      setSelected(s);
      setHovered(null);
      if (
        typeof data.betId === "string" &&
        own.some((b) => b.id === data.betId)
      )
        act("MOVE_BET", {
          betId: data.betId,
          betType: s.type,
          numbers: s.numbers,
        });
      else if (
        Number.isSafeInteger(data.amount) &&
        data.amount > 0 &&
        data.amount <= 10000
      )
        act("ROULETTE_BET", {
          betType: s.type,
          numbers: s.numbers,
          amount: data.amount,
        });
    } catch {
      /* Unrelated external drops never create a bet. */
    }
  };
  const amount = (s: BetSpot) =>
    own.filter((b) => key(b) === key(s)).reduce((n, b) => n + b.amount, 0);
  const stacks = useMemo(() => {
    const map = new Map<string, typeof own>();
    for (const bet of own) {
      const k = key(bet);
      map.set(k, [...(map.get(k) ?? []), bet]);
    }
    return map;
  }, [r.bets, id]);
  const token = (s: BetSpot) => {
    const bets = stacks.get(key(s)) ?? [];
    const total = bets.reduce((n, b) => n + b.amount, 0);
    if (!total) return null;
    const pos = betTarget(s);
    return (
      <span
        key={key(s)}
        className={`placed-chip chip-${s.type.toLowerCase()} ${key(selected) === key(s) ? "chip-selected" : ""}`}
        data-bet={key(s)}
        data-stack={Math.min(3, bets.length)}
        draggable={open && !pending}
        onDragStart={(e) => beginDrag(e, { betId: bets[bets.length - 1].id })}
        onDragEnd={() => setDragging(false)}
        onClick={() => {
          if (open && !pending) place(s);
        }}
        onMouseEnter={() => setHovered(s)}
        onMouseLeave={() => setHovered(null)}
        style={{ left: pos.x, top: pos.y + (s.type === "STRAIGHT" ? 18 : 0) }}
        aria-label={`${s.label} : ${total} crédits, ${bets.length} jetons`}
        title={`${s.label} · ${total} crédits · ${bets.length} jetons`}
      >
        {total < 1000
          ? total
          : new Intl.NumberFormat("fr-FR", {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(total)}
      </span>
    );
  };
  const previewEvents = (s: BetSpot) => ({
    onDragOver: (e: React.DragEvent) => {
      if (
        open &&
        !pending &&
        e.dataTransfer.types.includes("application/x-velvet-chip")
      ) {
        e.preventDefault();
        setHovered(s);
      }
    },
    onDrop: (e: React.DragEvent) => drop(e, s),
    onMouseEnter: () => setHovered(s),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(s),
    onBlur: () => setHovered(null),
  });
  const results = r.results[id];
  return (
    <main className="table-page roulette-page">
      <div className="table-info">
        <span>
          Roulette <b>européenne</b>{" "}
          <span className="table-tag">Un seul zéro</span>
        </span>
        <div>
          <span>Manche {g.round}</span>
          <span>
            {room.players.length} joueur{room.players.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <div className="roulette-layout">
        <section className="wheel-panel">
          <div
            className={`roulette-announcement ${open && seconds <= 5 ? "last-bets" : ""}`}
            role="status"
          >
            {open
              ? seconds <= 5
                ? `Dernières mises — ${seconds} seconde${seconds > 1 ? "s" : ""}`
                : "Placez vos mises"
              : g.phase === "RESULT"
                ? "Résultat officiel"
                : "Les jeux sont faits — Rien ne va plus"}
            <strong>{seconds}s</strong>
          </div>
          <div className="accelerate-round">
            <button
              className="secondary"
              disabled={!open || pending || seconds <= 10 || voted}
              onClick={() => act("ACCELERATE_ROUND")}
            >
              {voted ? "Vote enregistré" : "Accélérer le tour"}
            </button>
            <small>
              {open && seconds > 10
                ? `${votes.length}/${connected.length} votes · passage à 10 secondes.`
                : "Tous les joueurs doivent voter."}
            </small>
          </div>
          <Wheel room={room} offset={offset} />
          <div className="winning-number">
            {g.phase === "RESULT" ? (
              <>
                <span className={`number ${color(r.winningNumber!)}`}>
                  {r.winningNumber}
                </span>
                <b>
                  {color(r.winningNumber!) === "red"
                    ? "Rouge"
                    : color(r.winningNumber!) === "black"
                      ? "Noir"
                      : "Zéro"}
                </b>
              </>
            ) : (
              <span>
                Manche {g.round} · {open ? "La roue tourne" : "Bille en course"}
              </span>
            )}
          </div>
          {results && g.phase === "RESULT" && (
            <GainBanner
              profit={results.profit}
              returned={results.returned}
              round={g.round}
            />
          )}
          <div className="recent-rolls">
            <h3>Derniers numéros</h3>
            <div className="number-history">
              {r.history.slice(0, 10).map((n, i) => (
                <span key={i} className={`number ${color(n)}`}>
                  {n}
                </span>
              ))}
              {!r.history.length && (
                <span className="muted">La première bille arrive.</span>
              )}
            </div>
          </div>
        </section>
        <section className="betting-panel">
          <div className="tapis-heading">
            <h2>Le tapis</h2>
            <button
              className="secondary precision-toggle"
              aria-pressed={zoom}
              onClick={() => setZoom(!zoom)}
            >
              <ZoomIn size={17} /> {zoom ? "Vue normale" : "Précision"}
            </button>
          </div>
          <p className="tapis-hint">
            Choisissez un jeton, puis une case. Les points dorés ouvrent les
            paris entre les numéros.
          </p>
          <ChipPicker
            value={chip}
            onChange={setChip}
            values={[1, 5, 10, 25, 50, 100, 500]}
            max={10000}
            dragHandlers={(n) => ({
              draggable: open && !pending,
              onDragStart: (e) => {
                setChip(n);
                beginDrag(e, { amount: n });
              },
              onDragEnd: () => setDragging(false),
            })}
          />
          <div
            ref={scrollRef}
            className={`tapis-scroll ${zoom ? "zoomed" : ""}`}
            tabIndex={0}
            aria-label="Tapis défilable"
          >
            <div
              className="tapis-stage"
              style={{
                width: TABLE.width * (zoom ? Math.max(scale, 1.2) : scale),
                height: TABLE.height * (zoom ? Math.max(scale, 1.2) : scale),
              }}
            >
              <div
                className={`roulette-tapis ${dragging ? "dragging-chip" : ""} ${!open ? "is-closed" : ""}`}
                style={{
                  width: TABLE.width,
                  height: TABLE.height,
                  transform: `scale(${zoom ? Math.max(scale, 1.2) : scale})`,
                  transformOrigin: "top left",
                }}
              >
                <div
                  className={`zero-box ${g.phase === "RESULT" && r.winningNumber === 0 ? "winning-cell" : ""}`}
                >
                  <button
                    className={`zero-cell ${preview.numbers.includes(0) ? "covered" : ""}`}
                    aria-label="Plein 0"
                    disabled={!open || pending}
                    {...previewEvents(SPOTS[0])}
                    onClick={() => place(SPOTS[0])}
                  >
                    0
                  </button>
                </div>
                <div className="number-grid">
                  {Array.from({ length: 36 }, (_, i) => {
                    const n = 3 - Math.floor(i / 12) + (i % 12) * 3;
                    const s = SPOTS.find(
                      (s) => s.type === "STRAIGHT" && s.numbers[0] === n,
                    )!;
                    return (
                      <div
                        key={n}
                        className={`number-box ${color(n)} ${preview.numbers.includes(n) ? "covered" : ""} ${g.phase === "RESULT" && r.winningNumber === n ? "winning-cell" : ""}`}
                        data-number={n}
                      >
                        <button
                          className={`number-cell ${color(n)}`}
                          aria-label={`Plein ${n}`}
                          disabled={!open || pending}
                          {...previewEvents(s)}
                          onClick={() => place(s)}
                        >
                          {n}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {SPOTS.filter((s) => s.type !== "STRAIGHT").map((s) => {
                  const pos = betTarget(s),
                    inside = [
                      "SPLIT",
                      "STREET",
                      "CORNER",
                      "SIX_LINE",
                      "FIRST_FOUR",
                    ].includes(s.type);
                  return (
                    <button
                      key={key(s)}
                      data-bet={key(s)}
                      data-numbers={s.numbers.join(",")}
                      className={`${inside ? "inside-spot" : "outside-spot"} spot-${s.type.toLowerCase()} ${s.type === "RED" ? "red" : s.type === "BLACK" ? "black" : ""}`}
                      style={{
                        left: pos.x,
                        top: pos.y,
                        width: pos.width,
                        height: pos.height,
                      }}
                      title={`${s.label} · ${s.numbers.join(", ")} · ${s.payout}:1`}
                      aria-label={inside ? `${s.type} ${s.label}` : s.label}
                      disabled={!open || pending}
                      {...previewEvents(s)}
                      onClick={() => place(s)}
                    >
                      {inside ? (
                        <span className="target-dot" />
                      ) : s.type === "COLUMN" ? (
                        <>
                          2:1<small>{s.numbers[0]}e colonne</small>
                        </>
                      ) : (
                        s.label
                      )}
                    </button>
                  );
                })}
                <div className="chip-layer">{SPOTS.map(token)}</div>
              </div>
            </div>
          </div>
          <span className="pan-hint">
            ↔ Faites glisser le tapis pour explorer les numéros · Précision pour
            agrandir
          </span>
          <div className="bet-preview" aria-live="polite">
            <b>
              {preview.label} · {preview.payout}:1
            </b>
            <span className="preview-numbers">
              Numéros : {preview.numbers.join(", ")}
            </span>
            <span>
              Misé ici : {amount(preview)} · Gain net potentiel :{" "}
              {amount(preview) * preview.payout}
            </span>
          </div>
          <div className="precise-bet">
            <label>
              Choisir un pari précis
              <select
                aria-label="Choisir un pari précis"
                value={key(selected)}
                onChange={(e) => {
                  setHovered(null);
                  setSelected(SPOTS.find((s) => key(s) === e.target.value)!);
                }}
              >
                {SPOTS.map((s) => (
                  <option key={key(s)} value={key(s)}>
                    {
                      (
                        {
                          STRAIGHT: "Plein",
                          SPLIT: "Cheval",
                          STREET: "Transversale",
                          CORNER: "Carré",
                          SIX_LINE: "Sixain",
                          FIRST_FOUR: "Quatre premiers",
                          RED: "Rouge",
                          BLACK: "Noir",
                          EVEN: "Pair",
                          ODD: "Impair",
                          LOW: "Manque",
                          HIGH: "Passe",
                          DOZEN: "Douzaine",
                          COLUMN: "Colonne",
                        } as const
                      )[s.type]
                    }{" "}
                    · {s.label} · {s.payout}:1
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={!open || pending}
              onClick={() => place(selected)}
            >
              Miser {chip} sur ce pari
            </button>
          </div>
          <div className="bet-summary">
            <b>Total misé : {money(total)}</b>
            <span>{open ? "Mises ouvertes" : "Mises fermées"}</span>
          </div>
          <div className="action-buttons roulette-actions">
            <div className="mobile-bet-status"><b>{money(total)} engagés</b><span>{open ? `${seconds}s · Mises ouvertes` : "Mises fermées"}</span></div>
            {(
              [
                ["UNDO_BET", "Annuler dernière mise"],
                ["CLEAR_BETS", "Effacer les mises"],
                ["REPEAT_BETS", "Répéter les mises"],
              ] as const
            ).map(([type, label]) => (
              <button
                className="secondary"
                key={type}
                disabled={!open || pending}
                onClick={() => act(type)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="table-footnote">
        Table privée · Crédits fictifs
        <span>Tous les paris européens · 37 numéros</span>
      </div>
    </main>
  );
}
