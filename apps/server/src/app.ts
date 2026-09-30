import Fastify, { type FastifyServerOptions } from "fastify";
import { Server } from "socket.io";
import { Leaderboard } from "./leaderboard.js";
import { groqComplete, type Complete } from "./replies.js";
import { RoomManager } from "./rooms.js";
import { attachSockets, type GameServer } from "./sockets.js";
import { MemoryStore, type RoomStore } from "./store.js";

const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
/** Unfinished games younger than this are picked up again after a restart. */
const RESUME_MS = 24 * 60 * 60 * 1000;

/** "app.example.com" or "https://app.example.com" → "https://app.example.com" */
const withScheme = (origin: string) => (/^https?:\/\//.test(origin) ? origin : `https://${origin}`);

/** Bots answer chat through Groq when a key is set; the model can be swapped without a code change. */
const groqFromEnv = (log: (error: unknown) => void): Complete | undefined =>
  process.env.GROQ_API_KEY ? groqComplete(process.env.GROQ_API_KEY, process.env.GROQ_MODEL ?? "llama-3.1-8b-instant", log) : undefined;

export function buildServer(options: FastifyServerOptions & { botDelayMs?: number; store?: RoomStore; complete?: Complete | null } = {}) {
  const { botDelayMs = Number(process.env.BOT_DELAY_MS ?? 700), store = new MemoryStore(), complete, ...fastifyOptions } = options;
  const app = Fastify(fastifyOptions);
  const leaderboard = new Leaderboard((game) => store.saveResult(game));
  const rooms = new RoomManager((room) => {
    store.save(room);
    leaderboard.record(room);
  });
  const io: GameServer = new Server(app.server, {
    // Comma-separated allow-list in production; any origin in development so phones on the LAN can connect.
    cors: { origin: process.env.CORS_ORIGIN?.split(",").map((o) => withScheme(o.trim())) ?? true },
  });
  // `complete: null` turns replies off even when GROQ_API_KEY is set (tests).
  const replies = complete === null ? undefined : (complete ?? groqFromEnv((error) => app.log.warn({ err: error }, "bot reply failed")));
  rooms.coach = Boolean(replies);
  const resumeBots = attachSockets(io, rooms, app.log, { botDelayMs, leaderboard, complete: replies });

  /** Loads unfinished games from the store and lets any bot whose turn it is carry on. */
  const restore = async () => {
    leaderboard.load(await store.loadResults());
    const saved = await store.loadActive(RESUME_MS);
    rooms.restore(saved);
    saved.forEach(resumeBots);
    return saved.length;
  };

  app.get("/health", async () => ({ ok: true }));

  const sweeper = setInterval(() => rooms.sweep(ROOM_IDLE_MS), 10 * 60 * 1000).unref();
  app.addHook("preClose", async () => {
    clearInterval(sweeper);
    io.disconnectSockets(true);
  });
  app.addHook("onClose", async () => store.close());

  return { app, io, rooms, leaderboard, restore };
}
