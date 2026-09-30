export type PlayerColor = "white" | "black" | "red" | "blue" | "yellow" | "green";

/** Which board is being played: 2-player 8×8, 3-player hexagon, or 4-player cross. */
export type VariantId = "two" | "three" | "four";

export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type PromotionPiece = "queen" | "rook" | "bishop" | "knight";

/** Square name: "e4" (2-player), "We2" (3-player: half + file + rank) or "n14" (4-player). */
export type Square = string;

export interface Piece {
  type: PieceType;
  color: PlayerColor;
  /** Needed for castling rights and pawn double-steps. */
  hasMoved: boolean;
}

/** One entry per playable cell of the variant, indexed as in `Variant.names`. */
export type Board = (Piece | null)[];

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
  /** If given, must match the player whose turn it is. */
  player?: PlayerColor;
}

export interface LegalMove {
  from: Square;
  to: Square;
  piece: PieceType;
  capture?: PieceType;
  promotion?: PromotionPiece;
  castle?: "short" | "long";
  enPassant?: boolean;
}

export interface MoveRecord extends LegalMove {
  ply: number;
  player: PlayerColor;
  capturedColor?: PlayerColor;
}

export type EliminationReason = "checkmate" | "stalemate" | "king-captured" | "resigned" | "timeout";

export interface Elimination {
  player: PlayerColor;
  reason: EliminationReason;
  ply: number;
  /** Set when a king is captured outright. */
  by?: PlayerColor;
}

export interface EnPassantTarget {
  /** The square the pawn skipped over. */
  square: Square;
  /** Where the double-stepped pawn now stands. */
  pawnSquare: Square;
  owner: PlayerColor;
}

export interface GameOptions {
  /** 4-player only: relative rank (1-based, from the owner's side) where pawns promote. Default 8 (the centre line). */
  promotionRank: number;
  /** Plies without a capture or pawn move before the game is drawn. Defaults to 50 full rounds. */
  noProgressLimit: number;
}

export type DrawReason = "only-kings" | "no-progress" | "stalemate";

export type GameStatus = "playing" | "finished";

export interface GameState {
  variant: VariantId;
  board: Board;
  currentPlayer: PlayerColor;
  status: GameStatus;
  /** Number of moves played so far. */
  ply: number;
  history: MoveRecord[];
  eliminations: Elimination[];
  /** Double-step targets; each expires when its owner moves again. */
  enPassant: EnPassantTarget[];
  /** Plies since the last capture or pawn move. */
  pliesSinceProgress: number;
  winner: PlayerColor | null;
  /** Set when the game finished without a winner. */
  drawReason: DrawReason | null;
  options: GameOptions;
}

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalMoveError";
  }
}
