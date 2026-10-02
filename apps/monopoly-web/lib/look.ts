import type { ColorGroup } from "@fourman/monopoly-engine";

/** Token colours by seat. */
export const TOKEN = ["#d7362d", "#2b6be0", "#e0a810", "#229a4f", "#8e44ad", "#f08a24"] as const;
export const tokenColor = (playerId: string) => TOKEN[Number(playerId.slice(1)) % TOKEN.length]!;

export const GROUP_COLOR: Record<ColorGroup, string> = {
  brown: "#8b5a2b",
  sky: "#8fd3f4",
  pink: "#d6479b",
  orange: "#f08a24",
  red: "#d7362d",
  yellow: "#f2c318",
  green: "#229a4f",
  navy: "#1f3a93",
};

export const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * Where square `i` sits on the 11×11 grid: Go in the bottom-right corner,
 * then clockwise along the bottom, up the left, across the top, down the right.
 */
export function gridSpot(i: number): { row: number; col: number; side: "bottom" | "left" | "top" | "right" | "corner" } {
  if (i === 0) return { row: 11, col: 11, side: "corner" };
  if (i < 10) return { row: 11, col: 11 - i, side: "bottom" };
  if (i === 10) return { row: 11, col: 1, side: "corner" };
  if (i < 20) return { row: 11 - (i - 10), col: 1, side: "left" };
  if (i === 20) return { row: 1, col: 1, side: "corner" };
  if (i < 30) return { row: 1, col: 1 + (i - 20), side: "top" };
  if (i === 30) return { row: 1, col: 11, side: "corner" };
  return { row: 1 + (i - 30), col: 11, side: "right" };
}

/** The public name. "Monopoly" is a trademark, so the site uses its own; change it here. */
export const GAME_NAME = "Tycoon";
export const TAGLINE = "A Monopoly-style property game for 2–6 players";

/** The 3D picture for an animal token (Fluent Emoji, MIT; see public/animals/LICENSE.txt). */
export const animalSrc = (animal: string) => `/animals/${animal}.png`;
export const animalLabel = (animal: string) => animal[0]!.toUpperCase() + animal.slice(1);
