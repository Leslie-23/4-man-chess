"use client";

import { PIECE_VALUE, type GameState, type PlayerColor } from "@fourman/game-engine";
import type { SeatView } from "@fourman/shared";
import type { ReactNode } from "react";
import { BOT_LEVEL_INFO } from "../lib/themes";

interface PlateProps {
  color: PlayerColor;
  seat: SeatView | null;
  state: GameState;
  isTurn: boolean;
  isYou: boolean;
  /** An open seat waiting for a friend to join with the code. */
  waiting?: boolean;
  /** Optional control shown on the plate. */
  action?: ReactNode;
  /** In the voice channel, and talking right now. */
  onVoice?: boolean;
  speaking?: boolean;
}

/** Name card for one seat, drawn in the board corner beside that army. */
export function PlayerPlate({ color, seat, state, isTurn, isYou, waiting = false, action, onVoice = false, speaking = false }: PlateProps) {
  const elimination = state.eliminations.find((e) => e.player === color);
  const material = state.board.reduce((sum, p) => (p && p.color === color && p.type !== "king" ? sum + PIECE_VALUE[p.type] : sum), 0);

  const tags: string[] = [];
  if (isYou) tags.push("You");
  if (seat?.bot) tags.push(`${BOT_LEVEL_INFO[seat.bot].name} bot`);
  if (seat && !seat.connected) tags.push("Offline");
  if (onVoice) tags.push("On voice");

  return (
    <div className={["plate", isTurn && "turn", elimination && seat && "out", speaking && "speaking"].filter(Boolean).join(" ")}>
      <div className="plate-head">
        <span className={`swatch ${color}`} />
        <span className="plate-name">{seat ? seat.name : waiting ? "Waiting…" : "Sitting out"}</span>
      </div>
      <div className="plate-meta">
        {elimination && seat ? (
          <span>Out</span>
        ) : seat ? (
          <>
            <span>{tags.join(" · ") || color}</span>
            <span className="plate-points" title="Material (pawn = 1)">{material}</span>
          </>
        ) : (
          <span>{waiting ? "Friend's seat" : color}</span>
        )}
      </div>
      {isTurn && !elimination && <div className="plate-turn">To move</div>}
      {action && <div className="plate-action">{action}</div>}
    </div>
  );
}
