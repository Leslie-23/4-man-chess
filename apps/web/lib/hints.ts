"use client";

import {
  activePlayers,
  chooseBotMove,
  getLegalMoves,
  getVariant,
  isInCheck,
  type GameState,
  type LegalMove,
  type PlayerColor,
} from "@fourman/game-engine";
import { useMemo } from "react";

export interface Hints {
  /** A good move for us right now, if it's our turn. */
  suggestion: LegalMove | null;
  /** Squares holding our pieces that another army could take on its next move. */
  danger: ReadonlySet<string>;
  inCheck: boolean;
}

const NONE: Hints = { suggestion: null, danger: new Set(), inCheck: false };

/**
 * Coaching for `color`: the move the advanced bot would play on our turn, and
 * which of our pieces are hanging. Worked out once per position.
 */
export function useHints(state: GameState, color: PlayerColor | null, enabled: boolean): Hints {
  return useMemo(() => {
    if (!enabled || !color || state.status !== "playing" || !activePlayers(state).includes(color)) return NONE;
    const variant = getVariant(state.variant);

    const danger = new Set<string>();
    for (const rival of activePlayers(state)) {
      if (rival === color) continue;
      // Ask what the rival could do if it were their turn now.
      for (const move of getLegalMoves({ ...state, currentPlayer: rival })) {
        if (move.capture && state.board[variant.indexOf(move.to)]?.color === color) danger.add(move.to);
      }
    }

    let suggestion: LegalMove | null = null;
    if (state.currentPlayer === color) {
      const pick = chooseBotMove(state, Math.random, "advanced");
      suggestion = pick ? (getLegalMoves(state, pick.from).find((m) => m.to === pick.to) ?? null) : null;
    }
    return { suggestion, danger, inCheck: isInCheck(state, color) };
  }, [state, color, enabled]);
}
