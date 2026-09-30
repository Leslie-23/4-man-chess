import { describe, expect, it } from "vitest";
import {
  FourPlayerChess,
  IllegalMoveError,
  activePlayers,
  applyMove,
  createGame,
  createGameFromPosition,
  getLegalMoves,
  getVariant,
  resign,
  type GameState,
  type PlayerColor,
} from "../src/index.js";

const KINGS = { h1: "rK", a7: "bK", g14: "yK", n8: "gK" };
const FOUR = getVariant("four");
const PLAYER_ORDER = FOUR.players;

const pieceOn = (state: GameState, square: string) => state.board[getVariant(state.variant).indexOf(square)];
const targets = (state: GameState, from: string) => getLegalMoves(state, from).map((m) => m.to).sort();

describe("board", () => {
  it("has 160 squares with the 3×3 corners cut out", () => {
    expect(FOUR.size).toBe(160);
    for (const corner of ["a1", "c3", "l12", "n14", "a14", "n1"]) expect(() => FOUR.indexOf(corner)).toThrow(RangeError);
    expect(() => FOUR.indexOf("d1")).not.toThrow();
  });

  it("sets up four identical armies rotated around the board", () => {
    const { board } = createGame();
    for (const color of PLAYER_ORDER) {
      expect(board.filter((p) => p?.color === color)).toHaveLength(16);
    }
    expect(pieceOn(createGame(), "h1")).toMatchObject({ type: "king", color: "red" });
    expect(pieceOn(createGame(), "g1")).toMatchObject({ type: "queen", color: "red" });
    expect(pieceOn(createGame(), "a7")).toMatchObject({ type: "king", color: "blue" });
    expect(pieceOn(createGame(), "g14")).toMatchObject({ type: "king", color: "yellow" });
    expect(pieceOn(createGame(), "n8")).toMatchObject({ type: "king", color: "green" });
  });

  it("gives every player the same 20 opening moves", () => {
    for (const color of PLAYER_ORDER) {
      expect(getLegalMoves({ ...createGame(), currentPlayer: color })).toHaveLength(20);
    }
  });
});

describe("turns and validation", () => {
  it("rotates clockwise red → blue → yellow → green", () => {
    const game = new FourPlayerChess();
    const seen: PlayerColor[] = [];
    for (const [from, to] of [["e2", "e4"], ["b5", "d5"], ["e13", "e11"], ["m5", "k5"]] as const) {
      seen.push(game.state.currentPlayer);
      game.move({ from, to });
    }
    expect(seen).toEqual(["red", "blue", "yellow", "green"]);
    expect(game.state.currentPlayer).toBe("red");
    expect(game.state.ply).toBe(4);
  });

  it("rejects moving out of turn, moving someone else's piece, and impossible moves", () => {
    const state = createGame();
    expect(() => applyMove(state, { from: "b5", to: "d5", player: "blue" })).toThrow(IllegalMoveError);
    expect(() => applyMove(state, { from: "b5", to: "d5" })).toThrow(IllegalMoveError);
    expect(() => applyMove(state, { from: "e2", to: "e5" })).toThrow(IllegalMoveError);
  });

  it("never mutates the state it is given", () => {
    const state = createGame();
    const snapshot = JSON.stringify(state);
    applyMove(state, { from: "e2", to: "e4" });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("continues from a JSON round-tripped state", () => {
    const state = applyMove(createGame(), { from: "e2", to: "e4" });
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(applyMove(restored, { from: "b5", to: "d5" }).currentPlayer).toBe("yellow");
  });
});

describe("check", () => {
  it("keeps a pinned piece on the pin line", () => {
    const state = createGameFromPosition({ ...KINGS, h5: "rR", h12: "yR" });
    expect(targets(state, "h5").every((sq) => sq.startsWith("h"))).toBe(true);
    expect(targets(state, "h5")).toContain("h12");
  });

  it("forbids stepping into any opponent's attack", () => {
    const state = createGameFromPosition({ ...KINGS, i5: "bR", g5: "gR" });
    expect(targets(state, "h1")).toEqual(["h2"]);
  });
});

describe("castling", () => {
  it("castles both ways for red", () => {
    const state = createGameFromPosition({ ...KINGS, d1: "rR", k1: "rR" });
    const castles = getLegalMoves(state, "h1").filter((m) => m.castle);
    expect(castles.map((m) => [m.to, m.castle])).toEqual(expect.arrayContaining([["j1", "short"], ["f1", "long"]]));

    const short = applyMove(state, { from: "h1", to: "j1" });
    expect(pieceOn(short, "j1")?.type).toBe("king");
    expect(pieceOn(short, "i1")?.type).toBe("rook");
    expect(pieceOn(short, "k1")).toBeNull();

    const long = applyMove(state, { from: "h1", to: "f1" });
    expect(pieceOn(long, "g1")?.type).toBe("rook");
    expect(pieceOn(long, "d1")).toBeNull();
  });

  it("castles along the a-file for blue", () => {
    const state = createGameFromPosition({ ...KINGS, a4: "bR", a11: "bR" }, { currentPlayer: "blue" });
    const after = applyMove(state, { from: "a7", to: "a5" });
    expect(pieceOn(after, "a5")?.type).toBe("king");
    expect(pieceOn(after, "a6")?.type).toBe("rook");
  });

  it("may not pass through an attacked square or after the rook has moved", () => {
    const attacked = createGameFromPosition({ ...KINGS, d1: "rR", k1: "rR", i13: "yR" });
    expect(getLegalMoves(attacked, "h1").filter((m) => m.castle).map((m) => m.castle)).toEqual(["long"]);

    const moved = createGameFromPosition({ ...KINGS, k1: "rR" });
    const afterRook = [
      { from: "k1", to: "k3" }, { from: "a7", to: "a8" }, { from: "g14", to: "f14" }, { from: "n8", to: "n9" },
      { from: "k3", to: "k1" }, { from: "a8", to: "a7" }, { from: "f14", to: "g14" }, { from: "n9", to: "n8" },
    ].reduce(applyMove, moved);
    expect(getLegalMoves(afterRook, "h1").some((m) => m.castle)).toBe(false);
  });
});

describe("pawns", () => {
  it("lets any opponent capture en passant until the pawn's owner moves again", () => {
    const start = createGameFromPosition({ ...KINGS, e2: "rP", d4: "bP" });
    const doubled = applyMove(start, { from: "e2", to: "e4" });
    const ep = getLegalMoves(doubled, "d4").find((m) => m.to === "e3");
    expect(ep).toMatchObject({ enPassant: true, capture: "pawn" });
    const captured = applyMove(doubled, { from: "d4", to: "e3" });
    expect(pieceOn(captured, "e4")).toBeNull();
    expect(pieceOn(captured, "e3")).toMatchObject({ type: "pawn", color: "blue" });

    const expired = [
      { from: "a7", to: "a8" }, { from: "g14", to: "f14" }, { from: "n8", to: "n9" }, { from: "h1", to: "h2" },
    ].reduce(applyMove, doubled);
    expect(targets(expired, "d4")).not.toContain("e3");
  });

  it("promotes on the eighth rank from the pawn's own side", () => {
    const red = createGameFromPosition({ ...KINGS, e7: "rP" });
    expect(pieceOn(applyMove(red, { from: "e7", to: "e8" }), "e8")?.type).toBe("queen");
    expect(pieceOn(applyMove(red, { from: "e7", to: "e8", promotion: "knight" }), "e8")?.type).toBe("knight");

    const blue = createGameFromPosition({ ...KINGS, g5: "bP" }, { currentPlayer: "blue" });
    expect(pieceOn(applyMove(blue, { from: "g5", to: "h5" }), "h5")).toMatchObject({ type: "queen", color: "blue" });
    expect(() => applyMove(blue, { from: "a7", to: "a8", promotion: "queen" })).toThrow(IllegalMoveError);
  });
});

describe("elimination", () => {
  it("eliminates a checkmated player when their turn comes and skips them", () => {
    const state = createGameFromPosition({ ...KINGS, b4: "rR", d11: "rR" });
    const after = applyMove(state, { from: "d11", to: "a11" });
    expect(after.eliminations).toEqual([{ player: "blue", reason: "checkmate", ply: 1 }]);
    expect(after.currentPlayer).toBe("yellow");
    expect(after.board.some((p) => p?.color === "blue")).toBe(false);
  });

  it("eliminates a stalemated player", () => {
    const state = createGameFromPosition({ h1: "rK", a4: "bK", g14: "yK", n8: "gK", c9: "rQ" });
    const after = applyMove(state, { from: "c9", to: "c5" });
    expect(after.eliminations[0]).toMatchObject({ player: "blue", reason: "stalemate" });
  });

  it("allows capturing a king exposed by someone else's discovered attack", () => {
    const state = createGameFromPosition({ ...KINGS, g10: "rB", g5: "bR" });
    const exposed = applyMove(state, { from: "g10", to: "f9" });
    expect(getLegalMoves(exposed, "g5").find((m) => m.to === "g14")?.capture).toBe("king");
    const after = applyMove(exposed, { from: "g5", to: "g14" });
    expect(after.eliminations[0]).toMatchObject({ player: "yellow", reason: "king-captured", by: "blue" });
    expect(after.currentPlayer).toBe("green");
  });

  it("declares the last player standing the winner", () => {
    let state = resign(createGame(), "red");
    expect(state.currentPlayer).toBe("blue");
    state = resign(state, "yellow");
    state = resign(state, "green", "timeout");
    expect(state).toMatchObject({ status: "finished", winner: "blue" });
    expect(() => applyMove(state, { from: "b5", to: "d5" })).toThrow(IllegalMoveError);
  });
});

describe("draws", () => {
  it("draws when only kings remain", () => {
    const state = createGameFromPosition({ ...KINGS, h2: "bQ" });
    expect(applyMove(state, { from: "h1", to: "h2" })).toMatchObject({ status: "finished", winner: null, drawReason: "only-kings" });
  });

  it("draws after the no-progress limit and resets on captures and pawn moves", () => {
    const state = createGameFromPosition({ ...KINGS, e2: "rP" }, { noProgressLimit: 2 });
    const pawn = applyMove(state, { from: "e2", to: "e3" });
    expect(pawn.pliesSinceProgress).toBe(0);
    const one = applyMove(pawn, { from: "a7", to: "a8" });
    expect(one).toMatchObject({ status: "playing", pliesSinceProgress: 1 });
    expect(applyMove(one, { from: "g14", to: "f14" })).toMatchObject({ status: "finished", drawReason: "no-progress" });
  });
});

describe("random self-play", () => {
  it.each([1, 2, 3])("keeps the position consistent for seed %i", (seed) => {
    let rng = seed;
    const random = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let state = createGame();
    while (state.status === "playing" && state.ply < 400) {
      const moves = getLegalMoves(state);
      expect(moves.length).toBeGreaterThan(0);
      state = applyMove(state, moves[Math.floor(random() * moves.length)]!);
      const active = activePlayers(state);
      for (const color of PLAYER_ORDER) {
        const kings = state.board.filter((p) => p?.type === "king" && p.color === color).length;
        expect(kings).toBe(active.includes(color) ? 1 : 0);
      }
      if (state.status === "playing") expect(active).toContain(state.currentPlayer);
    }
  });
});
