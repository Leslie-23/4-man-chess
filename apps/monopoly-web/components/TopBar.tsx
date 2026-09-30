import Link from "next/link";
import type { ReactNode } from "react";
import { GAME_NAME } from "../lib/look";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="wordmark">
        <span className="mark" aria-hidden="true">🏠</span>
        {GAME_NAME}
      </Link>
      {children}
      <a href="https://lesliepaulgames.onrender.com" className="topbar-link">All games</a>
    </header>
  );
}
