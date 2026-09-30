import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RoomStore } from "./store.js";

/** Games on the "coming soon" shelf that visitors can bid for. */
export const VOTABLE_GAMES = ["ludo", "oware", "morabaraba", "fanorona", "bao", "draughts"] as const;
/** One bid per visitor per game in this window; enough to keep the counts honest, not a fortress. */
const REPEAT_MS = 12 * 60 * 60 * 1000;

/**
 * GET /votes and POST /votes/:game for the hub's "bid for it" buttons. The hub
 * lives on another origin, so these answer with an open CORS header. A POST
 * with no body is a "simple" request, so browsers skip the preflight.
 */
export async function registerVotes(app: FastifyInstance, store: RoomStore) {
  const counts = new Map<string, number>(VOTABLE_GAMES.map((g) => [g, 0]));
  for (const [game, n] of Object.entries(await store.loadVotes())) if (counts.has(game)) counts.set(game, n);
  const recent = new Map<string, number>();
  const snapshot = () => Object.fromEntries(counts);
  const visitor = (req: FastifyRequest) => String(req.headers["x-forwarded-for"] ?? req.ip).split(",")[0]!.trim();

  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/votes")) reply.header("access-control-allow-origin", "*");
  });

  app.get("/votes", async () => ({ votes: snapshot() }));

  app.post<{ Params: { game: string } }>("/votes/:game", async (req, reply) => {
    const { game } = req.params;
    if (!counts.has(game)) return reply.code(404).send({ error: "Unknown game" });
    const key = `${visitor(req)}:${game}`;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < REPEAT_MS) return { counted: false, votes: snapshot() };
    recent.set(key, now);
    if (recent.size > 50_000) recent.clear();
    counts.set(game, counts.get(game)! + 1);
    store.addVote(game);
    return { counted: true, votes: snapshot() };
  });
}
