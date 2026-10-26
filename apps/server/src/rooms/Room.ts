import type { RoomState } from "../../../../packages/shared/types.js";
import type { GameEngine } from "../games/GameEngine.js";
import type { Session } from "../sessions/Store.js";
export class Room {
  members: Session[] = [];
  version = 0;
  emptySince?: number;
  readonly bannedSessions = new Set<string>();
  readonly pendingExclusions = new Set<string>();
  private queue = Promise.resolve();
  constructor(
    public code: string,
    public gameType: string,
    public hostId: string,
    public engine: GameEngine,
  ) {}
  run<T>(job: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(job);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  state(): RoomState {
    const game = this.engine.state();
    const hide = (h: import("../../../../packages/shared/types.js").Hand) =>
      h.faceDown && !["ROUND_END", "SETTLEMENT"].includes(game.phase)
        ? {
            ...h,
            status: "STAND" as const,
            cards: h.cards.map((c, i) =>
              i === 2 ? { id: "hidden", rank: "?", suit: "?" } : c,
            ),
          }
        : h;
    return {
      serverTime: Date.now(),
      code: this.code,
      gameType: this.gameType,
      hostId: this.hostId,
      version: this.version,
      players: this.members.map((s) => ({
        ...s.player,
        exclusionPending: this.pendingExclusions.has(s.key),
        hands: s.player.hands.map(hide),
      })),
      game: {
        ...game,
        seats: game.seats?.map((s) => ({ ...s, hands: s.hands.map(hide) })),
      },
    };
  }
}
