import { getVariant, type Variant } from "./variants.js";
import type { Board, GameState, Piece, PlayerColor, PromotionPiece } from "./types.js";

const PROMOTION_PIECES: readonly PromotionPiece[] = ["queen", "rook", "bishop", "knight"];

/** A move in cell indices, carrying everything needed to apply it. */
export interface InternalMove {
  from: number;
  to: number;
  promotion?: PromotionPiece;
  castle?: { side: "short" | "long"; rookFrom: number; rookTo: number };
  /** Square of the pawn removed by an en passant capture. */
  enPassantCapture?: number;
  /** Square skipped by a pawn double-step. */
  doubleStepOver?: number;
}

/** Every piece attacking `index` whose colour passes `isAttacker`. */
export function attackersOf(v: Variant, board: Board, index: number, isAttacker: (color: PlayerColor) => boolean): Piece[] {
  const found: Piece[] = [];
  for (const n of v.knight[index]!) {
    const p = board[n];
    if (p && p.type === "knight" && isAttacker(p.color)) found.push(p);
  }
  const scan = (rays: readonly (readonly number[])[], line: "rook" | "bishop") => {
    for (const ray of rays) {
      for (let i = 0; i < ray.length; i++) {
        const p = board[ray[i]!];
        if (!p) continue;
        if (isAttacker(p.color) && (p.type === "queen" || p.type === line || (i === 0 && p.type === "king"))) found.push(p);
        break;
      }
    }
  };
  scan(v.orthRays[index]!, "rook");
  scan(v.diagRays[index]!, "bishop");
  for (const color of v.players) {
    if (!isAttacker(color)) continue;
    for (const from of v.pawnAttackers(color, index)) {
      const p = board[from];
      if (p?.type === "pawn" && p.color === color) found.push(p);
    }
  }
  return found;
}

/** Is `index` attacked by any piece not belonging to `defender`? */
export function isAttacked(v: Variant, board: Board, index: number, defender: PlayerColor): boolean {
  for (const n of v.knight[index]!) {
    const p = board[n];
    if (p && p.color !== defender && p.type === "knight") return true;
  }
  const scan = (rays: readonly (readonly number[])[], line: "rook" | "bishop") => {
    for (const ray of rays) {
      for (let i = 0; i < ray.length; i++) {
        const p = board[ray[i]!];
        if (!p) continue;
        if (p.color !== defender && (p.type === "queen" || p.type === line || (i === 0 && p.type === "king"))) return true;
        break;
      }
    }
    return false;
  };
  if (scan(v.orthRays[index]!, "rook") || scan(v.diagRays[index]!, "bishop")) return true;
  for (const color of v.players) {
    if (color === defender) continue;
    for (const from of v.pawnAttackers(color, index)) {
      const p = board[from];
      if (p?.type === "pawn" && p.color === color) return true;
    }
  }
  return false;
}

export function findKing(board: Board, color: PlayerColor): number {
  return board.findIndex((p) => p?.type === "king" && p.color === color);
}

export function isKingInCheck(v: Variant, board: Board, color: PlayerColor): boolean {
  const king = findKing(board, color);
  return king !== -1 && isAttacked(v, board, king, color);
}

/** Returns the board after `move`; does not validate legality. */
export function applyToBoard(board: Board, move: InternalMove): { board: Board; captured: Piece | null } {
  const next = board.slice();
  const piece = next[move.from];
  if (!piece) throw new Error(`No piece on cell ${move.from}`);
  let captured = next[move.to] ?? null;
  if (move.enPassantCapture !== undefined) {
    captured = next[move.enPassantCapture] ?? null;
    next[move.enPassantCapture] = null;
  }
  next[move.from] = null;
  next[move.to] = { type: move.promotion ?? piece.type, color: piece.color, hasMoved: true };
  if (move.castle) {
    const rook = next[move.castle.rookFrom]!;
    next[move.castle.rookFrom] = null;
    next[move.castle.rookTo] = { ...rook, hasMoved: true };
  }
  return { board: next, captured };
}

function pawnMoves(v: Variant, state: GameState, from: number, pawn: Piece, out: InternalMove[]): void {
  const { board } = state;
  const push = (to: number, extra: Partial<InternalMove> = {}) => {
    if (v.isPromotion(pawn.color, to, state.options)) {
      for (const promotion of PROMOTION_PIECES) out.push({ from, to, promotion, ...extra });
    } else {
      out.push({ from, to, ...extra });
    }
  };

  const { one, two } = v.pawnPush(pawn.color, from);
  if (one !== null && !board[one]) {
    push(one);
    if (two !== null && !pawn.hasMoved && !board[two]) push(two, { doubleStepOver: one });
  }

  for (const to of v.pawnCaptures(pawn.color, from)) {
    const target = board[to];
    if (target) {
      if (target.color !== pawn.color) push(to);
      continue;
    }
    for (const ep of state.enPassant) {
      if (ep.owner === pawn.color || v.indexOf(ep.square) !== to) continue;
      const victimSquare = v.indexOf(ep.pawnSquare);
      const victim = board[victimSquare];
      if (victim?.type === "pawn" && victim.color === ep.owner) push(to, { enPassantCapture: victimSquare });
    }
  }
}

function castlingMoves(v: Variant, board: Board, from: number, king: Piece, out: InternalMove[]): void {
  if (king.hasMoved || isAttacked(v, board, from, king.color)) return;
  for (const ray of v.orthRays[from]!) {
    const i = ray.findIndex((cell) => board[cell]);
    const rook = i === -1 ? null : board[ray[i]!];
    // Unmoved kings and rooks share the back rank, so this only ever finds a rook along it.
    if (!rook || rook.type !== "rook" || rook.color !== king.color || rook.hasMoved || i < 2) continue;
    const [pass, land] = [ray[0]!, ray[1]!];
    if (isAttacked(v, board, pass, king.color) || isAttacked(v, board, land, king.color)) continue;
    out.push({ from, to: land, castle: { side: i === 2 ? "short" : "long", rookFrom: ray[i]!, rookTo: pass } });
  }
}

function pseudoLegalMoves(v: Variant, state: GameState, color: PlayerColor): InternalMove[] {
  const { board } = state;
  const out: InternalMove[] = [];

  board.forEach((piece, from) => {
    if (!piece || piece.color !== color) return;
    const slide = (rays: readonly (readonly number[])[], maxSteps: number) => {
      for (const ray of rays) {
        for (let i = 0; i < ray.length && i < maxSteps; i++) {
          const target = board[ray[i]!];
          if (!target || target.color !== color) out.push({ from, to: ray[i]! });
          if (target) break;
        }
      }
    };
    const jump = (targets: readonly number[]) => {
      for (const to of targets) if (board[to]?.color !== color) out.push({ from, to });
    };

    switch (piece.type) {
      case "pawn":
        return pawnMoves(v, state, from, piece, out);
      case "knight":
        return jump(v.knight[from]!);
      case "bishop":
        return slide(v.diagRays[from]!, Infinity);
      case "rook":
        return slide(v.orthRays[from]!, Infinity);
      case "queen":
        slide(v.orthRays[from]!, Infinity);
        return slide(v.diagRays[from]!, Infinity);
      case "king":
        jump(v.king[from]!);
        return castlingMoves(v, board, from, piece, out);
    }
  });

  // Branching diagonals on the 3-player board can reach one square two ways; keep one.
  const seen = new Set<string>();
  return out.filter((m) => {
    const key = `${m.from}-${m.to}-${m.promotion ?? ""}-${m.castle?.side ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** All moves `color` may make that do not leave their own king attacked. */
export function generateLegalMoves(state: GameState, color: PlayerColor): InternalMove[] {
  const v = getVariant(state.variant);
  return pseudoLegalMoves(v, state, color).filter((move) => !isKingInCheck(v, applyToBoard(state.board, move).board, color));
}
