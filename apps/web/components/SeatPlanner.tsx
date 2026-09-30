"use client";

import { BOT_LEVELS, type PlayerColor } from "@fourman/game-engine";
import type { SeatPlan } from "@fourman/shared";
import { BOT_LEVEL_INFO } from "../lib/themes";

const OPTIONS: readonly { value: SeatPlan; label: string }[] = [
  { value: "friend", label: "Friend" },
  ...BOT_LEVELS.map((l) => ({ value: l, label: BOT_LEVEL_INFO[l].name })),
];

export const colorLabel = (c: PlayerColor) => c[0]!.toUpperCase() + c.slice(1);

interface Row {
  color: PlayerColor;
  plan: SeatPlan;
  /** Set when a person already sits here; the row is then fixed. */
  occupant?: string;
}

/** One row per opponent seat: a friend joining with the code, or a bot at some level. */
export function SeatPlanner({ rows, onChange, disabled = false }: { rows: Row[]; onChange: (color: PlayerColor, plan: SeatPlan) => void; disabled?: boolean }) {
  return (
    <div className="planner">
      {rows.map(({ color, plan, occupant }) => (
        <div key={color} className="planner-row">
          <span className="planner-seat">
            <span className={`swatch ${color}`} />
            {colorLabel(color)}
          </span>
          {occupant ? (
            <span className="planner-occupant">{occupant}</span>
          ) : (
            <div className="segmented small" role="radiogroup" aria-label={`${colorLabel(color)} seat`}>
              {OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={o.value === plan}
                  className={o.value === plan ? "on" : undefined}
                  disabled={disabled}
                  onClick={() => onChange(color, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** "You + 1 friend + 2 bots" */
export function describePlan(plans: SeatPlan[]): string {
  const friends = plans.filter((p) => p === "friend").length;
  const bots = plans.length - friends;
  const parts = ["You"];
  if (friends) parts.push(`${friends} friend${friends > 1 ? "s" : ""}`);
  if (bots) parts.push(`${bots} bot${bots > 1 ? "s" : ""}`);
  return parts.join(" + ");
}
