import type { GameOptions, PieceType, PlayerColor, VariantId } from "./types.js";

/**
 * A board is described by a handful of local rules (`BoardSpec`): which cell a
 * one-square step in some direction reaches, and where pawns go. From those,
 * `buildVariant` precomputes every ray, knight jump and pawn move, so the move
 * generator never needs to know the board's shape.
 *
 * Directions are vectors in the *current cell's* frame. Crossing into another
 * part of the board may change the frame, so a step returns the direction to
 * keep moving in. On the 3-player board a diagonal through the exact centre
 * splits in two, so a step can return more than one cell.
 */
export type Vec = readonly [dx: number, dy: number];

export interface Step {
  cell: number;
  dir: Vec;
}

export type BoardLayout =
  /** Cells on a rectangular grid; `coords[cell]` = [x, y] with y = 0 at the bottom. */
  | { kind: "grid"; width: number; height: number; coords: readonly (readonly [number, number])[] }
  /** 3-player hexagon: `coords[cell]` = [half, x, y]; half 0 at the bottom, x = file 0–7, y = rank 0–3. */
  | { kind: "hex"; coords: readonly (readonly [number, number, number])[] };

interface BoardSpec {
  id: VariantId;
  name: string;
  /** Turn order; also the seat order around the board (clockwise). */
  players: readonly PlayerColor[];
  names: readonly string[];
  step(cell: number, dir: Vec): Step[];
  /** Pawn's forward direction for `color` on `cell`, in that cell's frame. */
  forward(color: PlayerColor, cell: number): Vec;
  isPawnStart(color: PlayerColor, cell: number): boolean;
  isPromotion(color: PlayerColor, cell: number, options: GameOptions): boolean;
  /** How far a pawn on `cell` has come toward promotion, 0 to 1. Used by bots. */
  progress(color: PlayerColor, cell: number, options: GameOptions): number;
  setup: readonly { cell: number; type: PieceType; color: PlayerColor }[];
  layout: BoardLayout;
  /** Two-player chess draws on stalemate; the multi-player games knock the stalemated player out. */
  stalemate: "draw" | "eliminate";
  noProgressLimit: number;
}

export interface Variant extends BoardSpec {
  size: number;
  indexOf(name: string): number;
  /** Rook lines from each cell, nearest square first. */
  orthRays: readonly (readonly number[])[][];
  /** Bishop lines from each cell, nearest square first. */
  diagRays: readonly (readonly number[])[][];
  knight: readonly (readonly number[])[];
  king: readonly (readonly number[])[];
  pawnPush(color: PlayerColor, cell: number): { one: number | null; two: number | null };
  pawnCaptures(color: PlayerColor, cell: number): readonly number[];
  /** Cells from which a `color` pawn attacks `cell`. */
  pawnAttackers(color: PlayerColor, cell: number): readonly number[];
  /** King steps between two cells. */
  distance(a: number, b: number): number;
}

const ORTHOGONAL: readonly Vec[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL: readonly Vec[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const FILES = "abcdefghijklmn";
const BACK_RANK: readonly PieceType[] = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];

const neg = (v: Vec): Vec => [-v[0], -v[1]];
const same = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1];

function buildVariant(spec: BoardSpec): Variant {
  const size = spec.names.length;
  const index = new Map(spec.names.map((name, i) => [name, i]));
  const cells = Array.from({ length: size }, (_, i) => i);

  const raysFrom = (start: number, dir: Vec): number[][] => {
    const rays: number[][] = [];
    const walk = (cell: number, d: Vec, path: number[]) => {
      const next = spec.step(cell, d).filter((s) => s.cell !== start && !path.includes(s.cell));
      if (next.length === 0) {
        if (path.length) rays.push(path);
        return;
      }
      for (const s of next) walk(s.cell, s.dir, [...path, s.cell]);
    };
    walk(start, dir, []);
    return rays;
  };

  // A single orthogonal step; reports whether the frame turned around, which flips the sideways direction too.
  const stepOnce = (cell: number, dir: Vec): { cell: number; dir: Vec; flipped: boolean } | null => {
    const s = spec.step(cell, dir)[0];
    return s ? { cell: s.cell, dir: s.dir, flipped: !same(s.dir, dir) } : null;
  };

  const knightFrom = (start: number): number[] => {
    const found = new Set<number>();
    for (const a of ORTHOGONAL) {
      for (const b0 of [[a[1], a[0]], [-a[1], -a[0]]] as Vec[]) {
        // Two ways round the L: long leg first, or short leg first. On a flat grid they agree.
        for (const legs of [[a, a, b0], [b0, a, a]] as Vec[][]) {
          let cell: number | null = start;
          let dirs = legs.slice();
          for (let i = 0; i < dirs.length && cell !== null; i++) {
            const s = stepOnce(cell, dirs[i]!);
            if (!s) {
              cell = null;
              break;
            }
            cell = s.cell;
            if (s.flipped) dirs = dirs.map((d, j) => (j > i ? neg(d) : d));
          }
          if (cell !== null && cell !== start) found.add(cell);
        }
      }
    }
    return [...found];
  };

  const orthRays = cells.map((c) => ORTHOGONAL.flatMap((d) => raysFrom(c, d)));
  const diagRays = cells.map((c) => DIAGONAL.flatMap((d) => raysFrom(c, d)));
  const knight = cells.map(knightFrom);
  const king = cells.map((c) => [...new Set([...orthRays[c]!, ...diagRays[c]!].map((ray) => ray[0]!))]);

  const pawns = new Map<PlayerColor, { push: { one: number | null; two: number | null }[]; captures: number[][]; attackers: number[][] }>();
  for (const color of spec.players) {
    const push = cells.map((c) => {
      const one = spec.step(c, spec.forward(color, c))[0]?.cell ?? null;
      const two =
        one !== null && spec.isPawnStart(color, c) ? (spec.step(one, spec.forward(color, one))[0]?.cell ?? null) : null;
      return { one, two };
    });
    const captures = cells.map((c) => {
      const [fx, fy] = spec.forward(color, c);
      return [...new Set([1, -1].flatMap((side) => spec.step(c, [fx + fy * side, fy + fx * side]).map((s) => s.cell)))];
    });
    const attackers = cells.map(() => [] as number[]);
    captures.forEach((targets, from) => targets.forEach((t) => attackers[t]!.push(from)));
    pawns.set(color, { push, captures, attackers });
  }

  // King-step distances, by breadth-first search from every cell.
  const distances = new Uint8Array(size * size).fill(255);
  for (const from of cells) {
    distances[from * size + from] = 0;
    let frontier = [from];
    for (let d = 1; frontier.length; d++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (const n of king[c]!) {
          if (distances[from * size + n] === 255) {
            distances[from * size + n] = d;
            next.push(n);
          }
        }
      }
      frontier = next;
    }
  }

  const pawnTable = (color: PlayerColor) => {
    const table = pawns.get(color);
    if (!table) throw new Error(`${color} does not play on the ${spec.name} board`);
    return table;
  };

  return {
    ...spec,
    size,
    indexOf(name) {
      const i = index.get(name);
      if (i === undefined) throw new RangeError(`Not a square on the ${spec.name} board: "${name}"`);
      return i;
    },
    orthRays,
    diagRays,
    knight,
    king,
    pawnPush: (color, cell) => pawnTable(color).push[cell]!,
    pawnCaptures: (color, cell) => pawnTable(color).captures[cell]!,
    pawnAttackers: (color, cell) => pawnTable(color).attackers[cell]!,
    distance: (a, b) => distances[a * size + b]!,
  };
}

/* ---------- Grid boards (2 and 4 players) ---------- */

interface GridSeat {
  color: PlayerColor;
  forward: Vec;
  /** 0-based rank counted from this player's back rank. */
  relativeRank(x: number, y: number): number;
  /** Maps red/white's home layout (files 0–7 on rank 0/1, left to right) onto this seat. */
  place(file: number, rank: number): [number, number];
}

function gridVariant(options: {
  id: VariantId;
  name: string;
  width: number;
  height: number;
  valid(x: number, y: number): boolean;
  seats: readonly GridSeat[];
  /** File offset of the home 8-file back rank on red/white's side. */
  homeFile: number;
  promotes(relativeRank: number, options: GameOptions): boolean;
  progress(relativeRank: number, options: GameOptions): number;
  stalemate: "draw" | "eliminate";
  noProgressLimit: number;
}): Variant {
  const coords: [number, number][] = [];
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) if (options.valid(x, y)) coords.push([x, y]);
  }
  const at = new Map(coords.map(([x, y], i) => [`${x},${y}`, i]));
  const cellAt = (x: number, y: number) => at.get(`${x},${y}`);
  const seatOf = (color: PlayerColor) => options.seats.find((s) => s.color === color)!;
  const rank = (color: PlayerColor, cell: number) => seatOf(color).relativeRank(...coords[cell]!);

  const setup = options.seats.flatMap((seat) =>
    BACK_RANK.flatMap((type, i) => [
      { cell: cellAt(...seat.place(options.homeFile + i, 0))!, type, color: seat.color },
      { cell: cellAt(...seat.place(options.homeFile + i, 1))!, type: "pawn" as const, color: seat.color },
    ]),
  );

  return buildVariant({
    id: options.id,
    name: options.name,
    players: options.seats.map((s) => s.color),
    names: coords.map(([x, y]) => `${FILES[x]}${y + 1}`),
    step(cell, dir) {
      const [x, y] = coords[cell]!;
      const next = cellAt(x + dir[0], y + dir[1]);
      return next === undefined ? [] : [{ cell: next, dir }];
    },
    forward: (color) => seatOf(color).forward,
    isPawnStart: (color, cell) => rank(color, cell) === 1,
    isPromotion: (color, cell, o) => options.promotes(rank(color, cell), o),
    progress: (color, cell, o) => options.progress(rank(color, cell), o),
    setup,
    layout: { kind: "grid", width: options.width, height: options.height, coords },
    stalemate: options.stalemate,
    noProgressLimit: options.noProgressLimit,
  });
}

const TWO_PLAYER = gridVariant({
  id: "two",
  name: "2-player",
  width: 8,
  height: 8,
  valid: () => true,
  homeFile: 0,
  seats: [
    { color: "white", forward: [0, 1], relativeRank: (_x, y) => y, place: (f, r) => [f, r] },
    { color: "black", forward: [0, -1], relativeRank: (_x, y) => 7 - y, place: (f, r) => [f, 7 - r] },
  ],
  promotes: (r) => r === 7,
  progress: (r) => r / 7,
  stalemate: "draw",
  noProgressLimit: 100,
});

const CROSS = 14;
const CUT = 3;
const LAST = CROSS - 1;

const FOUR_PLAYER = gridVariant({
  id: "four",
  name: "4-player",
  width: CROSS,
  height: CROSS,
  valid: (x, y) => !((x < CUT || x > LAST - CUT) && (y < CUT || y > LAST - CUT)),
  homeFile: CUT,
  // Each army is red's rotated a quarter turn clockwise per seat, so every seat is identical.
  seats: [
    { color: "red", forward: [0, 1], relativeRank: (_x, y) => y, place: (f, r) => [f, r] },
    { color: "blue", forward: [1, 0], relativeRank: (x) => x, place: (f, r) => [r, LAST - f] },
    { color: "yellow", forward: [0, -1], relativeRank: (_x, y) => LAST - y, place: (f, r) => [LAST - f, LAST - r] },
    { color: "green", forward: [-1, 0], relativeRank: (x) => LAST - x, place: (f, r) => [LAST - r, f] },
  ],
  promotes: (r, o) => r === o.promotionRank - 1,
  progress: (r, o) => Math.min(1, r / (o.promotionRank - 1)),
  stalemate: "eliminate",
  noProgressLimit: 200,
});

/* ---------- The 3-player hexagon ---------- */

/*
 * Three halves (one per player) of 8 files × 4 ranks, arranged clockwise:
 * half 0 at the bottom, half 1 upper-left, half 2 upper-right. Each half is
 * two 4×4 quadrants. In a half's own frame, x runs a→h and y runs from its
 * back rank (0) to the centre line (3). Going "up" past the centre line
 * enters a neighbour's half, where the same line runs back down (the frame
 * turns around: x' = 7 − x). Files a–d lead into the half on the left,
 * e–h into the half on the right. The six quadrants meet at the centre
 * point; a diagonal through that point continues into both other halves.
 */
const HEX_PLAYERS: readonly PlayerColor[] = ["white", "red", "black"];
const HEX_PREFIX = "WRB";
const encode = (half: number, x: number, y: number) => half * 32 + y * 8 + x;
const decode = (cell: number): [number, number, number] => [Math.floor(cell / 32), cell % 8, Math.floor((cell % 32) / 8)];
const leftOf = (half: number) => (half + 1) % 3;
const rightOf = (half: number) => (half + 2) % 3;

const THREE_PLAYER = buildVariant({
  id: "three",
  name: "3-player",
  players: HEX_PLAYERS,
  names: Array.from({ length: 96 }, (_, cell) => {
    const [h, x, y] = decode(cell);
    return `${HEX_PREFIX[h]}${FILES[x]}${y + 1}`;
  }),
  step(cell, [dx, dy]) {
    const [h, x, y] = decode(cell);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx > 7 || ny < 0) return [];
    if (ny <= 3) return [{ cell: encode(h, nx, ny), dir: [dx, dy] }];

    // Crossing the centre line into a neighbour's half.
    if (dx === 0) return [{ cell: encode(x <= 3 ? leftOf(h) : rightOf(h), 7 - x, 3), dir: [0, -1] }];
    const throughCentre = (x === 3 && dx === 1) || (x === 4 && dx === -1);
    if (throughCentre) {
      // Carry on through the centre point into the other two halves' matching centre squares.
      return [leftOf(h), rightOf(h)].map((n) => ({ cell: encode(n, x, 3), dir: [x === 3 ? -1 : 1, -1] as Vec }));
    }
    return [{ cell: encode(nx <= 3 ? leftOf(h) : rightOf(h), 7 - nx, 3), dir: [-dx, -1] }];
  },
  forward: (color, cell) => (decode(cell)[0] === HEX_PLAYERS.indexOf(color) ? [0, 1] : [0, -1]),
  isPawnStart: (color, cell) => {
    const [h, , y] = decode(cell);
    return h === HEX_PLAYERS.indexOf(color) && y === 1;
  },
  // A pawn promotes on the back rank of whichever opponent's half it reaches.
  isPromotion: (color, cell) => {
    const [h, , y] = decode(cell);
    return h !== HEX_PLAYERS.indexOf(color) && y === 0;
  },
  progress: (color, cell) => {
    const [h, , y] = decode(cell);
    return h === HEX_PLAYERS.indexOf(color) ? y / 7 : (7 - y) / 7;
  },
  setup: HEX_PLAYERS.flatMap((color, h) =>
    BACK_RANK.flatMap((type, x) => [
      { cell: encode(h, x, 0), type, color },
      { cell: encode(h, x, 1), type: "pawn" as const, color },
    ]),
  ),
  layout: { kind: "hex", coords: Array.from({ length: 96 }, (_, c) => decode(c)) },
  stalemate: "eliminate",
  noProgressLimit: 150,
});

export const VARIANTS: Record<VariantId, Variant> = {
  two: TWO_PLAYER,
  three: THREE_PLAYER,
  four: FOUR_PLAYER,
};

export const VARIANT_IDS: readonly VariantId[] = ["two", "three", "four"];

export function getVariant(id: VariantId): Variant {
  const variant = VARIANTS[id];
  if (!variant) throw new RangeError(`Unknown board: ${String(id)}`);
  return variant;
}
