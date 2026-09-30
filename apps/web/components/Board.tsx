"use client";

import {
  activePlayers,
  getLegalMoves,
  getVariant,
  isInCheck,
  type GameState,
  type MoveInput,
  type Piece,
  type PieceType,
  type PlayerColor,
  type PromotionPiece,
  type Variant,
} from "@fourman/game-engine";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BoardTheme } from "../lib/themes";

// U+FE0E asks for the text form, so phones don't swap the pawn for an emoji.
const GLYPH: Record<PieceType, string> = {
  king: "♚︎", queen: "♛︎", rook: "♜︎", bishop: "♝︎", knight: "♞︎", pawn: "♟︎",
};

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface BoardProps {
  state: GameState;
  /** Whose army is drawn at the bottom. */
  perspective: PlayerColor;
  theme: BoardTheme;
  /** The colour this device may move right now, if any. */
  playable?: PlayerColor | null;
  onMove?: (move: MoveInput) => void;
  /** Name plates by colour; each board places them beside that army. */
  plates?: Partial<Record<PlayerColor, ReactNode>>;
  /** Coaching marks: a suggested move and our pieces that could be taken. */
  hints?: BoardHints;
}

export interface BoardHints {
  move: { from: string; to: string } | null;
  danger: ReadonlySet<string>;
}

/** Seats counted clockwise from the bottom, starting with `perspective`. */
export function seatsFrom(variant: Variant, perspective: PlayerColor): PlayerColor[] {
  const order = variant.players;
  const start = Math.max(0, order.indexOf(perspective));
  return order.map((_, i) => order[(start + i) % order.length]!);
}

/** Selection, legal targets and highlights shared by every board shape. */
function useBoardState(state: GameState, playable: PlayerColor | null, onMove?: (move: MoveInput) => void, hints?: BoardHints) {
  const [selected, setSelected] = useState<string | null>(null);
  // A pawn move to the last rank waits here while the player picks what it becomes.
  const [promoting, setPromoting] = useState<{ from: string; to: string } | null>(null);
  // Any new position from the server clears a stale selection.
  useEffect(() => {
    setSelected(null);
    setPromoting(null);
  }, [state.ply, state.eliminations.length]);

  const moves = useMemo(() => (selected ? getLegalMoves(state, selected) : []), [state, selected]);
  const targets = useMemo(() => new Set(moves.map((m) => m.to)), [moves]);
  const checkedKings = useMemo(() => {
    const active = activePlayers(state);
    return new Set(getVariant(state.variant).players.filter((c) => active.includes(c) && isInCheck(state, c)));
  }, [state]);
  const last = state.history.at(-1);
  // One move back per seat: each army's latest move, outlined in its colour. Newer moves win shared squares.
  const trail = useMemo(() => {
    const squares = new Map<string, PlayerColor>();
    for (const record of state.history.slice(-getVariant(state.variant).players.length)) {
      squares.set(record.from, record.player);
      squares.set(record.to, record.player);
    }
    return squares;
  }, [state]);

  const classesFor = (square: string, piece: Piece | null, light: boolean) =>
    [
      light ? "light" : "dark",
      square === selected && "selected",
      (square === last?.from || square === last?.to) && "last",
      trail.has(square) && `trace trace-${trail.get(square)}`,
      targets.has(square) && (piece ? "target capture" : "target"),
      piece?.type === "king" && checkedKings.has(piece.color) && "check",
      piece?.color === playable && "mine",
      square === hints?.move?.from && "hint-from",
      square === hints?.move?.to && "hint-to",
      hints?.danger.has(square) && "danger",
    ].filter(Boolean) as string[];

  const click = (square: string, piece: Piece | null) => {
    if (!onMove) return;
    if (selected && targets.has(square)) {
      if (moves.some((m) => m.to === square && m.promotion)) return setPromoting({ from: selected, to: square });
      onMove({ from: selected, to: square });
      setSelected(null);
    } else {
      setSelected(piece?.color === playable && square !== selected ? square : null);
    }
  };

  const promote = (promotion: PromotionPiece) => {
    if (!promoting || !onMove) return;
    onMove({ ...promoting, promotion });
    setPromoting(null);
    setSelected(null);
  };
  const picker = promoting && playable && (
    <PromotionPicker color={playable} onPick={promote} onCancel={() => setPromoting(null)} />
  );

  return { classesFor, click, picker };
}

const PROMOTIONS: readonly PromotionPiece[] = ["queen", "rook", "bishop", "knight"];

/** Choose what a pawn on the last rank becomes. Esc or the backdrop cancels the move. */
function PromotionPicker({ color, onPick, onCancel }: { color: PlayerColor; onPick: (p: PromotionPiece) => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="promotion-backdrop" onClick={onCancel}>
      <div className="promotion" role="dialog" aria-label="Promote your pawn" onClick={(e) => e.stopPropagation()}>
        <span className="label">Promote to</span>
        <div className="promotion-options">
          {PROMOTIONS.map((p, i) => (
            <button key={p} type="button" autoFocus={i === 0} onClick={() => onPick(p)} aria-label={p}>
              <span className={`piece ${color}`}>{GLYPH[p]}</span>
              <span className="promotion-name">{p}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function themeStyle(theme: BoardTheme): CSSProperties {
  return {
    "--sq-light": theme.light,
    "--sq-dark": theme.dark,
    "--sq-last": theme.last,
    "--sq-selected": theme.selected,
    "--sq-hint": theme.hint,
    "--piece-halo": theme.halo,
  } as CSSProperties;
}

export function Board(props: BoardProps) {
  const variant = getVariant(props.state.variant);
  return variant.layout.kind === "hex" ? <HexBoard {...props} variant={variant} /> : <GridBoard {...props} variant={variant} />;
}

/* ---------- 2- and 4-player grids ---------- */

function GridBoard({ state, perspective, theme, playable = null, onMove, plates = {}, hints, variant }: BoardProps & { variant: Variant }) {
  const { classesFor, click, picker } = useBoardState(state, playable, onMove, hints);
  if (variant.layout.kind !== "grid") return null;
  const { width, height, coords } = variant.layout;
  const seats = seatsFrom(variant, perspective);
  // Turn the board so our army is at the bottom: a half turn per seat with 2 players, a quarter with 4.
  const turns = (variant.players.indexOf(seats[0]!) * 4) / variant.players.length;
  const toDisplay = (x: number, y: number): [number, number] => {
    for (let i = 0; i < turns; i++) [x, y] = [width - 1 - y, x];
    return [x, y];
  };
  const shown = coords.map(([x, y]) => toDisplay(x, y));
  const occupied = new Set(shown.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number) => occupied.has(`${x},${y}`);

  const cells = coords.map(([x, y], cell) => {
    const [dx, dy] = shown[cell]!;
    const square = variant.names[cell]!;
    const piece = state.board[cell] ?? null;
    const classes = [
      "cell",
      ...classesFor(square, piece, (x + y) % 2 === 1),
      !has(dx, dy + 1) && "edge-top",
      !has(dx, dy - 1) && "edge-bottom",
      !has(dx - 1, dy) && "edge-left",
      !has(dx + 1, dy) && "edge-right",
    ].filter(Boolean);
    return (
      <button
        key={square}
        type="button"
        tabIndex={onMove ? 0 : -1}
        className={classes.join(" ")}
        style={{ gridColumn: dx + 1, gridRow: height - dy }}
        aria-label={piece ? `${square} ${piece.color} ${piece.type}` : square}
        onClick={() => click(square, piece)}
      >
        {piece && <span className={`piece ${piece.color}`}>{GLYPH[piece.type]}</span>}
      </button>
    );
  });

  const grid = (
    <div className="board" style={{ gridTemplateColumns: `repeat(${width}, 1fr)`, gridTemplateRows: `repeat(${height}, 1fr)` }}>
      {cells}
    </div>
  );

  if (variant.players.length === 2) {
    // A full 8×8 square has no free corners, so the plates sit above and below.
    return (
      <div className={onMove ? "board-stack" : "board-stack static"} style={themeStyle(theme)}>
        {plates[seats[1]!] && <div className="stack-plate top">{plates[seats[1]!]}</div>}
        <div className="board-wrap grid-2">
          {grid}
          {picker}
        </div>
        {plates[seats[0]!] && <div className="stack-plate bottom">{plates[seats[0]!]}</div>}
      </div>
    );
  }

  // The cross leaves four empty 3×3 corners; each plate goes in the corner beside its army.
  const corners: Corner[] = ["bottom-right", "bottom-left", "top-left", "top-right"];
  return (
    <div className={onMove ? "board-wrap" : "board-wrap static"} style={themeStyle(theme)}>
      {grid}
      {picker}
      {seats.map((color, i) =>
        plates[color] ? (
          <div key={color} className={`corner ${corners[i]}`}>
            {plates[color]}
          </div>
        ) : null,
      )}
    </div>
  );
}

/* ---------- 3-player hexagon ---------- */

type Point = [number, number];
const RADIUS = 1;
const MID = Math.cos(Math.PI / 6); // distance from centre to the middle of a side
const polar = (deg: number, r: number): Point => [r * Math.cos((deg * Math.PI) / 180), -r * Math.sin((deg * Math.PI) / 180)];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Bilinear point inside the quad (q00, q10, q11, q01) at (u, v). */
const bilinear = (q: [Point, Point, Point, Point], u: number, v: number): Point =>
  lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v);

/**
 * Each half is two 4×4 quadrants. A half whose back rank faces angle θ spans
 * the hexagon side between the corners at θ−30° and θ+30°. Its left quadrant
 * (files a–d) runs up to the middle of the side at θ−60°, its right quadrant
 * (e–h) to the side at θ+60°, and both meet at the centre.
 */
function quadrant(theta: number, right: boolean): [Point, Point, Point, Point] {
  const centre: Point = [0, 0];
  return right
    ? [polar(theta, MID), polar(theta + 30, RADIUS), polar(theta + 60, MID), centre]
    : [polar(theta - 30, RADIUS), polar(theta, MID), centre, polar(theta - 60, MID)];
}

function HexBoard({ state, perspective, theme, playable = null, onMove, plates = {}, hints, variant }: BoardProps & { variant: Variant }) {
  const { classesFor, click, picker } = useBoardState(state, playable, onMove, hints);
  const geometry = useMemo(() => {
    if (variant.layout.kind !== "hex") return [];
    const bottom = Math.max(0, variant.players.indexOf(perspective));
    return variant.layout.coords.map(([half, x, y]) => {
      // Rotate so our half is at the bottom (270°); the others follow clockwise.
      const theta = 270 - 120 * ((half - bottom + 3) % 3);
      const quad = quadrant(theta, x >= 4);
      const u0 = (x % 4) / 4;
      const v0 = y / 4;
      const corners = [bilinear(quad, u0, v0), bilinear(quad, u0 + 0.25, v0), bilinear(quad, u0 + 0.25, v0 + 0.25), bilinear(quad, u0, v0 + 0.25)];
      const centre = bilinear(quad, u0 + 0.125, v0 + 0.125);
      return { points: corners.map((p) => p.join(",")).join(" "), centre, light: (x + y) % 2 === 1 };
    });
  }, [variant, perspective]);

  const seats = seatsFrom(variant, perspective);
  // Our half faces the bottom; the next seat is upper-left, the one after upper-right.
  const corners: Corner[] = ["bottom-right", "top-left", "top-right"];
  const outline = [0, 60, 120, 180, 240, 300].map((deg) => polar(deg, RADIUS).join(",")).join(" ");

  return (
    <div className={onMove ? "board-wrap hex" : "board-wrap hex static"} style={themeStyle(theme)}>
      <svg className="hex-board" viewBox="-1.06 -1.06 2.12 2.12" role="group" aria-label="3-player board">
        {geometry.map(({ points, centre, light }, cell) => {
          const square = variant.names[cell]!;
          const piece = state.board[cell] ?? null;
          const classes = classesFor(square, piece, light);
          return (
            <g
              key={square}
              className={["hex-cell", ...classes].join(" ")}
              role="button"
              tabIndex={onMove ? 0 : -1}
              aria-label={piece ? `${square} ${piece.color} ${piece.type}` : square}
              onClick={() => click(square, piece)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && click(square, piece)}
            >
              <polygon points={points} className="hex-fill" />
              <polygon points={points} className="hex-tint" />
              {classes.includes("target") && !piece && <circle cx={centre[0]} cy={centre[1]} r={0.022} className="hex-dot" />}
              {piece && (
                <text x={centre[0]} y={centre[1]} className={`hex-piece ${piece.color}`} dominantBaseline="central" textAnchor="middle">
                  {GLYPH[piece.type]}
                </text>
              )}
            </g>
          );
        })}
        <polygon points={outline} className="hex-outline" />
      </svg>
      {picker}
      {seats.map((color, i) =>
        plates[color] ? (
          <div key={color} className={`corner hex-corner ${corners[i]}`}>
            {plates[color]}
          </div>
        ) : null,
      )}
    </div>
  );
}
