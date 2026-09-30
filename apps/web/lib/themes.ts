import type { BotLevel } from "@fourman/game-engine";

export interface BoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Tint for the last move's squares. */
  last: string;
  selected: string;
  /** Legal-move dots and capture rings. */
  hint: string;
  /** Glow behind pieces so they read on dark squares. */
  halo: string;
}

export const BOARD_THEMES = [
  { id: "classic", name: "Classic", light: "#ede3cf", dark: "#b59c77", last: "rgb(255 208 64 / 0.5)", selected: "rgb(0 0 0 / 0.22)", hint: "rgb(0 0 0 / 0.3)", halo: "transparent" },
  { id: "mono", name: "Mono", light: "#ffffff", dark: "#141414", last: "rgb(140 140 140 / 0.55)", selected: "rgb(140 140 140 / 0.85)", hint: "rgb(128 128 128 / 0.9)", halo: "#ffffff" },
  { id: "tournament", name: "Tournament", light: "#eeeed2", dark: "#769656", last: "rgb(246 246 105 / 0.6)", selected: "rgb(0 0 0 / 0.2)", hint: "rgb(0 0 0 / 0.28)", halo: "transparent" },
  { id: "slate", name: "Slate", light: "#dfe5ec", dark: "#7a8898", last: "rgb(120 180 255 / 0.45)", selected: "rgb(0 0 0 / 0.22)", hint: "rgb(0 0 0 / 0.3)", halo: "transparent" },
  { id: "paper", name: "Paper", light: "#fbfbfb", dark: "#cfcfcf", last: "rgb(0 0 0 / 0.12)", selected: "rgb(0 0 0 / 0.25)", hint: "rgb(0 0 0 / 0.35)", halo: "transparent" },
  { id: "midnight", name: "Midnight", light: "#505a6d", dark: "#2c323e", last: "rgb(255 208 64 / 0.35)", selected: "rgb(255 255 255 / 0.2)", hint: "rgb(255 255 255 / 0.4)", halo: "rgb(0 0 0 / 0.6)" },
] as const satisfies readonly BoardTheme[];

export type BoardThemeId = (typeof BOARD_THEMES)[number]["id"];
export const BOARD_THEME_IDS = BOARD_THEMES.map((t) => t.id);
export const themeById = (id: string): BoardTheme => BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];

export const BOT_LEVEL_INFO: Record<BotLevel, { name: string; blurb: string }> = {
  easy: { name: "Easy", blurb: "Mostly random. Good for learning how the pieces move." },
  hard: { name: "Hard", blurb: "Grabs free pieces and avoids obvious blunders." },
  advanced: { name: "Advanced", blurb: "Guards its whole army, sets up threats, plays to win." },
};
