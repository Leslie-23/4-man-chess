import type { Metadata } from "next";
import type { ReactNode } from "react";

const title = "Leaderboard · 4-Man Chess";
const description = "Who's winning at 4-Man Chess: people and bots, over the last day, week or all time.";

export const metadata: Metadata = { title, description, openGraph: { title, description }, twitter: { title, description } };

export default function LeaderboardLayout({ children }: { children: ReactNode }) {
  return children;
}
