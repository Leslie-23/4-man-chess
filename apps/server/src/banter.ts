import { activePlayers, isInCheck, type GameState, type PieceType, type PlayerColor } from "@fourman/game-engine";

/** A line a server bot wants to post, in the seat of `color`. */
export interface Remark {
  color: PlayerColor;
  text: string;
}

/** At most this many bot lines per move, so the board never floods. */
const MAX_PER_MOVE = 2;

const pick = (lines: string[], random: () => number) => lines[Math.floor(random() * lines.length)]!;

const TAKES = [
  "I'll take that {piece}.",
  "Thanks for the {piece}.",
  "One {piece}, to go.",
  "Your {piece} looked lonely.",
];
const LOST = ["Hey, that was my {piece}!", "Rude.", "I needed that {piece}.", "Noted, {name}. Noted."];
const CHECK = ["Check, {name}.", "Watch your king, {name}.", "Check. Your move, {name}."];
const KNOCKED_OUT = ["gg, I'm out.", "Well played. I'm done.", "Out already? Rematch soon."];
const KNOCKED_OUT_BY_ME = ["Sorry, {name}. Nothing personal.", "Bye, {name}!", "That's one down."];
const WON = ["Good game, everyone.", "gg! That was fun.", "Victory. Same time tomorrow?"];

const fill = (line: string, piece?: PieceType, name?: string) =>
  line.replace("{piece}", piece ?? "piece").replace("{name}", name ?? "friend");

/**
 * What the bots say about the move that turned `before` into `after`. `isBot`
 * tells which seats the server plays; `who` gives a seat's display name.
 * Big moments (knock-outs, the win) always get a line; small ones only sometimes.
 */
export function banter(
  before: GameState,
  after: GameState,
  isBot: (color: PlayerColor) => boolean,
  who: (color: PlayerColor) => string,
  random: () => number,
): Remark[] {
  const move = after.history.length > before.history.length ? after.history.at(-1) : undefined;
  const remarks: Remark[] = [];
  const say = (color: PlayerColor, chance: number, lines: string[], piece?: PieceType, name?: string) => {
    if (isBot(color) && random() < chance) remarks.push({ color, text: fill(pick(lines, random), piece, name) });
  };

  if (after.status === "finished" && after.winner) say(after.winner, 1, WON);
  for (const out of after.eliminations.slice(before.eliminations.length)) {
    say(out.player, 1, KNOCKED_OUT);
    if (out.by) say(out.by, 0.6, KNOCKED_OUT_BY_ME, undefined, who(out.player));
  }
  if (move?.capture && move.capture !== "king" && move.capturedColor) {
    const big = move.capture === "queen";
    say(move.player, big ? 0.8 : 0.3, TAKES, move.capture);
    say(move.capturedColor, big ? 0.8 : 0.25, LOST, move.capture, who(move.player));
  }
  if (move) {
    for (const color of activePlayers(after)) {
      if (color !== move.player && isInCheck(after, color) && !isInCheck(before, color)) {
        say(move.player, 0.5, CHECK, undefined, who(color));
      }
    }
  }
  return remarks.slice(0, MAX_PER_MOVE);
}

export const GREETINGS = ["Good luck, all.", "glhf!", "Let's go.", "May the best army win."];
