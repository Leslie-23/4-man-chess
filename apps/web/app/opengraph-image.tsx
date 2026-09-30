import { SHARE_SIZE, shareCard } from "../lib/shareCard";

export const alt = "4-Man Chess: chess for two, three or four players, with friends or bots";
export const size = SHARE_SIZE;
export const contentType = "image/png";

export default function Image() {
  return shareCard({
    eyebrow: "2 · 3 · 4 players",
    title: "Chess for everyone at the table",
    subtitle: "Invite friends with a code, or fill the seats with bots.",
  });
}
