"use client";

import type { GameState } from "@fourman/monopoly-engine";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { money, tokenColor } from "../lib/look";

const W = 300;
const H = 150;
const PAD = { top: 10, right: 8, bottom: 20, left: 38 };

/** Net worth by turn for everyone at the table, with a crosshair readout. */
export function WorthChart({ state, names }: { state: GameState; names: (id: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = state.worth;
  if (points.length < 2) return <p className="muted small">The chart of who's ahead starts after the first turn.</p>;

  const ids = state.players.map((p) => p.id);
  const last = points.length - 1;
  const top = Math.max(1, ...points.flatMap((p) => Object.values(p.values)));
  const x = (i: number) => PAD.left + (i / last) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const path = (id: string) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.values[id] ?? 0).toFixed(1)}`).join("");

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.min(last, Math.max(0, Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * last))));
  };
  const step = (e: KeyboardEvent<SVGSVGElement>) => {
    const move = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!move) return;
    e.preventDefault();
    setHover((h) => Math.min(last, Math.max(0, (h ?? last) + move)));
  };
  const at = hover;
  const ranked = at === null ? [] : [...ids].sort((a, b) => (points[at]!.values[b] ?? 0) - (points[at]!.values[a] ?? 0));

  return (
    <figure className="chart">
      <figcaption className="label">Net worth by turn</figcaption>
      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Each player's net worth over the game. Use the arrow keys to read values."
          tabIndex={0}
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onKeyDown={step}
          onBlur={() => setHover(null)}
        >
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="chart-tick" x={PAD.left - 5} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : Math.round(v)}
              </text>
            </g>
          ))}
          <text className="chart-tick" x={PAD.left} y={H - 5}>Turn {points[0]!.turn}</text>
          <text className="chart-tick" x={W - PAD.right} y={H - 5} textAnchor="end">Turn {points[last]!.turn}</text>
          {at !== null && <line className="chart-crosshair" x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} />}
          {ids.map((id) => (
            <g key={id}>
              <path d={path(id)} className="chart-line" style={{ stroke: tokenColor(id) }} />
              {at !== null && <circle cx={x(at)} cy={y(points[at]!.values[id] ?? 0)} r={3.5} className="chart-dot" style={{ fill: tokenColor(id) }} />}
            </g>
          ))}
        </svg>
        {at !== null && (
          <div className="chart-tip" style={{ left: `${(x(at) / W) * 100}%` }} data-side={x(at) > W / 2 ? "left" : "right"}>
            <span className="chart-tip-head">Turn {points[at]!.turn}</span>
            {ranked.map((id) => (
              <span key={id} className="chart-tip-row">
                <span className="line-key" style={{ background: tokenColor(id) }} aria-hidden />
                <strong>{money(points[at]!.values[id] ?? 0)}</strong> {names(id)}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
