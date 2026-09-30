"use client";

import { BOARD, type GameState } from "@fourman/monopoly-engine";
import type { ReactNode } from "react";
import { GROUP_COLOR, gridSpot, money, tokenColor } from "../lib/look";

const ICON: Partial<Record<string, string>> = {
  go: "➜",
  chance: "?",
  chest: "✦",
  jail: "▦",
  parking: "P",
  "go-to-jail": "⚑",
  station: "🚉",
  utility: "⚡",
  tax: "%",
};

interface BoardProps {
  state: GameState;
  /** Square the player tapped for details. */
  selected: number | null;
  onSelect: (tile: number) => void;
  /** Squares a hint is pointing at. */
  hinted?: ReadonlySet<number>;
  /** Seat ids talking on voice right now; their tokens glow. */
  speaking?: ReadonlySet<string>;
  /** Whatever sits in the middle of the table: dice, the action panel, the latest card. */
  children: ReactNode;
}

/** The 40-square ring with owners, buildings and tokens; the middle is the table. */
export function Board({ state, selected, onSelect, hinted, speaking, children }: BoardProps) {
  const current = state.players[state.current]!;
  return (
    <div className="board">
      {BOARD.map((tile, i) => {
        const { row, col, side } = gridSpot(i);
        const deed = state.deeds[i];
        const here = state.players.filter((p) => !p.bankrupt && p.position === i);
        const classes = ["tile", side, tile.kind, deed?.mortgaged && "mortgaged", selected === i && "selected", current.position === i && "current", hinted?.has(i) && "hinted"];
        return (
          <button
            key={i}
            type="button"
            className={classes.filter(Boolean).join(" ")}
            style={{ gridRow: row, gridColumn: col, ...(deed?.owner && { "--owner": tokenColor(deed.owner) }) } as React.CSSProperties}
            onClick={() => onSelect(i)}
            aria-label={`${tile.name}${deed?.owner ? `, owned by ${state.players.find((p) => p.id === deed.owner)?.name}` : ""}`}
          >
            {tile.group && <span className="band" style={{ background: GROUP_COLOR[tile.group] }} />}
            {deed && deed.houses > 0 && (
              <span className="buildings" aria-label={deed.houses === 5 ? "hotel" : `${deed.houses} houses`}>
                {deed.houses === 5 ? <i className="hotel" /> : Array.from({ length: deed.houses }, (_, h) => <i key={h} className="house" />)}
              </span>
            )}
            <span className="tile-name">
              {ICON[tile.kind] && <span className="tile-icon">{ICON[tile.kind]}</span>}
              {tile.name}
            </span>
            {tile.price !== undefined && !deed?.owner && <span className="tile-price">{money(tile.price)}</span>}
            {tile.tax !== undefined && <span className="tile-price">{money(tile.tax)}</span>}
            {deed?.owner && <span className="owner-flag" />}
            {here.length > 0 && (
              <span className="tokens">
                {here.map((p) => (
                  <i key={p.id} className={["token", p.inJail && "jailed", speaking?.has(p.id) && "speaking"].filter(Boolean).join(" ")} style={{ background: tokenColor(p.id) }} title={p.name}>
                    {p.name[0]}
                  </i>
                ))}
              </span>
            )}
          </button>
        );
      })}
      <div className="table">{children}</div>
    </div>
  );
}
