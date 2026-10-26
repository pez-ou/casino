import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Player } from "../../../../packages/shared/types.js";
export type Session = {
  key: string;
  player: Player;
  room?: string;
  socket?: string;
  disconnectedAt?: number;
  seen: number;
  requests: Map<string, unknown>;
};
export class SessionStore {
  sessions = new Map<string, Session>();
  private file: string;
  constructor(file: string) {
    this.file = file;
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8"));
      for (const row of data) {
        row.player.connected = false;
        row.player.ready = false;
        row.player.hands = [];
        row.player.bet = 0;
        row.player.insuranceEscrow = 0;
        row.player.sideBetEscrow = 0;
        this.sessions.set(row.key, { ...row, requests: new Map() });
      }
    }
  }
  resolve(token?: string) {
    const key = token ? createHash("sha256").update(token).digest("hex") : "";
    const existing = this.sessions.get(key);
    if (existing) {
      existing.seen = Date.now();
      return { session: existing, token };
    }
    const fresh = randomBytes(32).toString("hex"),
      hash = createHash("sha256").update(fresh).digest("hex");
    const session: Session = {
      key: hash,
      seen: Date.now(),
      requests: new Map(),
      player: {
        id: randomUUID(),
        name: "Invité",
        balance: 10000,
        connected: false,
        ready: false,
        hands: [],
        bet: 0,
        stats: { hands: 0, wins: 0, blackjacks: 0, profit: 0, biggestWin: 0 },
      },
    };
    this.sessions.set(hash, session);
    return { session, token: fresh };
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(
      this.file + ".tmp",
      JSON.stringify(
        [...this.sessions.values()].map((s) => ({
          key: s.key,
          seen: s.seen,
          player: {
            ...s.player,
            balance:
              s.player.balance +
              (s.player.insuranceEscrow ?? 0) +
              (s.player.sideBetEscrow ?? 0) +
              s.player.hands
                .filter((h) => !h.result)
                .reduce((n, h) => n + h.bet, 0) +
              (s.player.hands.length ? 0 : s.player.bet),
          },
        })),
      ),
      { encoding: "utf8", flush: true },
    );
    renameSync(this.file + ".tmp", this.file);
    const directory = openSync(dirname(this.file), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
  gc() {
    for (const [key, s] of this.sessions)
      if (!s.socket && !s.room && Date.now() - s.seen > 30 * 86400000)
        this.sessions.delete(key);
  }
}
