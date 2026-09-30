import { SHARE_SIZE, shareCard } from "../../../lib/shareCard";

export const alt = "An invitation to a game of 4-Man Chess";
export const size = SHARE_SIZE;
export const contentType = "image/png";

/** The card an invite link shows in chats: it names the room so friends know it's for them. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return shareCard({
    eyebrow: "You're invited",
    title: `Join room ${id.toUpperCase().slice(0, 5)}`,
    subtitle: "Tap to take your seat. No sign-up, plays in the browser on any device.",
  });
}
