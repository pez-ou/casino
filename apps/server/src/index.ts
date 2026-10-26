import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";
import { z } from "zod";
import pino from "pino";
import { BlackjackEngine } from "./games/blackjack/BlackjackEngine.js";
import { GameRegistry, UserError } from "./games/GameEngine.js";
import { Room } from "./rooms/Room.js";
import { SessionStore } from "./sessions/Store.js";
import { RouletteEngine } from "./games/roulette/RouletteEngine.js";
const env = z
  .object({
    PORT: z.coerce.number().default(3001),
    PUBLIC_ORIGIN: z.string().url().default("http://localhost:8097"),
    DATA_FILE: z.string().default("./data/accounts.json"),
    MAX_ROOMS: z.coerce.number().int().min(1).default(100),
    MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).default(12),
    MAX_PLAYERS: z.coerce.number().int().min(1).max(7).default(6),
    ROULETTE_BETTING_SECONDS: z.coerce.number().min(3).max(120).default(30),
    ROULETTE_SPIN_SECONDS: z.coerce.number().min(1).max(60).default(10),
    ROULETTE_RESULT_SECONDS: z.coerce.number().min(1).max(60).default(5),
    TURN_SECONDS: z.coerce.number().min(3).max(120).default(20),
    BETTING_SECONDS: z.coerce.number().min(3).max(120).default(20),
    DEAL_CARD_MS: z.coerce.number().int().min(250).max(400).default(320),
    DEAL_LEAD_MS: z.coerce.number().int().min(1000).max(2000).default(1200),
    MIN_BET: z.coerce.number().int().positive().default(10),
    MAX_BET: z.coerce.number().int().positive().default(2000),
    MAX_SPLITS: z.coerce.number().int().min(0).max(3).default(3),
    DOUBLE_AFTER_SPLIT: z.enum(["true", "false"]).default("true"),
    HIT_SOFT_17: z.enum(["true", "false"]).default("false"),
    BLACKJACK_PAYOUT: z.coerce
      .number()
      .refine((n) => [1, 1.5, 2].includes(n))
      .default(1.5),
    CUT_RATIO: z.coerce.number().min(0.2).max(0.5).default(0.25),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  })
  .parse(process.env);
const logger = pino({ redact: ["token", "key", "headers.authorization"] });
const store = new SessionStore(env.DATA_FILE);
const rooms = new Map<string, Room>();
const registry = new GameRegistry();
registry.register(
  "blackjack",
  () =>
    new BlackjackEngine({
      minBet: env.MIN_BET,
      maxBet: env.MAX_BET,
      maxSideBet: 200,
      maxPlayers: 7,
      maxSplits: env.MAX_SPLITS,
      doubleAfterSplit: env.DOUBLE_AFTER_SPLIT === "true",
      hitSoft17: env.HIT_SOFT_17 === "true",
      blackjackPayout: env.BLACKJACK_PAYOUT,
      turnSeconds: env.TURN_SECONDS,
      bettingSeconds: env.BETTING_SECONDS,
      dealCardMs: env.DEAL_CARD_MS,
      dealLeadMs: env.DEAL_LEAD_MS,
      cutRatio: env.CUT_RATIO,
    }),
);
registry.register(
  "roulette",
  () =>
    new RouletteEngine({
      betting: env.ROULETTE_BETTING_SECONDS,
      spin: env.ROULETTE_SPIN_SECONDS,
      result: env.ROULETTE_RESULT_SECONDS,
    }),
);
const app = express();
app.disable("x-powered-by");
if (env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(helmet());
app.use(rateLimit({ windowMs: 60000, limit: 120 }));
app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    uptime: process.uptime(),
    players: [...store.sessions.values()].filter((s) => s.socket).length,
    rooms: rooms.size,
  }),
);
const http = createServer(app);
const connections = new Map<string, number>();
const creation = new Map<string, { count: number; at: number }>();
const handshake = new Map<string, { count: number; at: number }>();
const io = new Server(http, {
  cors: { origin: env.PUBLIC_ORIGIN, methods: ["GET", "POST"] },
  maxHttpBufferSize: 8192,
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    cb(null, !origin || origin === env.PUBLIC_ORIGIN);
  },
});
const schema = z
  .object({
    requestId: z.string().uuid(),
    version: z.number().int().nonnegative().optional(),
    round: z.number().int().nonnegative().optional(),
    type: z.enum([
      "REFILL",
      "CREATE",
      "JOIN",
      "READY",
      "START",
      "BET",
      "HIT",
      "STAND",
      "DOUBLE",
      "SPLIT",
      "LEAVE",
      "TAKE_SEAT",
      "TAKE_INSURANCE",
      "DECLINE_INSURANCE",
      "LEAVE_SEAT",
      "BET_ON_SEAT",
      "ROULETTE_BET",
      "ACCELERATE_ROUND",
      "MOVE_BET",
      "UNDO_BET",
      "CLEAR_BETS",
      "REPEAT_BETS",
      "CANCEL_READY",
      "PLAN_ACTION",
      "CANCEL_PLAN",
      "KICK_PLAYER",
    ]),
    gameType: z.enum(["blackjack", "roulette"]).optional(),
    betId: z.string().min(1).max(80).optional(),
    seatId: z.number().int().min(1).max(7).optional(),
    hand: z.number().int().min(0).max(27).optional(),
    handId: z.string().uuid().optional(),
    decision: z.enum(["HIT", "STAND", "DOUBLE", "SPLIT"]).optional(),
    targetPlayerId: z.string().uuid().optional(),
    betType: z
      .enum([
        "STRAIGHT",
        "SPLIT",
        "STREET",
        "CORNER",
        "SIX_LINE",
        "FIRST_FOUR",
        "RED",
        "BLACK",
        "EVEN",
        "ODD",
        "LOW",
        "HIGH",
        "DOZEN",
        "COLUMN",
      ])
      .optional(),
    numbers: z.array(z.number().int().min(0).max(36)).max(18).optional(),
    name: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[\p{L}\p{N} _.-]+$/u)
      .optional(),
    code: z
      .string()
      .regex(/^[A-Z2-9]{6}$/)
      .optional(),
    amount: z.number().int().nonnegative().optional(),
    faceDown: z.boolean().optional(),
    sideBets: z
      .object({
        PP: z.number().int().nonnegative().optional(),
        "21+3": z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
function broadcast(r: Room) {
  r.version++;
  io.to(r.code).emit("room_state", r.state());
}
function remove(
  r: Room,
  s: typeof store.sessions extends Map<string, infer T> ? T : never,
) {
  r.engine.removePlayer?.(s.player);
  r.members = r.members.filter((m) => m !== s);
  s.room = undefined;
  s.player.ready = false;
  s.player.hands = [];
  s.player.bet = 0;
  if (r.hostId === s.player.id)
    r.hostId =
      (r.members.find((m) => m.player.connected) ?? r.members[0])?.player.id ??
      "";
  if (!r.members.length) r.emptySince = Date.now();
  broadcast(r);
}
function flushExclusions(r: Room) {
  const phase = r.engine.state().phase;
  const safe =
    r.gameType === "blackjack"
      ? ["WAITING_FOR_PLAYERS", "BETTING", "ROUND_END"].includes(phase)
      : phase === "RESULT" ||
        (phase === "BETTING" && Date.now() < (r.engine.state().deadline ?? 0));
  for (const member of [...r.members]) {
    if (
      !r.pendingExclusions.has(member.key) ||
      (!safe && member.player.bet > 0)
    )
      continue;
    if (
      r.gameType === "roulette" &&
      phase === "BETTING" &&
      member.player.bet > 0
    )
      r.engine.action(
        member.player,
        {
          type: "CLEAR_BETS",
          requestId: crypto.randomUUID(),
          round: r.engine.state().round,
        },
        r.members.map((s) => s.player),
      );
    const client = member.socket
      ? io.sockets.sockets.get(member.socket)
      : undefined;
    client?.leave(r.code);
    r.pendingExclusions.delete(member.key);
    remove(r, member);
    client?.emit("room_excluded", {
      code: r.code,
      pending: false,
      balance: member.player.balance,
      message:
        "L’hôte vous a exclu de ce salon. Vos crédits ont été conservés.",
    });
    store.save();
  }
}
io.use((socket, next) => {
  const ip =
    env.TRUST_PROXY === "true"
      ? String(
          socket.handshake.headers["x-forwarded-for"] ??
            socket.handshake.address,
        )
          .split(",")[0]
          .trim()
      : socket.handshake.address;
  socket.data.ip = ip;
  let bucket = handshake.get(ip);
  if (!bucket || Date.now() - bucket.at > 60000) {
    bucket = { count: 0, at: Date.now() };
    handshake.set(ip, bucket);
  }
  if (++bucket.count > 40 || store.sessions.size >= 10000)
    return next(new Error("Limite de sessions"));
  if ((connections.get(ip) ?? 0) >= env.MAX_CONNECTIONS_PER_IP)
    return next(new Error("Limite de connexions"));
  const token = socket.handshake.auth.token;
  if (
    token !== undefined &&
    (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
  )
    return next(new Error("Session invalide"));
  next();
});
io.on("connection", (socket) => {
  const ip = socket.data.ip;
  connections.set(ip, (connections.get(ip) ?? 0) + 1);
  const { session: s, token } = store.resolve(socket.handshake.auth.token);
  if (s.socket) {
    io.sockets.sockets.get(s.socket)?.emit("replaced");
    io.sockets.sockets.get(s.socket)?.disconnect(true);
  }
  s.socket = socket.id;
  s.player.connected = true;
  s.disconnectedAt = undefined;
  socket.emit("session", {
    token,
    playerId: s.player.id,
    balance: s.player.balance,
    roomCode: s.room ?? null,
  });
  logger.info({ playerId: s.player.id }, "connected");
  if (s.room) {
    const r = rooms.get(s.room);
    if (r) {
      socket.join(r.code);
      void r.run(() => broadcast(r));
    } else s.room = undefined;
  }
  let count = 0,
    window = Date.now();
  let inflight = 0;
  socket.on("action", async (raw, ack) => {
    if (typeof ack !== "function") return;
    if (Date.now() - window > 1000) {
      window = Date.now();
      count = 0;
    }
    if (++count > 12 || inflight >= 8)
      return ack({ ok: false, error: "Trop de requêtes" });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ playerId: s.player.id }, "invalid_payload");
      return ack({ ok: false, error: "Requête invalide" });
    }
    const a = parsed.data;
    inflight++;
    const perform = () => {
      if (s.socket !== socket.id) throw new UserError("Connexion remplacée");
      if (s.requests.has(a.requestId)) return s.requests.get(a.requestId);
      let r = s.room ? rooms.get(s.room) : undefined;
      if (a.type === "REFILL") {
        const amount = a.amount ?? 10000;
        if (amount < 1 || amount > 10000)
          throw new UserError("Choisissez entre 1 et 10 000 jetons");
        if (!Number.isSafeInteger(s.player.balance + amount))
          throw new UserError("Solde maximum atteint");
        s.player.balance += amount;
        store.save();
        if (r) broadcast(r);
        const result = { ok: true, balance: s.player.balance };
        s.requests.set(a.requestId, result);
        if (s.requests.size > 256)
          s.requests.delete(s.requests.keys().next().value!);
        return result;
      }
      if (a.type === "CREATE" || a.type === "JOIN") {
        if (r) throw new UserError("Quittez le salon actuel");
        if (!a.name) throw new UserError("Pseudo requis");
        if (a.type === "CREATE") {
          let bucket = creation.get(ip);
          if (!bucket || Date.now() - bucket.at > 3600000) {
            bucket = { count: 0, at: Date.now() };
            creation.set(ip, bucket);
          }
          if (bucket.count >= 10 || rooms.size >= env.MAX_ROOMS)
            throw new UserError("Limite de création de salons");
          bucket.count++;
          let code = "";
          do {
            code = Array.from(
              { length: 6 },
              () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
            ).join("");
          } while (rooms.has(code));
          r = new Room(
            code,
            a.gameType ?? "blackjack",
            s.player.id,
            registry.create(a.gameType ?? "blackjack"),
          );
          rooms.set(code, r);
          logger.info({ room: code }, "room_created");
        } else r = rooms.get(a.code ?? "");
        if (!r) throw new UserError("Salon introuvable");
        if (r.bannedSessions.has(s.key))
          throw new UserError(
            "Vous avez été exclu de ce salon pour cette session",
          );
        if (r.members.length >= 32) throw new UserError("Salon complet");
        s.player.name = a.name;
        s.room = r.code;
        r.emptySince = undefined;
        r.members.push(s);
        socket.join(r.code);
      } else {
        if (!r) throw new UserError("Aucun salon");
        if (
          ["HIT", "STAND", "DOUBLE", "SPLIT", "START", "LEAVE", "BET"].includes(
            a.type,
          ) &&
          a.version !== r.version
        )
          throw new UserError("État ancien, réessayez");
        if (
          [
            "TAKE_INSURANCE",
            "DECLINE_INSURANCE",
            "BET_ON_SEAT",
            "ROULETTE_BET",
            "ACCELERATE_ROUND",
            "MOVE_BET",
            "UNDO_BET",
            "CLEAR_BETS",
            "REPEAT_BETS",
            "READY",
            "CANCEL_READY",
            "PLAN_ACTION",
            "CANCEL_PLAN",
          ].includes(a.type) &&
          a.round !== r.engine.state().round
        )
          throw new UserError("Manche ancienne, réessayez");
        if (a.type === "LEAVE") {
          if (
            !(r.gameType === "roulette" && s.player.bet === 0) &&
            !["WAITING_FOR_PLAYERS", "ROUND_END", "BETTING"].includes(
              r.engine.state().phase,
            )
          )
            throw new UserError("Quittez après la manche");
          socket.leave(r.code);
          remove(r, s);
          const result = { ok: true, left: true };
          s.requests.set(a.requestId, result);
          return result;
        }
        if (a.type === "KICK_PLAYER") {
          if (r.hostId !== s.player.id)
            throw new UserError("Seul l’hôte peut exclure un joueur");
          const target = r.members.find(
            (m) => m.player.id === a.targetPlayerId,
          );
          if (!target || target === s)
            throw new UserError("Joueur invalide pour l’exclusion");
          r.bannedSessions.add(target.key);
          r.pendingExclusions.add(target.key);
          flushExclusions(r);
          if (r.pendingExclusions.has(target.key) && target.socket)
            io.sockets.sockets.get(target.socket)?.emit("room_excluded", {
              code: r.code,
              pending: true,
              message:
                "L’hôte a demandé votre exclusion. Elle sera appliquée après le règlement de vos mises.",
            });
        } else if (
          (a.type === "READY" || a.type === "CANCEL_READY") &&
          r.gameType === "blackjack"
        ) {
          r.engine.action(
            s.player,
            a,
            r.members.map((m) => m.player),
          );
        } else if (a.type === "READY") {
          if (
            !["WAITING_FOR_PLAYERS", "ROUND_END"].includes(
              r.engine.state().phase,
            )
          )
            throw new UserError("Manche en cours");
          s.player.ready = !s.player.ready;
        } else if (a.type === "START") {
          if (r.hostId !== s.player.id)
            throw new UserError("Seul l’hôte peut lancer");
          const remaining = r.engine.state().shoe.remaining;
          r.engine.start(r.members.map((m) => m.player));
          if (r.engine.state().shoe.remaining > remaining)
            logger.info({ room: r.code }, "reshuffle");
          logger.info(
            { room: r.code, round: r.engine.state().round },
            "round_started",
          );
        } else
          r.engine.action(
            s.player,
            a,
            r.members.map((m) => m.player),
          );
      }
      flushExclusions(r!);
      store.save();
      broadcast(r!);
      const result = { ok: true };
      s.requests.set(a.requestId, result);
      if (s.requests.size > 256)
        s.requests.delete(s.requests.keys().next().value!);
      return result;
    };
    try {
      const r = s.room
        ? rooms.get(s.room)
        : a.type === "JOIN"
          ? rooms.get(a.code ?? "")
          : undefined;
      ack(await (r ? r.run(perform) : Promise.resolve().then(perform)));
    } catch (error) {
      const message =
        error instanceof UserError
          ? error.message
          : "Erreur interne. Consultez l’état de la table.";
      logger.warn({ playerId: s.player.id, type: a.type }, "action_rejected");
      ack({ ok: false, error: message });
    } finally {
      inflight--;
    }
  });
  socket.on("disconnect", () => {
    connections.set(ip, Math.max(0, (connections.get(ip) ?? 1) - 1));
    if (!connections.get(ip)) connections.delete(ip);
    if (s.socket !== socket.id) return;
    s.socket = undefined;
    s.player.connected = false;
    s.disconnectedAt = Date.now();
    logger.info({ playerId: s.player.id }, "disconnected");
    const r = s.room ? rooms.get(s.room) : undefined;
    if (r)
      void r.run(() => {
        if (r.engine instanceof BlackjackEngine) r.engine.disconnect(s.player);
        store.save();
        broadcast(r);
      });
  });
  socket.on("error", () =>
    logger.warn({ playerId: s.player.id }, "socket_error"),
  );
});
const timer = setInterval(() => {
  for (const r of rooms.values())
    void r
      .run(() => {
        const before = r.engine.state();
        if (
          r.engine.tick(
            r.members.map((s) => s.player),
            Date.now(),
          )
        ) {
          flushExclusions(r);
          store.save();
          broadcast(r);
          if (r.engine.state().phase === "ROUND_END") {
            store.save();
            logger.info({ room: r.code, round: before.round }, "round_ended");
          }
        }
        if (
          ["WAITING_FOR_PLAYERS", "ROUND_END", "BETTING"].includes(
            r.engine.state().phase,
          ) ||
          (r.gameType === "roulette" && r.engine.state().phase === "BETTING")
        )
          for (const s of [...r.members])
            if (
              s.disconnectedAt &&
              s.player.bet === 0 &&
              Date.now() - s.disconnectedAt >= 60000
            )
              remove(r, s);
        if (r.emptySince && Date.now() - r.emptySince > 900000) {
          rooms.delete(r.code);
          logger.info({ room: r.code }, "room_deleted");
        }
      })
      .catch((error) =>
        logger.error({ message: error.message }, "room_tick_failed"),
      );
  store.gc();
  for (const [ip, b] of handshake)
    if (Date.now() - b.at > 60000) handshake.delete(ip);
  for (const [ip, b] of creation)
    if (Date.now() - b.at > 3600000) creation.delete(ip);
}, 100);
app.use(
  (
    _err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => res.status(500).json({ error: "Erreur serveur" }),
);
http.listen(env.PORT, "0.0.0.0", () =>
  logger.info({ port: env.PORT }, "listening"),
);
function shutdown() {
  clearInterval(timer);
  store.save();
  io.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
