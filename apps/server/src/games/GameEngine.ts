import type {
  Action,
  GameState,
  Player,
} from "../../../../packages/shared/types.js";
export interface GameEngine {
  state(): GameState;
  removePlayer?(player: Player): void;
  start(players: Player[]): void;
  action(player: Player, action: Action, players: Player[]): void;
  tick(players: Player[], now: number): boolean;
}
export class GameRegistry {
  private factories = new Map<string, () => GameEngine>();
  register(type: string, factory: () => GameEngine) {
    this.factories.set(type, factory);
  }
  create(type: string) {
    const factory = this.factories.get(type);
    if (!factory) throw new Error("Jeu indisponible");
    return factory();
  }
}

export class UserError extends Error {}
