import type { VariantId } from "@fourman/game-engine";

/** Copy for each board, used on the start page and in the rules panel. */
export const VARIANT_INFO: Record<VariantId, { players: number; name: string; tagline: string; squares: number; points: string[]; rules: string[] }> = {
  two: {
    players: 2,
    name: "Classic",
    tagline: "The game everyone knows. One on one.",
    squares: 64,
    points: ["8×8 board, standard rules", "Play a friend or a bot", "Stalemate is a draw"],
    rules: [
      "Standard chess: White moves first, then turns alternate.",
      "Checkmate wins. Stalemate, 50 moves without a capture or pawn move, or bare kings is a draw.",
      "Pawns promote on the far rank. Castling and en passant work as usual.",
    ],
  },
  three: {
    players: 3,
    name: "Hexagon",
    tagline: "Three armies around a six-sided board.",
    squares: 96,
    points: ["96 squares in three halves", "Lines bend through the centre", "Promote on any rival's back rank"],
    rules: [
      "Turns go White → Red → Black, clockwise.",
      "Your files a–d lead into the half on your left, e–h into the half on your right.",
      "A diagonal through the exact centre carries on into both other halves.",
      "Pawns cross the centre and promote on the back rank of the half they reach.",
      "No legal move on your turn means you're out. Last king standing wins.",
    ],
  },
  four: {
    players: 4,
    name: "Cross",
    tagline: "Four armies. Free-for-all. Last king standing.",
    squares: 160,
    points: ["160-square cross board", "Everyone against everyone", "Promote at the centre line"],
    rules: [
      "Turns go Red → Blue → Yellow → Green, clockwise.",
      "Your king can't be left attacked by any of the three opponents.",
      "No legal move on your turn means you're out: checkmate if in check, stalemate if not.",
      "Someone else's move can expose your king. If the next player takes it, you're out.",
      "Pawns promote on reaching the centre line (the 8th row from your side).",
    ],
  },
};
