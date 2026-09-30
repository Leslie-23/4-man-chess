import { describe, expect, it } from "vitest";
import { BOT_LEVELS, applyMove, chooseBotMove, createGame, createGameFromPosition, getLegalMoves, type GameState } from "../src/index.js";

const KINGS = { h1: "rK", a7: "bK", g14: "yK", n8: "gK" };
const seeded = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

describe("bot", () => {
  it("takes a free queen and a capturable king", () => {
    const queen = createGameFromPosition({ ...KINGS, e4: "rR", e9: "bQ" });
    expect(chooseBotMove(queen, seeded(1))).toEqual({ from: "e4", to: "e9" });

    const king = applyMove(createGameFromPosition({ ...KINGS, g10: "rB", g5: "bR" }), { from: "g10", to: "f9" });
    expect(chooseBotMove(king, seeded(1))).toEqual({ from: "g5", to: "g14" });
  });

  it("does not hang its queen for a pawn", () => {
    const state = createGameFromPosition({ ...KINGS, e4: "rQ", e10: "bP", d11: "bP" });
    expect(chooseBotMove(state, seeded(2))).not.toEqual({ from: "e4", to: "e10" });
  });

  it("advanced rescues a queen that is already under attack", () => {
    const state = createGameFromPosition({ ...KINGS, e5: "rQ", e10: "bR", j2: "rP" });
    const move = chooseBotMove(state, seeded(3), "advanced")!;
    expect(move.from).toBe("e5");
  });

  it.each(BOT_LEVELS)("%s plays only legal moves through a whole game and finishes it", (level) => {
    for (const seed of [1, 2]) {
      const random = seeded(seed);
      let state: GameState = createGame();
      while (state.status === "playing") {
        const move = chooseBotMove(state, random, level)!;
        expect(getLegalMoves(state).some((m) => m.from === move.from && m.to === move.to)).toBe(true);
        state = applyMove(state, move);
      }
      expect(state.status).toBe("finished");
    }
  });

  it.each(BOT_LEVELS)("%s doesn't walk a piece straight back to where it just came from", (level) => {
    // Red's rook has just gone e4 → e5; with other quiet moves open, it shouldn't go back.
    let state = createGameFromPosition({ ...KINGS, e4: "rR", j2: "rP" });
    state = applyMove(state, { from: "e4", to: "e5" });
    state = { ...state, currentPlayer: "red" };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(chooseBotMove(state, seeded(seed), level)).not.toEqual({ from: "e5", to: "e4" });
    }
  });
});
