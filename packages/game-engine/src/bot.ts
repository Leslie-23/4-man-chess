import { applyToBoard, attackersOf, generateLegalMoves, isKingInCheck, type InternalMove } from "./moves.js";
import type { Board, GameState, MoveInput, PieceType, PlayerColor } from "./types.js";
import { getVariant, type Variant } from "./variants.js";

export type BotLevel = "easy" | "hard" | "advanced";
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "hard", "advanced"];

export const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100,
};

const KING_CAPTURE = 10_000;

const toInput = (v: Variant, move: InternalMove): MoveInput => ({
  from: v.names[move.from]!,
  to: v.names[move.to]!,
  ...(move.promotion && { promotion: move.promotion }),
});

/**
 * Picks a move for the player to move. Pass `random` (returning [0, 1)) so the
 * engine stays deterministic. Returns null when there is nothing to play.
 *
 * - easy: mostly random; notices captures only some of the time.
 * - hard: one-move lookahead that avoids leaving the moved piece en prise.
 * - advanced: guards every piece (not just the one moving), makes threats,
 *   checks the next player's best capture in reply, and pushes for a result.
 */
export function chooseBotMove(state: GameState, random: () => number, level: BotLevel = "hard"): MoveInput | null {
  if (state.status !== "playing") return null;
  const legal = generateLegalMoves(state, state.currentPlayer);
  if (legal.length === 0) return null;
  const v = getVariant(state.variant);
  const moves = withoutShuffles(v, state, legal);
  const pick =
    level === "easy" ? pickEasy(state, moves, random) : level === "hard" ? pickHard(v, state, moves, random) : pickAdvanced(v, state, moves, random);
  return toInput(v, pick);
}

/**
 * Drops quiet moves that just walk a piece back to where our last move took it
 * from, so bots don't shuffle a piece to and fro forever. Captures stay, and
 * if nothing else is legal the shuffle is allowed.
 */
function withoutShuffles(v: Variant, state: GameState, moves: InternalMove[]): InternalMove[] {
  let last: GameState["history"][number] | undefined;
  for (let i = state.history.length - 1; i >= 0 && !last; i--) {
    if (state.history[i]!.player === state.currentPlayer) last = state.history[i];
  }
  if (!last) return moves;
  const from = v.indexOf(last.to);
  const to = v.indexOf(last.from);
  const fresh = moves.filter((m) => !(m.from === from && m.to === to && !state.board[m.to]));
  return fresh.length > 0 ? fresh : moves;
}

function best<T>(items: T[], score: (item: T) => number): T {
  let top = items[0] as T;
  let topScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > topScore) [top, topScore] = [item, s];
  }
  return top;
}

function pickEasy(state: GameState, moves: InternalMove[], random: () => number): InternalMove {
  return best(moves, (move) => {
    const captured = state.board[move.enPassantCapture ?? move.to];
    let score = random() * 10;
    if (captured?.type === "king") score += KING_CAPTURE;
    else if (captured && random() < 0.5) score += PIECE_VALUE[captured.type] * 3;
    if (move.promotion === "queen") score += 5;
    return score;
  });
}

/** Material likely lost on `index`: nothing if safe, the whole piece if undefended, else the trade deficit. */
function exposure(v: Variant, board: Board, index: number, owner: PlayerColor, value: number): number {
  const attackers = attackersOf(v, board, index, (c) => c !== owner);
  if (attackers.length === 0) return 0;
  if (!defended(v, board, index, owner)) return value;
  const cheapest = Math.min(...attackers.map((p) => PIECE_VALUE[p.type]));
  return Math.max(0, value - cheapest);
}

function defended(v: Variant, board: Board, index: number, owner: PlayerColor): boolean {
  // Our own pieces that "attack" the square are the ones defending it.
  return attackersOf(v, board, index, (c) => c === owner).length > 0;
}

function moveHeuristic(v: Variant, state: GameState, move: InternalMove): number {
  const color = state.currentPlayer;
  const piece = state.board[move.from]!;
  const { board, captured } = applyToBoard(state.board, move);
  const moved = board[move.to]!;
  let score = 0;
  if (captured) score += captured.type === "king" ? KING_CAPTURE : PIECE_VALUE[captured.type] * 10;
  score -= exposure(v, board, move.to, color, PIECE_VALUE[moved.type]) * 9;
  if (move.promotion) score += move.promotion === "queen" ? 80 : -5;
  if (move.castle) score += 6;
  if (v.players.some((c) => c !== color && isKingInCheck(v, board, c))) score += 4;
  if (state.ply < 60 && !piece.hasMoved && (piece.type === "knight" || piece.type === "bishop")) score += 3;
  if (piece.type === "pawn") score += 1;
  if (piece.type === "king" && !move.castle) score -= 2;
  return score;
}

function pickHard(v: Variant, state: GameState, moves: InternalMove[], random: () => number): InternalMove {
  return best(moves, (move) => moveHeuristic(v, state, move) + random() * 3);
}

function nextOpponent(v: Variant, board: Board, me: PlayerColor): PlayerColor | null {
  const order = v.players;
  const seat = order.indexOf(me);
  for (let i = 1; i < order.length; i++) {
    const c = order[(seat + i) % order.length]!;
    if (board.some((p) => p?.type === "king" && p.color === c)) return c;
  }
  return null;
}

/** Total material of `color` that looks capturable: the worst piece in full plus a share of the rest. */
function danger(v: Variant, board: Board, color: PlayerColor): number {
  let worst = 0;
  let total = 0;
  board.forEach((p, index) => {
    if (!p || p.color !== color || p.type === "king") return;
    const lost = exposure(v, board, index, color, PIECE_VALUE[p.type]);
    total += lost;
    worst = Math.max(worst, lost);
  });
  return worst + (total - worst) * 0.25;
}

/** Enemy material we attack that they would lose if it isn't moved. */
function threats(v: Variant, board: Board, color: PlayerColor): number {
  let total = 0;
  board.forEach((p, index) => {
    if (!p || p.color === color || p.type === "king") return;
    if (attackersOf(v, board, index, (c) => c === color).length === 0) return;
    total += exposure(v, board, index, p.color, PIECE_VALUE[p.type]);
  });
  return total;
}

// Tuned in bot-vs-bot tournaments; see the README.
const PAWN_PUSH = 0.6;
const TROPISM = 0.4;

/** Distance (king steps) from `index` to the nearest enemy king. */
function kingDistance(v: Variant, board: Board, index: number, me: PlayerColor): number {
  let nearest = 255;
  board.forEach((p, i) => {
    if (p?.type === "king" && p.color !== me) nearest = Math.min(nearest, v.distance(index, i));
  });
  return nearest;
}

function pickAdvanced(v: Variant, state: GameState, moves: InternalMove[], random: () => number): InternalMove {
  const me = state.currentPlayer;
  return best(moves, (move) => {
    const piece = state.board[move.from]!;
    const { board, captured } = applyToBoard(state.board, move);
    if (captured?.type === "king") return KING_CAPTURE * 2;
    let score = random() * 1.5;
    if (captured) score += PIECE_VALUE[captured.type] * 10;
    score -= danger(v, board, me) * 9;
    score += Math.min(threats(v, board, me), 9) * 1.5;
    if (move.promotion) score += move.promotion === "queen" ? 80 : -5;
    if (move.castle) score += 6;
    if (v.players.some((c) => c !== me && isKingInCheck(v, board, c))) score += 3;
    if (state.ply < 60 && !piece.hasMoved && (piece.type === "knight" || piece.type === "bishop")) score += 3;
    if (piece.type === "king" && !move.castle) score -= 2;
    // Drive the game forward: race pawns to promotion and bring pieces toward enemy kings.
    // Progress is 0–1; ×7 keeps the tuning from the 4-player board, where it was ranks 0–7.
    if (piece.type === "pawn") score += 1 + v.progress(me, move.to, state.options) * 7 * PAWN_PUSH;
    else if (piece.type !== "king") score += (kingDistance(v, state.board, move.from, me) - kingDistance(v, board, move.to, me)) * TROPISM;

    // The next player moves first: punish moves that hand them a capture of ours or our king.
    const opponent = nextOpponent(v, board, me);
    if (opponent) {
      const replyState: GameState = { ...state, board, currentPlayer: opponent, enPassant: state.enPassant.filter((t) => t.owner !== me) };
      let worstLoss = 0;
      for (const reply of generateLegalMoves(replyState, opponent)) {
        const victim = board[reply.enPassantCapture ?? reply.to];
        if (!victim || victim.color !== me) continue;
        if (victim.type === "king") return -KING_CAPTURE;
        const after = applyToBoard(board, reply).board;
        // What they win, minus what we can take back from them.
        const loss = PIECE_VALUE[victim.type] - exposure(v, after, reply.to, opponent, PIECE_VALUE[after[reply.to]!.type]);
        worstLoss = Math.max(worstLoss, loss);
      }
      score -= Math.max(0, worstLoss) * 4;
    }
    return score;
  });
}
