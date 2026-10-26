import React, { memo, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  History,
  Settings2,
  Users,
  BookOpen,
  X,
  Coins,
} from "lucide-react";
import type { Action, Card, RoomState } from "../../../packages/shared/types";
import { sideBetPayouts } from "../../../packages/shared/blackjack";
import { useCardFlight } from "./DealAnimation";
export type Act = (
  type: Action["type"],
  extra?: Partial<Action>,
) => Promise<boolean>;
export const money = (n: number) => n.toLocaleString("fr-FR");
export function points(cards: Card[]) {
  if (cards.some((c) => c.rank === "?")) return "?";
  let total = 0,
    aces = 0;
  for (const c of cards) {
    total +=
      c.rank === "A"
        ? 11
        : ["J", "Q", "K"].includes(c.rank)
          ? 10
          : Number(c.rank);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}
export const Cards = memo(function Cards({ cards }: { cards: Card[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useCardFlight(ref, cards);
  return (
    <div
      className="cards"
      ref={ref}
      style={{ "--card-count": cards.length } as React.CSSProperties}
      aria-label={cards
        .map((c) =>
          c.rank === "?" ? "Carte face cachée" : `${c.rank} ${c.suit}`,
        )
        .join(", ")}
    >
      {cards.map((c, i) => (
        <div
          key={c.id}
          data-card-id={c.id}
          className={`card ${["♥", "♦"].includes(c.suit) ? "red" : ""} ${c.rank === "?" ? "card-back" : ""}`}
          style={{ "--card-index": i } as React.CSSProperties}
        >
          {c.rank === "?" ? (
            <b>♠</b>
          ) : (
            <>
              <span>
                {c.rank}
                <small>{c.suit}</small>
              </span>
              <b>{c.suit}</b>
              <span className="corner">
                {c.rank}
                <small>{c.suit}</small>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
});
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="casino-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Fermer" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
export function useReducedMotion() {
  const read = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    localStorage.getItem("velvet.motion") === "reduce";
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(read());
    media.addEventListener("change", update);
    window.addEventListener("velvet-preferences", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("velvet-preferences", update);
    };
  }, []);
  return reduced;
}
export function CasinoHeader({
  room,
  id,
  balance,
  connected,
  pending,
  act,
  onHome,
  onAddChips,
}: {
  room: RoomState | null;
  id: string;
  balance: number;
  connected: boolean;
  pending: boolean;
  act: Act;
  onHome: () => void;
  onAddChips: () => void;
}) {
  const [panel, setPanel] = useState<string | null>(null),
    [copied, setCopied] = useState(false);
  const [motion, setMotion] = useState(
    localStorage.getItem("velvet.motion") !== "reduce",
  );
  const [sound, setSound] = useState(
    localStorage.getItem("velvet.sound") === "on",
  );
  useEffect(() => setPanel(null), [room?.code]);
  const me = room?.players.find((p) => p.id === id);
  const waiting =
    room && ["WAITING_FOR_PLAYERS", "ROUND_END"].includes(room.game.phase);
  const canLeave =
    !room ||
    (room.gameType === "roulette"
      ? !me?.bet
      : waiting || room.game.phase === "BETTING");
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "full" : "reduce";
  }, [motion]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <>
      <header className="casino-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!room) onHome();
          }}
        >
          <span className="brand-icon">♠</span>velvet
          <span className="brand-dot">.</span>
        </a>
        {room && (
          <button
            className="header-back"
            disabled={pending || !connected || !canLeave}
            onClick={() => act("LEAVE")}
            title={canLeave ? "Retour au lobby" : "Disponible après la manche"}
          >
            <ArrowLeft size={17} />
            <span>Lobby</span>
          </button>
        )}
        <div className="header-game">
          {room ? (
            <>
              <span>
                {room.gameType === "roulette" ? "Roulette" : "Blackjack"}
              </span>
              <small>EUROPÉEN{room.gameType === "roulette" ? "NE" : ""}</small>
            </>
          ) : (
            <span>Le club entre amis</span>
          )}
        </div>
        {room && (
          <button
            className="room-code"
            aria-label="Copier le code"
            onClick={() =>
              navigator.clipboard
                .writeText(room.code)
                .then(() => setCopied(true))
                .catch(() => setPanel("Invitation"))
            }
          >
            <span>{room.code}</span>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
        <div className="wallet">
          <Coins size={18} />
          <div>
            <b>{money(me?.balance ?? balance)}</b>
            <small>jetons fictifs</small>
          </div>
        </div>
        <button
          className="refill-button"
          disabled={pending || !connected}
          aria-label="Ajouter des jetons"
          title="Ouvrir le salon Ajouter des jetons"
          onClick={onAddChips}
        >
          Ajouter des jetons
        </button>
        <button
          className="icon-button"
          aria-label="Paramètres"
          onClick={() => setPanel("Paramètres")}
        >
          <Settings2 size={20} />
        </button>
      </header>
      {room && (
        <div className="room-strip">
          <h2>Salon {room.code}</h2>
          <span className={`connection-state ${connected ? "" : "offline"}`}>
            {connected ? "Table privée" : "Reconnexion…"}
          </span>
          <div className="panel-tabs">
            {[
              ["Joueurs", Users],
              ["Règles", BookOpen],
              ["Historique", History],
            ].map(([title, Icon]) => {
              const I = Icon as typeof Users;
              return (
                <button
                  key={String(title)}
                  onClick={() => setPanel(String(title))}
                >
                  <I size={16} />
                  <span>
                    {String(title)}
                    {title === "Joueurs" ? ` · ${room.players.length}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {panel && (
        <Modal title={panel} onClose={() => setPanel(null)}>
          {panel === "Paramètres" ? (
            <>
              <label className="setting-row">
                <span>
                  Animations légères
                  <small>
                    Les préférences de votre appareil sont respectées.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={motion}
                  onChange={(e) => {
                    setMotion(e.target.checked);
                    localStorage.setItem(
                      "velvet.motion",
                      e.target.checked ? "full" : "reduce",
                    );
                    window.dispatchEvent(new Event("velvet-preferences"));
                  }}
                />
              </label>
              <label className="setting-row">
                <span>
                  <b>Son de distribution</b>
                  <small>
                    Un son discret à chaque carte, désactivé par défaut.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={sound}
                  onChange={(e) => {
                    setSound(e.target.checked);
                    localStorage.setItem(
                      "velvet.sound",
                      e.target.checked ? "on" : "off",
                    );
                    window.dispatchEvent(new Event("velvet-preferences"));
                  }}
                />
              </label>
              <p className="muted">Crédits fictifs, sans valeur monétaire.</p>
              {room && (
                <button
                  className="secondary"
                  disabled={pending || !canLeave}
                  onClick={() => {
                    act("LEAVE");
                    setPanel(null);
                  }}
                >
                  Quitter le salon
                </button>
              )}
            </>
          ) : panel === "Invitation" ? (
            <p>
              Partagez le code <strong>{room?.code}</strong> avec vos amis.
            </p>
          ) : (
            room && (
              <RoomPanel
                room={room}
                id={id}
                panel={panel}
                act={act}
                pending={pending}
              />
            )
          )}
        </Modal>
      )}
    </>
  );
}
function RoomPanel({
  room,
  id,
  panel,
  act,
  pending,
}: {
  act: Act;
  pending: boolean;
  room: RoomState;
  id: string;
  panel: string;
}) {
  const me = room.players.find((p) => p.id === id),
    g = room.game;
  if (panel === "Joueurs")
    return (
      <>
        <div className="player-list">
          {room.players.map((p) => (
            <div className="roster" key={p.id}>
              <span className="avatar">{p.name[0]}</span>
              <div>
                <b>
                  {p.name}
                  {p.id === id ? " · vous" : ""}
                </b>
                <small>
                  {p.id === room.hostId ? "Hôte" : "Joueur"} ·{" "}
                  {p.exclusionPending
                    ? "Exclusion après la manche"
                    : !p.connected
                      ? "Absent"
                      : g.phase === "BETTING" && room.gameType === "blackjack"
                        ? p.ready
                          ? "Prêt"
                          : p.bet
                            ? "En train de miser"
                            : "Sans mise · observateur"
                        : "Connecté"}
                </small>
              </div>
              <strong>{money(p.balance)}</strong>
              {room.hostId === id && p.id !== id && (
                <button
                  className="text-button kick-player"
                  disabled={pending || p.exclusionPending}
                  aria-label={`Exclure ${p.name}`}
                  onClick={() => act("KICK_PLAYER", { targetPlayerId: p.id })}
                >
                  {p.exclusionPending ? "À la fin" : "Exclure"}
                </button>
              )}
            </div>
          ))}
        </div>
        <h3>Votre session</h3>
        <div className="session-stats">
          <div>
            <strong>{me?.stats.hands ?? 0}</strong>
            <span>Mains jouées</span>
          </div>
          <div>
            <strong>{money(me?.stats.profit ?? 0)}</strong>
            <span>Résultat net</span>
          </div>
          <div>
            <strong>{me?.stats.blackjacks ?? 0}</strong>
            <span>Blackjacks</span>
          </div>
        </div>
      </>
    );
  if (panel === "Historique")
    return g.roulette ? (
      <>
        <h3>20 derniers numéros</h3>
        <div className="number-history">
          {g.roulette.history.map((n, i) => (
            <span className="history-number" key={i}>
              {n}
            </span>
          ))}
        </div>
        <p>
          {g.roulette.roundsPlayed} manches jouées. Cet historique ne prédit pas
          les prochains résultats.
        </p>
      </>
    ) : (
      <div className="history">
        {g.history.length ? (
          g.history.map((h, i) => <p key={i}>{h}</p>)
        ) : (
          <p>Aucune main terminée pour le moment.</p>
        )}
      </div>
    );
  if (g.roulette)
    return (
      <>
        <h3>Roulette européenne · un seul zéro</h3>
        <p>
          Choisissez un jeton, puis cliquez sur un numéro ou une zone. Les
          points dorés indiquent les intersections. Le mode Précision agrandit
          le tapis ; le sélecteur de pari permet de choisir chaque combinaison
          au clavier et au toucher.
        </p>
        <p>
          Un jeton existant peut être glissé vers une autre cible pendant les
          mises. Déplacer une pile déplace son dernier jeton.
        </p>
        <div className="payout-table">
          {[
            ["Plein", "35:1"],
            ["Cheval", "17:1"],
            ["Transversale", "11:1"],
            ["Carré / quatre premiers", "8:1"],
            ["Sixain", "5:1"],
            ["Douzaine / colonne", "2:1"],
            ["Rouge / noir / pair / impair / manque / passe", "1:1"],
          ].map(([label, payout]) => (
            <div key={label}>
              <span>{label}</span>
              <b>{payout}</b>
            </div>
          ))}
        </div>
        <p>
          Les mises ferment à la fin du compte à rebours. L’accélération
          nécessite l’accord de tous les joueurs connectés.
        </p>
      </>
    );
  return (
    <>
      <h3>Blackjack européen · 8 jeux</h3>
      <p>
        Le croupier reçoit sa deuxième carte après les joueurs. Il{" "}
        {g.rules.hitSoft17 ? "tire" : "reste"} à 17 souple. Blackjack payé{" "}
        {g.rules.blackjackPayout}:1. Assurance payée 2:1.
      </p>
      <p>
        Mise principale : {money(g.rules.minBet)} à {money(g.rules.maxBet)}{" "}
        jetons. Chaque side bet : jusqu’à {money(g.rules.maxSideBet ?? 200)}{" "}
        jetons. Un blackjack du croupier perd aussi les doubles et les splits.
      </p>
      <p>
        Vous pouvez séparer deux cartes de même valeur, y compris les 10,
        valets, dames et rois. Double face cachée : la carte est révélée quand
        le croupier termine.
      </p>
      <h3>Side bets · paiements</h3>
      <p>
        PP utilise vos deux premières cartes. 21+3 ajoute la carte visible du
        croupier. Ces paris restent indépendants du résultat du blackjack.
      </p>
      {(["PP", "21+3"] as const).map((type) => (
        <React.Fragment key={type}>
          <h4>{type === "PP" ? "Perfect Pairs" : "21+3"}</h4>
          <div className="payout-table">
            {sideBetPayouts[type].map(([label, payout]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{payout}:1</b>
              </div>
            ))}
          </div>
        </React.Fragment>
      ))}
      <p>
        Perfect pair : même valeur et même enseigne. Colored pair : même valeur,
        deux cartes rouges ou deux noires d’enseignes différentes. Mixed pair :
        même valeur, une rouge et une noire.
      </p>
      <p>
        Suited trips : trois cartes identiques. Straight flush : suite de même
        enseigne. Three of a kind : brelan. Straight : suite. Flush : même
        enseigne. As : A-2-3 ou Q-K-A. Le ratio indique le gain net ; la mise
        gagnante est rendue.
      </p>
    </>
  );
}
export function ChipPicker({
  value,
  onChange,
  values = [10, 25, 50, 100, 500],
  max = 2000,
  extra,
  dragHandlers,
}: {
  value: number;
  onChange: (n: number) => void;
  values?: number[];
  max?: number;
  extra?: React.ReactNode;
  dragHandlers?: (n: number) => React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const [custom, setCustom] = useState(false),
    [draft, setDraft] = useState("25");
  const valid =
    Number.isSafeInteger(Number(draft)) &&
    Number(draft) > 0 &&
    Number(draft) <= max;
  return (
    <div className="chip-picker">
      <div className="chip-options">
        {values.map((n) => (
          <button
            key={n}
            className={`casino-chip denomination chip-${n} ${value === n ? "selected" : ""}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            {...dragHandlers?.(n)}
          >
            {n}
          </button>
        ))}
        <button
          className="custom-chip"
          aria-label="Montant personnalisé"
          aria-expanded={custom}
          onClick={() => setCustom(!custom)}
        >
          {!values.includes(value) ? value : "+"}
        </button>
      </div>
      {extra}
      {custom && (
        <form
          className="custom-chip-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) {
              onChange(Number(draft));
              setCustom(false);
            }
          }}
        >
          <label>
            Valeur du jeton
            <input
              aria-label="Valeur du jeton"
              inputMode="numeric"
              type="number"
              min={1}
              max={max}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={!valid}>
            Choisir
          </button>
        </form>
      )}
    </div>
  );
}
export function GainBanner({
  profit,
  returned,
  round,
}: {
  profit: number;
  returned: number;
  round: number;
}) {
  return (
    <div
      key={round}
      className={`win-banner ${profit > 0 ? "victory" : profit < 0 ? "loss" : "push"}`}
      role="status"
    >
      <strong>
        {profit > 0
          ? `+${money(profit)} jetons gagnés !`
          : profit < 0
            ? `${money(profit)} jetons`
            : "Égalité · mises récupérées"}
      </strong>
      <span>{money(returned)} jetons reversés · résultat net</span>
    </div>
  );
}
