import { PIECE_VALUE, createGame, type GameState, type PlayerColor } from "@fourman/game-engine";
import type { RoomView } from "@fourman/shared";

export interface Standing {
  color: PlayerColor;
  /** 1 = leading. Players still in rank above everyone who's out. */
  place: number;
  /** Pieces left on the board, pawn = 1, king not counted. */
  material: number;
  /** Value of the enemy pieces this army has taken. */
  took: number;
  out: boolean;
}

/** Material for every army after each full round, for the "who led when" chart. */
export interface MaterialSeries {
  /** Ply at each point: 0, one round, two rounds, … and the latest ply. */
  plies: number[];
  values: Partial<Record<PlayerColor, number[]>>;
}

const materialOf = (state: GameState, color: PlayerColor) =>
  state.board.reduce((sum, p) => (p && p.color === color && p.type !== "king" ? sum + PIECE_VALUE[p.type] : sum), 0);

/** Seats that took part; empty seats sat out from the first move and aren't news. */
const seated = (room: RoomView) => room.players.filter((c) => room.seats[c]);

export function standings(room: RoomView): Standing[] {
  const { state } = room;
  const outAt = new Map(state.eliminations.map((e, i) => [e.player, i]));
  const took = new Map<PlayerColor, number>();
  for (const m of state.history) {
    if (m.capture && m.capture !== "king") took.set(m.player, (took.get(m.player) ?? 0) + PIECE_VALUE[m.capture]);
  }
  const rows = seated(room).map((color) => ({
    color,
    material: materialOf(state, color),
    took: took.get(color) ?? 0,
    out: outAt.has(color),
  }));
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    // Of those out, whoever lasted longer ranks higher.
    if (a.out) return outAt.get(b.color)! - outAt.get(a.color)!;
    if (state.winner) return a.color === state.winner ? -1 : b.color === state.winner ? 1 : 0;
    return b.material - a.material || b.took - a.took;
  });
  return rows.map((row, i) => ({ ...row, place: i + 1 }));
}

/**
 * Replays the history's captures and promotions from the starting position,
 * sampling after every full round. An army that's out drops to zero.
 */
export function materialSeries(room: RoomView): MaterialSeries {
  const { state, players } = room;
  const colors = seated(room);
  const start = createGame({ variant: state.variant });
  const current = new Map(colors.map((c) => [c, materialOf(start, c)]));

  const plies: number[] = [];
  for (let ply = 0; ply < state.ply; ply += players.length) plies.push(ply);
  plies.push(state.ply);

  const values: MaterialSeries["values"] = Object.fromEntries(colors.map((c) => [c, [] as number[]]));
  let next = 0;
  for (const ply of plies) {
    for (; next < state.history.length && state.history[next]!.ply <= ply; next++) {
      const m = state.history[next]!;
      if (m.capture && m.capture !== "king" && m.capturedColor && current.has(m.capturedColor)) {
        current.set(m.capturedColor, current.get(m.capturedColor)! - PIECE_VALUE[m.capture]);
      }
      if (m.promotion) current.set(m.player, current.get(m.player)! + PIECE_VALUE[m.promotion] - PIECE_VALUE.pawn);
    }
    for (const c of colors) {
      const out = state.eliminations.some((e) => e.player === c && e.ply <= ply);
      values[c]!.push(out ? 0 : current.get(c)!);
    }
  }
  return { plies, values };
}
