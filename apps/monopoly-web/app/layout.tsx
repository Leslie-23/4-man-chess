import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GAME_NAME, TAGLINE } from "../lib/look";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://lesliepaul-tycoon.onrender.com"),
  title: `${GAME_NAME} · Leslie Paul Games`,
  description: `${TAGLINE}. Buy streets, build hotels, bankrupt your friends. Plays in the browser, with bots for empty seats.`,
  openGraph: { title: GAME_NAME, description: TAGLINE, type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
