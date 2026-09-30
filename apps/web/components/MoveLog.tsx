"use client";

import type { Elimination, MoveRecord, PlayerColor } from "@fourman/game-engine";
import type { RoomView } from "@fourman/shared";

const WHY: Record<Elimination["reason"], string> = {
  checkmate: "checkmate: in check with no way out",
  stalemate: "stalemate: no legal move on their turn",
  "king-captured": "their king was captured",
  resigned: "resigned",
  timeout: "ran out of time",
};

type Entry = { ply: number; text: string; color: PlayerColor; key: string };

/** Newest-first, plain-English list of what has happened in the game. */
export function MoveLog({ room }: { room: RoomView }) {
  const who = (c: PlayerColor) => room.seats[c]?.name ?? c[0]!.toUpperCase() + c.slice(1);
  const describe = (m: MoveRecord) => {
    if (m.castle) return `castles ${m.castle}`;
    let text = `${m.piece} ${m.from} → ${m.to}`;
    if (m.capture) text += `, takes ${m.capturedColor ? `${who(m.capturedColor)}'s ` : ""}${m.capture}${m.enPassant ? " en passant" : ""}`;
    if (m.promotion) text += `, promotes to ${m.promotion}`;
    return text;
  };

  const entries: Entry[] = [
    ...room.state.history.map((m) => ({ ply: m.ply, color: m.player, text: describe(m), key: `m${m.ply}` })),
    // Seats that were empty at the start aren't news.
    ...room.state.eliminations
      .filter((e) => room.seats[e.player])
      .map((e, i) => ({
        ply: e.ply + 0.5,
        color: e.player,
        text: `is out (${e.reason === "king-captured" && e.by ? `king captured by ${who(e.by)}` : WHY[e.reason]})`,
        key: `e${i}`,
      })),
  ].sort((a, b) => b.ply - a.ply);

  if (entries.length === 0) return <p className="muted small-text">No moves yet.</p>;
  return (
    <ol className="log">
      {entries.slice(0, 80).map((e) => (
        <li key={e.key} className={e.key.startsWith("e") ? "event" : undefined}>
          <span className={`swatch ${e.color}`} />
          <span>
            <strong>{who(e.color)}</strong> {e.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
