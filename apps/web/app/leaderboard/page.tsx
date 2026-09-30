"use client";

import type { LeaderboardPeriod, LeaderboardView } from "@fourman/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Segmented } from "../../components/Controls";
import { TopBar } from "../../components/TopBar";
import { getSocket } from "../../lib/socket";
import { VARIANT_INFO } from "../../lib/variants";

const PERIOD_OPTIONS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "day", label: "24 hours" },
  { value: "week", label: "7 days" },
  { value: "all", label: "All time" },
];
const REFRESH_MS = 30_000;

function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Who (and which bot level) has won the most finished games over a period. */
export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [board, setBoard] = useState<LeaderboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const load = async () => {
      const result = await getSocket().timeout(10_000).emitWithAck("leaderboard:get", { period }).catch(() => null);
      if (!live) return;
      if (!result) return setError("Can't reach the game server");
      if (!result.ok) return setError(result.error);
      setBoard(result.board);
      setNow(Date.now());
      setError(null);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [period]);

  const rows = board?.period === period ? board.rows : null;
  const leader = rows?.[0];

  return (
    <div className="app">
      <TopBar leaderboard={false} />

      <main className="leaderboard">
        <div className="leaderboard-head">
          <h1>Leaderboard</h1>
          <Segmented label="Period" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
        </div>
        {error && <p className="error">{error}</p>}

        {!rows ? (
          <p className="muted">{error ? "" : "Loading…"}</p>
        ) : rows.length === 0 ? (
          <div className="block card">
            <p>No finished games in this period yet.</p>
            <Link href="/" className="button primary">Start a game</Link>
          </div>
        ) : (
          <>
            {leader && (
              <p className="leader-line">
                <span className="label">Leading</span>
                <strong>{leader.name}</strong>
                <span className="muted">
                  {leader.wins} {leader.wins === 1 ? "win" : "wins"} in {leader.games} {leader.games === 1 ? "game" : "games"}
                </span>
              </p>
            )}
            <table className="ranking">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Wins</th>
                  <th scope="col" className="num">Games</th>
                  <th scope="col" className="num">Win rate</th>
                  <th scope="col" className="num">Last game</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td>{i + 1}</td>
                    <td>
                      {r.name}
                      {r.bot && <span className="chat-tag"> bot</span>}
                    </td>
                    <td className="num"><strong>{r.wins}</strong></td>
                    <td className="num">{r.games}</td>
                    <td className="num">{Math.round((r.wins / r.games) * 100)}%</td>
                    <td className="num muted">{ago(r.lastPlayed, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Players are grouped by name, so use the same name each time. Bots are grouped by level.</p>

            <h2 className="label">Latest games</h2>
            <ol className="log recent">
              {board!.recent.map((g) => (
                <li key={g.id}>
                  <span className="muted">{ago(g.finishedAt, now)}</span>
                  <span className="muted">{VARIANT_INFO[g.variant].players}p</span>
                  <span className="recent-players">
                    {g.players.map((p) => (
                      <span key={p.color} className={p.key === g.winner ? "recent-player won" : "recent-player"}>
                        <span className={`swatch ${p.color}`} />
                        {p.name}
                      </span>
                    ))}
                  </span>
                  <span>{g.winner ? `${g.players.find((p) => p.key === g.winner)?.name} won` : "Draw"}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
