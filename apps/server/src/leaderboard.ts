import type { BotLevel } from "@fourman/game-engine";
import type { LeaderboardPeriod, LeaderboardRow, LeaderboardView, RecentGame } from "@fourman/shared";
import type { Room } from "./rooms.js";

const PERIOD_MS: Record<LeaderboardPeriod, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  all: Infinity,
};
const RECENT_SHOWN = 12;

const botName = (level: BotLevel) => `${level[0]!.toUpperCase()}${level.slice(1)} Bot`;

/** People share a row when their names match, ignoring case; bots share one row per level. */
const entrantKey = (name: string, bot: BotLevel | null) => (bot ? `bot:${bot}` : `name:${name.trim().toLowerCase()}`);

/** What a finished room contributes to the leaderboard. Seats that sat the game out aren't in it. */
export function resultOf(room: Room, finishedAt = Date.now()): RecentGame | null {
  if (room.phase !== "finished") return null;
  const players = room.players.flatMap((color) => {
    const seat = room.seats[color];
    if (!seat) return [];
    const name = seat.bot ? botName(seat.bot) : seat.name;
    return [{ key: entrantKey(seat.name, seat.bot), name, bot: seat.bot, color }];
  });
  const winner = room.state.winner ? (players.find((p) => p.color === room.state.winner)?.key ?? null) : null;
  return { id: room.id, variant: room.variant, finishedAt, winner, players };
}

/** Every finished game the server knows of, and the standings worked out from them. */
export class Leaderboard {
  private games = new Map<string, RecentGame>();

  /** `onRecord` hears about each newly finished game, e.g. to persist it. */
  constructor(private onRecord: (game: RecentGame) => void = () => {}) {}

  load(games: RecentGame[]): void {
    for (const game of games) this.games.set(game.id, game);
  }

  /** Counts a room once it has finished; later calls for the same room are ignored. */
  record(room: Room): void {
    if (this.games.has(room.id)) return;
    const game = resultOf(room);
    if (!game) return;
    this.games.set(game.id, game);
    this.onRecord(game);
  }

  view(period: LeaderboardPeriod, now = Date.now()): LeaderboardView {
    const since = now - PERIOD_MS[period];
    // Reversed first so games that finished in the same millisecond still list newest first.
    const games = [...this.games.values()]
      .reverse()
      .filter((g) => g.finishedAt > since)
      .sort((a, b) => b.finishedAt - a.finishedAt);

    const rows = new Map<string, LeaderboardRow>();
    for (const game of games) {
      // Three Hard bots at one table still make one game (and at most one win) for "Hard Bot".
      const entrants = new Map(game.players.map((p) => [p.key, p]));
      for (const p of entrants.values()) {
        // Newest game first, so the first name seen is the latest spelling.
        const row = rows.get(p.key) ?? { key: p.key, name: p.name, bot: p.bot, games: 0, wins: 0, lastPlayed: game.finishedAt };
        row.games += 1;
        if (game.winner === p.key) row.wins += 1;
        rows.set(p.key, row);
      }
    }
    const ranked = [...rows.values()].sort(
      (a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || b.games - a.games || a.name.localeCompare(b.name),
    );
    return { period, rows: ranked, recent: games.slice(0, RECENT_SHOWN) };
  }
}
