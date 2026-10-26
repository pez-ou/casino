import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  ArrowUpRight,
  ArrowLeft,
  Users,
  ShieldCheck,
  Plus,
} from "lucide-react";
import type { Action, RoomState } from "../../../packages/shared/types";
import "./style.css";
import { RouletteTable } from "./RouletteTable";
import { BlackjackTable } from "./BlackjackTable";
import { CasinoHeader, Modal, money } from "./GameUI";
const socket = io({
  autoConnect: false,
  auth: { token: localStorage.getItem("velvet.token") || undefined },
});
function App() {
  const [gameType, setGameType] = useState<"blackjack" | "roulette">(
    "blackjack",
  );
  const [page, setPage] = useState("home"),
    [room, setRoom] = useState<RoomState | null>(null),
    [id, setId] = useState(""),
    [balance, setBalance] = useState(10000),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [name, setName] = useState(localStorage.getItem("velvet.name") || ""),
    [code, setCode] = useState(""),
    [now, setNow] = useState(Date.now()),
    [serverOffset, setServerOffset] = useState(0),
    [replaced, setReplaced] = useState(false);
  const [addingChips, setAddingChips] = useState(false);
  const [chipAmount, setChipAmount] = useState("10000");
  const [chipSuccess, setChipSuccess] = useState("");
  const amount = Number(chipAmount);
  const validAmount =
    Number.isInteger(amount) && amount >= 1 && amount <= 10000;
  const openChips = () => {
    setChipSuccess("");
    setAddingChips(true);
  };
  useEffect(() => {
    let ownId = "";
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () =>
      setError("Connexion indisponible. Nouvelle tentative…"),
    );
    socket.on("session", (s) => {
      localStorage.setItem("velvet.token", s.token);
      socket.auth = { token: s.token };
      ownId = s.playerId;
      setId(s.playerId);
      if (!s.roomCode) {
        setRoom(null);
        setPage((old) => (old === "table" ? "lobby" : old));
      }
      setBalance(s.balance);
      setError("");
    });
    socket.on("room_state", (s: RoomState) => {
      setServerOffset(s.serverTime - Date.now());
      const self = s.players.find((p) => p.id === ownId);
      if (self) setBalance(self.balance);
      setRoom((old) =>
        old && old.code === s.code && old.version > s.version ? old : s,
      );
      setPage("table");
    });
    socket.on(
      "room_excluded",
      (event: {
        code: string;
        pending: boolean;
        message: string;
        balance?: number;
      }) => {
        setError(event.message);
        if (event.balance !== undefined) setBalance(event.balance);
        if (!event.pending) {
          setRoom(null);
          setPage("lobby");
          setPending(false);
        }
      },
    );
    socket.on("replaced", () => {
      setReplaced(true);
      setError("Votre session est ouverte dans un autre onglet.");
      socket.disconnect();
    });
    socket.connect();
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(t);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
  const act = useCallback(
    (type: Action["type"], extra: Partial<Action> = {}) => {
      if (pending || !connected) return Promise.resolve(false);
      setPending(true);
      setError("");
      return new Promise<boolean>((resolve) =>
        socket.timeout(5000).emit(
          "action",
          {
            requestId: crypto.randomUUID(),
            type,
            ...(room ? { version: room.version, round: room.game.round } : {}),
            ...extra,
          },
          (
            err: unknown,
            res: {
              ok: boolean;
              error?: string;
              left?: boolean;
              balance?: number;
            },
          ) => {
            setPending(false);
            if (!err && res?.ok && res.balance !== undefined)
              setBalance(res.balance);
            if (err)
              setError(
                "Réponse interrompue. Vérifiez l’état de la table avant de réessayer.",
              );
            else if (!res.ok) setError(res.error || "Action refusée");
            else if (res.left) {
              setRoom(null);
              setPage("lobby");
            } else localStorage.setItem("velvet.name", name);
            resolve(!err && !!res?.ok);
          },
        ),
      );
    },
    [pending, connected, room, name],
  );
  return (
    <>
      <CasinoHeader
        room={room}
        id={id}
        balance={balance}
        connected={connected}
        pending={pending}
        act={act}
        onHome={() => setPage("home")}
        onAddChips={openChips}
      />
      {addingChips && (
        <Modal title="Ajouter des jetons" onClose={() => setAddingChips(false)}>
          <p>Choisissez entre 1 et 10 000 jetons fictifs par ajout.</p>
          <p>
            Votre solde : <strong>{money(balance)} jetons</strong>
          </p>
          <form
            className="chips-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!validAmount || pending || !connected) return;
              setChipSuccess("");
              if (await act("REFILL", { amount }))
                setChipSuccess(
                  `${money(amount)} jetons ajoutés à votre solde.`,
                );
            }}
          >
            <label htmlFor="chip-amount">Nombre de jetons</label>
            <input
              id="chip-amount"
              type="number"
              inputMode="numeric"
              min="1"
              max="10000"
              step="1"
              required
              value={chipAmount}
              onChange={(event) => {
                setChipAmount(event.target.value);
                setChipSuccess("");
              }}
            />
            <button
              className="primary"
              type="submit"
              disabled={!validAmount || pending || !connected}
            >
              {pending ? "Ajout en cours…" : "Confirmer l’ajout"}
            </button>
            {chipSuccess && <p role="status">{chipSuccess}</p>}
          </form>
        </Modal>
      )}
      {!room && (
        <div className="notice">
          <ShieldCheck size={14} /> Le casino entre amis · Crédits fictifs, sans
          valeur monétaire
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button aria-label="Fermer le message" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {page === "home" && (
        <main className="home">
          <div className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="green-dot" /> VOTRE TABLE, VOS AMIS
              </div>
              <h1>
                Les bonnes soirées
                <br />
                commencent <em>ici.</em>
              </h1>
              <p>
                L’ambiance du casino. La complicité des amis.
                <br />
                Installez-vous à une table privée et jouez, simplement.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setGameType("blackjack");
                  setPage("lobby");
                }}
              >
                Créer ma table <ArrowUpRight size={19} />
              </button>
              <div className="hero-detail">
                <Users size={16} /> Salons privés <span>·</span> 10 000 crédits
                pour jouer
              </div>
            </div>
            <div
              className="hero-art"
              aria-label="Cartes de blackjack sur un tapis"
            >
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="art-label">LE CLUB EST OUVERT</div>
              <div className="art-card back-card">♠</div>
              <div className="art-card ace">
                <span>
                  A<small>♠</small>
                </span>
                <b>♠</b>
              </div>
              <div className="art-card king">
                <span>
                  K<small>♥</small>
                </span>
                <b>♥</b>
              </div>
              <div className="chip chip-one">
                V<br />
                <strong>100</strong>
              </div>
              <div className="chip chip-two">
                V<br />
                <strong>500</strong>
              </div>
              <div className="art-caption">
                Un peu de chance. Beaucoup de bons moments.
              </div>
            </div>
          </div>
          <div className="section-title">
            <div>
              <div className="eyebrow">LE LOBBY</div>
              <h2>À quoi joue-t-on ce soir ?</h2>
            </div>
            <span>Une table pour chaque envie</span>
          </div>
          <section className="chips-lounge">
            <div>
              <h2>Ajouter des jetons</h2>
              <p>
                Votre salon de recharge · De 1 à 10 000 jetons fictifs par
                ajout.
              </p>
            </div>
            <button className="primary" onClick={openChips}>
              <Plus size={18} /> Ajouter des jetons
            </button>
          </section>
          <div className="game-grid">
            <button
              className="game-tile blackjack"
              onClick={() => {
                setGameType("blackjack");
                setPage("lobby");
              }}
            >
              <div className="tile-top">
                <span className="badge available">
                  <span className="green-dot" /> DISPONIBLE
                </span>
                <span>01</span>
              </div>
              <div className="mini-cards">
                <span>A ♠</span>
                <span>K ♥</span>
              </div>
              <div className="tile-bottom">
                <div>
                  <h3>Blackjack</h3>
                  <p>Européen · 8 jeux · Tables privées</p>
                </div>
                <ArrowUpRight />
              </div>
            </button>
            <button
              className="game-tile roulette"
              onClick={() => {
                setGameType("roulette");
                setPage("lobby");
              }}
            >
              <div className="tile-top">
                <span className="badge available">DISPONIBLE</span>
                <span>02</span>
              </div>
              <div className="roulette-art">✺</div>
              <div className="tile-bottom">
                <div>
                  <h3>Roulette</h3>
                  <p>Européenne · 37 numéros · Tables privées</p>
                </div>
                <ArrowUpRight />
              </div>
            </button>
            <button
              className="game-tile poker"
              onClick={() => setPage("poker")}
            >
              <div className="tile-top">
                <span className="badge">À VENIR</span>
                <span>03</span>
              </div>
              <div className="poker-art">
                ♣ <span>♦</span> ♠
              </div>
              <div className="tile-bottom">
                <div>
                  <h3>Poker</h3>
                  <p>Vos meilleures poker faces, bientôt.</p>
                </div>
                <ArrowUpRight />
              </div>
            </button>
          </div>
          <div className="bottom-note">
            <ShieldCheck size={22} />
            <div>
              <b>Le plaisir du jeu, rien de plus.</b>
              <p>
                Crédits fictifs — aucune valeur monétaire. Un espace pour se
                retrouver.
              </p>
            </div>
            <span>100% FAKE MONEY</span>
          </div>
        </main>
      )}
      {page === "lobby" && (
        <main className="lobby">
          <button className="back" onClick={() => setPage("home")}>
            <ArrowLeft size={16} /> Tous les jeux
          </button>
          <div className="eyebrow">
            {gameType === "roulette"
              ? "ROULETTE EUROPÉENNE"
              : "BLACKJACK EUROPÉEN"}
          </div>
          <h1>Votre soirée commence.</h1>
          <p>
            Une table privée, un code à partager et vos amis autour du tapis.
          </p>
          <label className="name-field">
            Votre pseudo
            <input
              maxLength={24}
              placeholder="Ex. Camille"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="lobby-grid">
            <section>
              <span className="panel-icon">
                <Plus />
              </span>
              <h2>Ouvrir une table</h2>
              <p>Vous êtes l’hôte. Invitez vos amis avec le code du salon.</p>
              <button
                className="primary"
                disabled={pending || !connected || name.trim().length < 2}
                onClick={() => act("CREATE", { name: name.trim(), gameType })}
              >
                Créer le salon <ArrowUpRight size={18} />
              </button>
            </section>
            <section>
              <span className="panel-icon">
                <Users />
              </span>
              <h2>Rejoindre des amis</h2>
              <p>La table vous attend. Entrez le code reçu de votre hôte.</p>
              <input
                aria-label="Code du salon"
                maxLength={6}
                placeholder="X7KD2P"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button
                className="secondary"
                disabled={
                  pending ||
                  !connected ||
                  name.trim().length < 2 ||
                  code.length !== 6
                }
                onClick={() => act("JOIN", { name: name.trim(), code })}
              >
                Rejoindre la table <ArrowUpRight size={18} />
              </button>
            </section>
          </div>
        </main>
      )}
      {(page === "roulette" || page === "poker") && (
        <main className="placeholder">
          <div className="roulette-art">{page === "roulette" ? "✺" : "♠"}</div>
          <div className="eyebrow">
            {page === "roulette" ? "EN CONSTRUCTION" : "À VENIR"}
          </div>
          <h1>{page === "roulette" ? "Roulette" : "Poker"}</h1>
          <p>Une nouvelle façon de jouer entre amis arrive bientôt.</p>
          <button className="primary" onClick={() => setPage("home")}>
            Retour aux jeux <ArrowLeft size={18} />
          </button>
        </main>
      )}
      {page === "table" && room?.gameType === "roulette" && (
        <RouletteTable
          room={room}
          id={id}
          now={now}
          offset={serverOffset}
          pending={pending}
          act={act}
        />
      )}
      {page === "table" && room?.gameType === "blackjack" && (
        <BlackjackTable
          room={room}
          id={id}
          now={now}
          offset={serverOffset}
          pending={pending}
          connected={connected}
          act={act}
          onError={setError}
        />
      )}
      {!room && (
        <footer>
          <span className="brand">velvet.</span>
          <span>Le casino entre amis.</span>
          <span>Crédits fictifs — aucune valeur monétaire</span>
        </footer>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
