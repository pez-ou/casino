import type { Hand, Player, Seat, Rules } from "../../../packages/shared/types";
import { canSplitCards } from "../../../packages/shared/blackjack";
import type { Act } from "./GameUI";
export const decisionLabel = {
  HIT: "Tirer",
  STAND: "Rester",
  DOUBLE: "Doubler",
  SPLIT: "Séparer",
};
export function PlannedActions({
  hand,
  seat,
  player,
  act,
  pending,
  rules = { maxSplits: 3, doubleAfterSplit: true },
}: {
  hand: Hand;
  seat: Seat;
  player: Player;
  act: Act;
  pending: boolean;
  rules?: Pick<Rules, "maxSplits" | "doubleAfterSplit">;
}) {
  return (
    <div
      className="planned-controls"
      aria-label={`Décision anticipée siège ${seat.id}`}
    >
      <div className="action-buttons gameplay-actions">
        {(["HIT", "STAND", "DOUBLE", "SPLIT"] as const).map((type) => (
          <button
            key={type}
            className={
              hand.plannedAction?.type === type ? "primary" : "secondary"
            }
            aria-pressed={hand.plannedAction?.type === type}
            disabled={
              pending ||
              (type === "DOUBLE" &&
                (hand.cards.length !== 2 ||
                  player.balance < hand.bet ||
                  (hand.split && !rules.doubleAfterSplit))) ||
              (type === "SPLIT" &&
                (hand.cards.length !== 2 ||
                  !canSplitCards(hand.cards) ||
                  seat.hands.length > rules.maxSplits ||
                  player.balance < hand.bet))
            }
            onClick={() =>
              act("PLAN_ACTION", {
                seatId: seat.id,
                handId: hand.id,
                decision: type,
              })
            }
          >
            {decisionLabel[type]}
          </button>
        ))}
      </div>
      {hand.plannedAction?.type === "DOUBLE" && (
        <label className="planned-double">
          <input
            type="checkbox"
            checked={!!hand.plannedAction.faceDown}
            disabled={pending}
            onChange={(e) =>
              act("PLAN_ACTION", {
                seatId: seat.id,
                handId: hand.id,
                decision: "DOUBLE",
                faceDown: e.target.checked,
              })
            }
          />
          Double face cachée
        </label>
      )}
      <div className="planned-feedback">
        <span>
          {hand.plannedAction
            ? `Action prévue : ${decisionLabel[hand.plannedAction.type]}`
            : "Choisissez une action pour votre prochain tour."}
        </span>
        {hand.plannedAction && (
          <button
            className="text-button"
            disabled={pending}
            onClick={() =>
              act("CANCEL_PLAN", { seatId: seat.id, handId: hand.id })
            }
          >
            Annuler l’action prévue
          </button>
        )}
      </div>
    </div>
  );
}
