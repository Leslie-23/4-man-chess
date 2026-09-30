import type { Metadata } from "next";
import type { ReactNode } from "react";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const code = id.toUpperCase().slice(0, 5);
  const title = `Join room ${code} · 4-Man Chess`;
  const description = "You're invited to a game of 4-Man Chess. Tap to take your seat.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

export default function RoomLayout({ children }: { children: ReactNode }) {
  return children;
}
