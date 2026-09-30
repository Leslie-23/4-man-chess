"use client";

import type { PlayerColor } from "@fourman/game-engine";
import type { RoomView } from "@fourman/shared";
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { materialSeries, standings } from "../lib/standings";

const W = 300;
const H = 140;
const PAD = { top: 10, right: 8, bottom: 20, left: 26 };
// White and black armies vanish against a matching page, so their lines get an ink casing.
const CASED = new Set<PlayerColor>(["white", "black"]);

/** Live ranking of the seats, and how each army's material went round by round. */
export function Standings({ room }: { room: RoomView }) {
  const rows = useMemo(() => standings(room), [room]);
  const series = useMemo(() => materialSeries(room), [room]);
  const who = (c: PlayerColor) => room.seats[c]?.name ?? c;

  return (
    <div className="standings">
      <ol className="standings-list">
        {rows.map((r) => (
          <li key={r.color} className={r.out ? "out" : undefined}>
            <span className="standings-place">{r.place}</span>
            <span className={`line-key ${r.color}`} aria-hidden />
            <span className="standings-name">{who(r.color)}</span>
            <span className="standings-stat" title="Material left (pawn = 1)">{r.out ? "out" : r.material}</span>
            <span className="standings-stat muted" title="Value of pieces taken">+{r.took}</span>
          </li>
        ))}
      </ol>
      <p className="standings-legend muted">Material left · pieces taken</p>
      {series.plies.length > 1 ? (
        <MaterialChart series={series} colors={rows.map((r) => r.color)} who={who} rounds={room.players.length} />
      ) : (
        <p className="muted small-text">The chart of who's ahead starts after the first round.</p>
      )}
    </div>
  );
}

interface ChartProps {
  series: ReturnType<typeof materialSeries>;
  /** In standings order, so the tooltip lists the leader first. */
  colors: PlayerColor[];
  who: (c: PlayerColor) => string;
  rounds: number;
}

function MaterialChart({ series, colors, who, rounds }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const { plies, values } = series;
  const top = Math.max(1, ...colors.flatMap((c) => values[c] ?? []));
  const last = plies.length - 1;
  const x = (i: number) => PAD.left + (i / last) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const path = (c: PlayerColor) => (values[c] ?? []).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const roundOf = (i: number) => Math.ceil(plies[i]! / rounds);

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    setHover(Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * last));
  };
  const step = (event: KeyboardEvent<SVGSVGElement>) => {
    const move = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!move) return;
    event.preventDefault();
    setHover((h) => Math.min(last, Math.max(0, (h ?? last) + move)));
  };
  const at = hover === null ? null : Math.min(last, Math.max(0, hover));

  return (
    <figure className="chart">
      <figcaption className="label">Material by round</figcaption>
      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Material each army had after every round. Use the arrow keys to read values."
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
                {Math.round(v)}
              </text>
            </g>
          ))}
          <text className="chart-tick" x={PAD.left} y={H - 5}>Start</text>
          <text className="chart-tick" x={W - PAD.right} y={H - 5} textAnchor="end">Round {roundOf(last)}</text>
          {at !== null && <line className="chart-crosshair" x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} />}
          {colors.map((c) => (
            <g key={c}>
              {CASED.has(c) && <path d={path(c)} className="chart-casing" />}
              <path d={path(c)} className={`chart-line ${c}`} />
              {at !== null && <circle cx={x(at)} cy={y(values[c]![at]!)} r={3.5} className={`chart-dot ${c}`} />}
            </g>
          ))}
        </svg>
        {at !== null && (
          <div className="chart-tip" style={{ left: `${(x(at) / W) * 100}%` }} data-side={x(at) > W / 2 ? "left" : "right"}>
            <span className="chart-tip-head">{at === 0 ? "Start" : `Round ${roundOf(at)}`}</span>
            {[...colors]
              .sort((a, b) => values[b]![at]! - values[a]![at]!)
              .map((c) => (
                <span key={c} className="chart-tip-row">
                  <span className={`line-key ${c}`} aria-hidden />
                  <strong>{values[c]![at]}</strong> {who(c)}
                </span>
              ))}
          </div>
        )}
      </div>
    </figure>
  );
}
