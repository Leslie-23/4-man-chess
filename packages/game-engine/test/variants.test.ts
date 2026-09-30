import { describe, expect, it } from "vitest";
import {
  BOT_LEVELS,
  VARIANT_IDS,
  applyMove,
  chooseBotMove,
  createGame,
  createGameFromPosition,
  getLegalMoves,
  getVariant,
  type GameState,
} from "../src/index.js";

const targets = (state: GameState, from: string) => getLegalMoves(state, from).map((m) => m.to).sort();
const pieceOn = (state: GameState, square: string) => state.board[getVariant(state.variant).indexOf(square)];
const seeded = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

describe.each(VARIANT_IDS)("%s board geometry", (id) => {
  const v = getVariant(id);

  it("gives every player 20 opening moves", () => {
    for (const color of v.players) {
      expect(getLegalMoves({ ...createGame({ variant: id }), currentPlayer: color })).toHaveLength(20);
    }
  });

  it("is symmetric: kings, knights and every line can be walked back", () => {
    for (let a = 0; a < v.size; a++) {
      for (const b of v.king[a]!) expect(v.king[b]).toContain(a);
      for (const b of v.knight[a]!) expect(v.knight[b]).toContain(a);
      for (const rays of [v.orthRays, v.diagRays]) {
        for (const ray of rays[a]!) {
          ray.forEach((b, i) => {
            // Some line from b must pass back through the same squares to a.
            const back = [...ray.slice(0, i).reverse(), a];
            expect(rays[b]!.some((r) => back.every((cell, j) => r[j] === cell))).toBe(true);
          });
        }
      }
    }
  });

  it("finishes whole bot games at every level", () => {
    for (const level of BOT_LEVELS) {
      const random = seeded(7);
      let state = createGame({ variant: id });
      while (state.status === "playing") state = applyMove(state, chooseBotMove(state, random, level)!);
      expect(state.status).toBe("finished");
    }
  });
});

describe("2-player chess", () => {
  it("plays fool's mate: black wins", () => {
    const moves = [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]] as const;
    const end = moves.reduce((s, [from, to]) => applyMove(s, { from, to }), createGame({ variant: "two" }));
    expect(end).toMatchObject({ status: "finished", winner: "black" });
    expect(end.eliminations[0]).toMatchObject({ player: "white", reason: "checkmate" });
  });

  it("draws on stalemate instead of knocking the player out", () => {
    const state = createGameFromPosition({ h1: "wK", c1: "wQ", a8: "kK" }, { variant: "two" });
    const after = applyMove(state, { from: "c1", to: "c7" });
    expect(after).toMatchObject({ status: "finished", winner: null, drawReason: "stalemate", eliminations: [] });
  });

  it("castles, captures en passant and promotes like normal chess", () => {
    const castle = createGameFromPosition({ e1: "wK", a1: "wR", h1: "wR", e8: "kK" }, { variant: "two" });
    expect(getLegalMoves(castle, "e1").filter((m) => m.castle).map((m) => m.to).sort()).toEqual(["c1", "g1"]);
    expect(pieceOn(applyMove(castle, { from: "e1", to: "g1" }), "f1")?.type).toBe("rook");

    const ep = applyMove(createGameFromPosition({ e1: "wK", e5: "wP", e8: "kK", d7: "kP" }, { variant: "two", currentPlayer: "black" }), { from: "d7", to: "d5" });
    const taken = applyMove(ep, { from: "e5", to: "d6" });
    expect(pieceOn(taken, "d5")).toBeNull();

    const promo = createGameFromPosition({ e1: "wK", a7: "wP", h8: "kK" }, { variant: "two" });
    expect(pieceOn(applyMove(promo, { from: "a7", to: "a8" }), "a8")).toMatchObject({ type: "queen", color: "white" });
  });
});

describe("3-player hexagon", () => {
  const KINGS = { We1: "wK", Re1: "rK", Be1: "kK" };

  it("has 96 squares in three halves", () => {
    expect(getVariant("three").size).toBe(96);
    expect(getVariant("three").players).toEqual(["white", "red", "black"]);
  });

  it("runs files a–d on into the half on the left, reversed", () => {
    const state = createGameFromPosition({ ...KINGS, Wa1: "wR" }, { variant: "three" });
    // White's a-file continues into red's h-file, running back toward red's back rank.
    expect(targets(state, "Wa1")).toEqual(expect.arrayContaining(["Wa4", "Rh4", "Rh3", "Rh1"]));
  });

  it("splits a diagonal through the centre point into both other halves", () => {
    const state = createGameFromPosition({ ...KINGS, Wd4: "wB" }, { variant: "three" });
    expect(targets(state, "Wd4")).toEqual(expect.arrayContaining(["Rd4", "Bd4", "Rc3", "Bc3"]));
  });

  it("sends pawns across the centre and promotes them on an opponent's back rank", () => {
    const crossing = createGameFromPosition({ ...KINGS, Wd4: "wP" }, { variant: "three" });
    expect(targets(crossing, "Wd4")).toContain("Re4");
    const nearlyThere = createGameFromPosition({ ...KINGS, Rb2: "wP" }, { variant: "three" });
    expect(targets(nearlyThere, "Rb2")).toContain("Rb1");
    expect(pieceOn(applyMove(nearlyThere, { from: "Rb2", to: "Rb1" }), "Rb1")).toMatchObject({ type: "queen", color: "white" });
  });

  it("knocks out a checkmated player and plays on with two", () => {
    // Red's king is boxed in on h1; a white knight checks from g3 and nothing can take it.
    const state = createGameFromPosition(
      { We1: "wK", Be1: "kK", Rh1: "rK", Rg1: "rR", Rg2: "rP", Rh2: "rN", Re4: "wN" },
      { variant: "three" },
    );
    const after = applyMove(state, { from: "Re4", to: "Rg3" });
    expect(after.eliminations).toEqual([{ player: "red", reason: "checkmate", ply: 1 }]);
    expect(after.currentPlayer).toBe("black");
    expect(after.status).toBe("playing");
  });
});
