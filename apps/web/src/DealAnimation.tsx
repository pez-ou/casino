import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { DealSequence, DealEvent } from "../../../packages/shared/types";
import { useReducedMotion } from "./GameUI";
type DealAnimationState = {
  events: Map<string, DealEvent>;
  cardMs: number;
  offset: number;
  shoe: React.RefObject<HTMLDivElement | null>;
  reduced: boolean;
};
export const DealContext = createContext<DealAnimationState | null>(null);
export function DealProvider({
  sequence,
  offset,
  children,
}: {
  sequence?: DealSequence;
  offset: number;
  children: React.ReactNode;
}) {
  const shoe = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const audio = useRef<AudioContext | null>(null);
  const heard = useRef(`${sequence?.round}:${sequence?.events.length ?? 0}`);
  useEffect(() => {
    const unlock = () => {
      if (localStorage.getItem("velvet.sound") !== "on") return;
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("velvet-preferences", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("velvet-preferences", unlock);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    const key = `${sequence?.round}:${sequence?.events.length ?? 0}`;
    if (heard.current === key) return;
    heard.current = key;
    const last = sequence?.events.at(-1),
      ctx = audio.current;
    if (
      !last ||
      !ctx ||
      localStorage.getItem("velvet.sound") !== "on" ||
      Date.now() + offset - last.at > sequence!.cardMs
    )
      return;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(650, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      180,
      ctx.currentTime + 0.05,
    );
    gain.gain.setValueAtTime(0.025, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.06);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, [sequence, offset]);
  const value = useMemo(
    () => ({
      events: new Map(
        sequence?.events.map((event) => [event.card.id, event]) ?? [],
      ),
      cardMs: sequence?.cardMs ?? 320,
      offset,
      shoe,
      reduced,
    }),
    [sequence, offset, reduced],
  );
  return (
    <DealContext.Provider value={value}>
      <div
        ref={shoe}
        className="dealing-shoe"
        aria-label="Sabot de distribution"
      >
        <span>♠</span>
        <small>Sabot</small>
      </div>
      {children}
    </DealContext.Provider>
  );
}
export function useCardFlight(
  ref: React.RefObject<HTMLDivElement | null>,
  cards: import("../../../packages/shared/types").Card[],
) {
  const context = useContext(DealContext);
  const animated = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!context || !ref.current) return;
    if (context.reduced)
      for (const node of Array.from(ref.current.querySelectorAll(".card")))
        for (const animation of node.getAnimations()) animation.cancel();

    for (const card of cards) {
      const event = context.events.get(card.id);
      if (!event || animated.current.has(`${event.round}:${card.id}`)) continue;
      animated.current.add(`${event.round}:${card.id}`);
      const elapsed = Date.now() + context.offset - event.at;
      if (context.reduced || elapsed >= context.cardMs || elapsed < 0) continue;
      const node = Array.from(
        ref.current.querySelectorAll<HTMLElement>(".card"),
      ).find((n) => n.dataset.cardId === card.id);
      const from = context.shoe.current?.getBoundingClientRect(),
        to = node?.getBoundingClientRect();
      if (!node || !from || !to) continue;
      const scale = Number(
        getComputedStyle(node).getPropertyValue("--table-fit") || 1,
      );
      node.classList.add("dealt-card");
      const final = getComputedStyle(node).transform;
      const flight = node.animate(
        [
          {
            transform: `translate(${(from.left - to.left) / scale}px, ${(from.top - to.top) / scale}px) rotate(-18deg) scale(.85)`,
            opacity: 0.25,
          },
          { transform: final === "none" ? "rotate(0deg)" : final, opacity: 1 },
        ],
        {
          duration: context.cardMs,
          delay: -elapsed,
          easing: "cubic-bezier(.2,.65,.25,1)",
        },
      );
      flight.onfinish = () => flight.cancel();
    }
    return () => {
      /* Flights finish independently of timer or network rerenders. */
    };
  }, [context, cards, ref]);
}
