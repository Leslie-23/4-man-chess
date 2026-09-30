import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

/** Trophy outline in the current text colour. */
function Trophy() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M4.5 2h7v4a3.5 3.5 0 0 1-7 0z" />
      <path d="M4.5 3.5H2v1a2.5 2.5 0 0 0 2.6 2.5M11.5 3.5H14v1a2.5 2.5 0 0 1-2.6 2.5" />
      <path d="M8 9.5V12M5 14h6M6 12h4" />
    </svg>
  );
}

/** The page header: the mark and name on the left, then page items, then the leaderboard button. */
export function TopBar({ children, leaderboard = true }: { children?: ReactNode; leaderboard?: boolean }) {
  return (
    <header className="topbar">
      <Link href="/" className="wordmark">
        <BrandMark size={26} />
        <span>4-Man Chess</span>
      </Link>
      {children}
      {leaderboard && (
        <Link href="/leaderboard" className="button leaderboard-button">
          <Trophy />
          <span>Leaderboard</span>
        </Link>
      )}
    </header>
  );
}
