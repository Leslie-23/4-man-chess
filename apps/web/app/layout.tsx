import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const title = "4-Man Chess";
const description = "Four-player free-for-all chess with friends or bots.";

export const metadata: Metadata = {
  // Share images need absolute URLs. Set NEXT_PUBLIC_SITE_URL if the site moves to another domain.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://fourman-web.onrender.com"),
  title,
  description,
  applicationName: title,
  openGraph: { type: "website", siteName: title, title, description },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
