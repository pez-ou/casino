import { memo, useEffect, useRef } from "react";
import type { RoomState } from "../../../packages/shared/types";
import { WHEEL, color } from "../../../packages/shared/roulette";
import { useReducedMotion } from "./GameUI";
export const Wheel = memo(function Wheel({
  room,
  offset,
}: {
  room: RoomState;
  offset: number;
}) {
  const r = room.game.roulette!,
    reduced = useReducedMotion();
  const rotor = useRef<SVGGElement>(null),
    ball = useRef<SVGCircleElement>(null);
  const step = 360 / 37;
  useEffect(() => {
    let frame = 0;
    const base =
      (((r.spinStartedAt ?? r.bettingEndsAt) - r.bettingStartedAt) / 8000) *
      360;
    const index = WHEEL.indexOf(r.winningNumber ?? 0);
    const target = base + 1080 + index * step;
    const delta = ((((target - base) % 360) + 360) % 360) - 360 * 7;
    const animate = () => {
      const time = Date.now() + offset;
      const spinning = r.spinStartedAt !== undefined;
      const t = spinning
        ? Math.max(
            0,
            Math.min(
              1,
              (time - r.spinStartedAt!) / (r.spinEndsAt! - r.spinStartedAt!),
            ),
          )
        : 0;
      const eased = 1 - Math.pow(1 - t, 3);
      const rotation = reduced
        ? 0
        : spinning
          ? base + 1080 * eased
          : Math.max(0, ((time - r.bettingStartedAt) / 8000) * 360);
      const angle = reduced
        ? room.game.phase === "RESULT"
          ? index * step
          : 0
        : spinning
          ? base + delta * eased
          : Math.max(0, ((time - r.bettingStartedAt) / 8000) * 360);
      const radius = spinning ? 177 - 38 * Math.pow(t, 3) : 177;
      const rad = ((angle - 90) * Math.PI) / 180;
      rotor.current?.setAttribute("transform", `rotate(${rotation} 210 210)`);
      ball.current?.setAttribute("cx", String(210 + radius * Math.cos(rad)));
      ball.current?.setAttribute("cy", String(210 + radius * Math.sin(rad)));
      if (!reduced && !(spinning && t === 1))
        frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [
    r.spinStartedAt,
    r.spinEndsAt,
    r.bettingStartedAt,
    r.bettingEndsAt,
    r.winningNumber,
    room.game.phase,
    offset,
    reduced,
  ]);
  const polar = (angle: number, radius: number) => [
    210 + radius * Math.cos(((angle - 90) * Math.PI) / 180),
    210 + radius * Math.sin(((angle - 90) * Math.PI) / 180),
  ];
  return (
    <svg
      className="roulette-wheel"
      viewBox="0 0 420 420"
      role="img"
      aria-label="Roue européenne à 37 cases"
    >
      <defs>
        <radialGradient id="wood">
          <stop stopColor="#6d4a2c" />
          <stop offset="1" stopColor="#21180f" />
        </radialGradient>
        <radialGradient id="hub">
          <stop stopColor="#e2cc8e" />
          <stop offset="1" stopColor="#76603a" />
        </radialGradient>
      </defs>
      <circle
        cx="210"
        cy="210"
        r="204"
        fill="url(#wood)"
        stroke="#b9a476"
        strokeWidth="7"
      />
      <circle
        cx="210"
        cy="210"
        r="181"
        fill="#161c17"
        stroke="#a59569"
        strokeWidth="2"
      />
      <g ref={rotor} transform="rotate(0 210 210)">
        {WHEEL.map((n, i) => {
          const a = polar(i * step - step / 2, 157),
            b = polar(i * step + step / 2, 157),
            c = polar(i * step + step / 2, 118),
            d = polar(i * step - step / 2, 118),
            text = polar(i * step, 143);
          return (
            <g key={n}>
              <path
                d={`M${a} A157 157 0 0 1 ${b} L${c} A118 118 0 0 0 ${d} Z`}
                fill={
                  color(n) === "red"
                    ? "#a53e38"
                    : color(n) === "green"
                      ? "#267853"
                      : "#17221c"
                }
                stroke={
                  room.game.phase === "RESULT" && n === r.winningNumber
                    ? "#ffdf7b"
                    : "#a89b72"
                }
                strokeWidth={
                  room.game.phase === "RESULT" && n === r.winningNumber ? 4 : 1
                }
              />
              <text
                x={text[0]}
                y={text[1]}
                transform={`rotate(${i * step} ${text[0]} ${text[1]})`}
                fill="#fff6dd"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="13"
              >
                {n}
              </text>
            </g>
          );
        })}
        <circle
          cx="210"
          cy="210"
          r="116"
          fill="url(#wood)"
          stroke="#b8a06b"
          strokeWidth="3"
        />
        <path d="M120 210H300M210 120V300" stroke="#aa925f" strokeWidth="7" />
        <circle cx="210" cy="210" r="29" fill="url(#hub)" />
        <circle cx="210" cy="210" r="10" fill="#efdfac" />
      </g>
      <circle
        cx="210"
        cy="33"
        r="6"
        fill="#fff7df"
        stroke="#d2c8ac"
        strokeWidth="2"
        ref={ball}
        className="roulette-ball"
      />
    </svg>
  );
});
