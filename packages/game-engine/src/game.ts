import { applyToBoard, generateLegalMoves, isKingInCheck, type InternalMove } from "./moves.js";
import {
  IllegalMoveError,
  type Board,
  type EliminationReason,
  type GameOptions,
  type GameState,
  type LegalMove,
  type MoveInput,
  type PieceType,
  type PlayerColor,
  type Square,
  type VariantId,
} from "./types.js";
import { getVariant } from "./variants.js";

export type NewGameOptions = Partial<GameOptions> & { variant?: VariantId };

function initialBoard(variant: VariantId): Board {
  const v = getVariant(variant);
  const board: Board = new Array(v.size).fill(null);
  for (const { cell, type, color } of v.setup) board[cell] = { type, color, hasMoved: false };
  return board;
}

/** Starts a game on the chosen board (default: the 4-player cross). */
export function createGame({ variant = "four", ...options }: NewGameOptions = {}): GameState {
  const v = getVariant(variant);
  return {
    variant,
    board: initialBoard(variant),
    currentPlayer: v.players[0]!,
    status: "playing",
    ply: 0,
    history: [],
    eliminations: [],
    enPassant: [],
    pliesSinceProgress: 0,
    winner: null,
    drawReason: null,
    options: { promotionRank: 8, noProgressLimit: v.noProgressLimit, ...options },
  };
}

/** Players still in the game, in turn order. */
export function playersOf(state: GameState): readonly PlayerColor[] {
  return getVariant(state.variant).players;
}

const COLOR_CODES: Record<string, PlayerColor> = { w: "white", k: "black", r: "red", b: "blue", y: "yellow", g: "green" };
const PIECE_CODES: Record<string, PieceType> = {
  K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn",
};
const CODE_OF_PIECE = Object.fromEntries(Object.entries(PIECE_CODES).map(([k, v]) => [v, k])) as Record<PieceType, string>;

/**
 * Builds a game from a sparse position such as `{ h1: "rK", h14: "yQ" }`.
 * Colour codes: w white, k black, r red, b blue, y yellow, g green.
 * Players with no king are treated as already eliminated. A piece counts as
 * unmoved only if it stands on one of its own starting squares.
 */
export function createGameFromPosition(
  position: Record<Square, string>,
  { currentPlayer, ...options }: NewGameOptions & { currentPlayer?: PlayerColor } = {},
): GameState {
  const base = createGame(options);
  const v = getVariant(base.variant);
  const starts = new Map(v.setup.map((s) => [s.cell, s]));
  const board: Board = new Array(v.size).fill(null);
  for (const [square, code] of Object.entries(position)) {
    const color = COLOR_CODES[code[0] ?? ""];
    const type = PIECE_CODES[code[1] ?? ""];
    if (!color || !type || code.length !== 2) throw new Error(`Bad piece code "${code}" on ${square}`);
    const index = v.indexOf(square);
    const start = starts.get(index);
    board[index] = { type, color, hasMoved: !(start?.type === type && start.color === color) };
  }
  const state: GameState = { ...base, board, currentPlayer: currentPlayer ?? v.players[0]! };
  for (const color of v.players) {
    if (!board.some((p) => p?.type === "king" && p.color === color)) {
      state.eliminations.push({ player: color, reason: "resigned", ply: 0 });
    }
  }
  return state;
}

export function activePlayers(state: GameState): PlayerColor[] {
  return playersOf(state).filter((color) => !state.eliminations.some((e) => e.player === color));
}

export function isInCheck(state: GameState, color: PlayerColor): boolean {
  return isKingInCheck(getVariant(state.variant), state.board, color);
}

function describe(state: GameState, move: InternalMove): LegalMove {
  const { names } = getVariant(state.variant);
  const piece = state.board[move.from]!;
  const captured = state.board[move.enPassantCapture ?? move.to];
  return {
    from: names[move.from]!,
    to: names[move.to]!,
    piece: piece.type,
    ...(captured && { capture: captured.type }),
    ...(move.promotion && { promotion: move.promotion }),
    ...(move.castle && { castle: move.castle.side }),
    ...(move.enPassantCapture !== undefined && { enPassant: true }),
  };
}

/** Legal moves for the player to move, optionally only those starting on `from`. */
export function getLegalMoves(state: GameState, from?: Square): LegalMove[] {
  if (state.status !== "playing") return [];
  const fromIndex = from === undefined ? undefined : getVariant(state.variant).indexOf(from);
  return generateLegalMoves(state, state.currentPlayer)
    .filter((m) => fromIndex === undefined || m.from === fromIndex)
    .map((m) => describe(state, m));
}

function cloneForUpdate(state: GameState): GameState {
  return {
    ...state,
    history: state.history.slice(),
    eliminations: state.eliminations.slice(),
    enPassant: state.enPassant.slice(),
  };
}

function eliminate(draft: GameState, player: PlayerColor, reason: EliminationReason, by?: PlayerColor): void {
  draft.eliminations.push({ player, reason, ply: draft.ply, ...(by && { by }) });
  draft.board = draft.board.map((p) => (p?.color === player ? null : p));
  draft.enPassant = draft.enPassant.filter((t) => t.owner !== player);
}

function finishIfDecided(draft: GameState): boolean {
  const remaining = activePlayers(draft);
  if (remaining.length > 1) return false;
  draft.status = "finished";
  draft.winner = remaining[0] ?? null;
  return true;
}

/**
 * Hands the turn to the next active player after `after`. A player who has no
 * legal move when their turn arrives is checkmated if in check and knocked
 * out. If not in check it's stalemate: a draw in 2-player chess, elimination
 * in the multi-player games.
 */
function passTurn(draft: GameState, after: PlayerColor): void {
  const v = getVariant(draft.variant);
  const order = v.players;
  let previous = after;
  while (!finishIfDecided(draft)) {
    const seat = order.indexOf(previous);
    const active = activePlayers(draft);
    const next = order.map((_, i) => order[(seat + i + 1) % order.length]!).find((c) => active.includes(c))!;
    draft.currentPlayer = next;
    if (generateLegalMoves(draft, next).length > 0) return;
    const checked = isKingInCheck(v, draft.board, next);
    if (!checked && v.stalemate === "draw") {
      draft.status = "finished";
      draft.drawReason = "stalemate";
      return;
    }
    eliminate(draft, next, checked ? "checkmate" : "stalemate");
    previous = next;
  }
}

/** Returns the state after the current player makes `input`. Throws IllegalMoveError if it is not legal. */
export function applyMove(state: GameState, input: MoveInput): GameState {
  if (state.status !== "playing") throw new IllegalMoveError("The game is over");
  const player = state.currentPlayer;
  if (input.player && input.player !== player) throw new IllegalMoveError(`It is ${player}'s turn, not ${input.player}'s`);

  const v = getVariant(state.variant);
  const from = v.indexOf(input.from);
  const to = v.indexOf(input.to);
  const candidates = generateLegalMoves(state, player).filter((m) => m.from === from && m.to === to);
  if (candidates.length === 0) throw new IllegalMoveError(`${player} cannot move ${input.from} → ${input.to}`);
  const needsPromotion = candidates[0]!.promotion !== undefined;
  if (!needsPromotion && input.promotion) throw new IllegalMoveError(`${input.from} → ${input.to} is not a promotion`);
  const promotion = needsPromotion ? (input.promotion ?? "queen") : undefined;
  const move = candidates.find((m) => m.promotion === promotion)!;

  const draft = cloneForUpdate(state);
  const { board, captured } = applyToBoard(state.board, move);
  draft.board = board;
  draft.ply += 1;
  draft.pliesSinceProgress = captured || move.promotion || state.board[from]!.type === "pawn" ? 0 : state.pliesSinceProgress + 1;
  draft.history.push({
    ...describe(state, move),
    ply: draft.ply,
    player,
    ...(captured && { capturedColor: captured.color }),
  });
  draft.enPassant = draft.enPassant.filter((t) => t.owner !== player);
  if (move.doubleStepOver !== undefined) {
    draft.enPassant.push({ square: v.names[move.doubleStepOver]!, pawnSquare: v.names[move.to]!, owner: player });
  }
  // A king can be left en prise by someone else's move (e.g. a discovered attack); taking it knocks that player out.
  if (captured?.type === "king") eliminate(draft, captured.color, "king-captured", player);

  passTurn(draft, player);
  if (draft.status === "playing") drawIfDead(draft);
  return draft;
}

function drawIfDead(draft: GameState): void {
  if (draft.board.every((p) => !p || p.type === "king")) draft.drawReason = "only-kings";
  else if (draft.pliesSinceProgress >= draft.options.noProgressLimit) draft.drawReason = "no-progress";
  else return;
  draft.status = "finished";
}

/** Removes `player` from the game, e.g. on resignation or a flag fall. */
export function resign(state: GameState, player: PlayerColor, reason: "resigned" | "timeout" = "resigned"): GameState {
  if (state.status !== "playing") throw new IllegalMoveError("The game is over");
  if (!activePlayers(state).includes(player)) throw new IllegalMoveError(`${player} is already out`);
  const draft = cloneForUpdate(state);
  eliminate(draft, player, reason);
  if (player === state.currentPlayer) passTurn(draft, player);
  else finishIfDecided(draft);
  return draft;
}

/** Plain-text board for the grid variants (the 3-player board prints one half per block). */
export function renderAscii(state: GameState): string {
  const v = getVariant(state.variant);
  const code = (cell: number) => {
    const p = state.board[cell];
    return p ? `${p.color[0]}${CODE_OF_PIECE[p.type]} ` : " . ";
  };
  if (v.layout.kind === "hex") {
    const { coords } = v.layout;
    return v.players
      .map((color, half) => {
        const rows = [3, 2, 1, 0].map((y) => {
          const cells = coords.map((c, i) => [c, i] as const).filter(([[h, , cy]]) => h === half && cy === y);
          return `${y + 1} ` + cells.map(([, i]) => code(i)).join("").trimEnd();
        });
        return [`${color} half (centre at top)`, ...rows, "   a  b  c  d  e  f  g  h"].join("\n");
      })
      .join("\n\n");
  }
  const { width, height, coords } = v.layout;
  const at = new Map(coords.map(([x, y], i) => [`${x},${y}`, i]));
  const lines: string[] = [];
  for (let y = height - 1; y >= 0; y--) {
    let line = String(y + 1).padStart(2) + " ";
    for (let x = 0; x < width; x++) {
      const cell = at.get(`${x},${y}`);
      line += cell === undefined ? "   " : code(cell);
    }
    lines.push(line.trimEnd());
  }
  lines.push("   " + [..."abcdefghijklmn".slice(0, width)].map((f) => ` ${f} `).join("").trimEnd());
  return lines.join("\n");
}
