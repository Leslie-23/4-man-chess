import Fastify, { type FastifyServerOptions } from "fastify";
import { Server } from "socket.io";
import { RoomManager } from "./rooms.js";
import { attachSockets, type GameServer } from "./sockets.js";
import { MemoryStore, type RoomStore } from "./store.js";

const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
/** Unfinished games younger than this are picked up again after a restart. */
const RESUME_MS = 24 * 60 * 60 * 1000;

/** "app.example.com" or "https://app.example.com" → "https://app.example.com" */
const withScheme = (origin: string) => (/^https?:\/\//.test(origin) ? origin : `https://${origin}`);

export function buildServer(options: FastifyServerOptions & { botDelayMs?: number; store?: RoomStore } = {}) {
  const { botDelayMs = Number(process.env.BOT_DELAY_MS ?? 700), store = new MemoryStore(), ...fastifyOptions } = options;
  const app = Fastify(fastifyOptions);
  const rooms = new RoomManager((room) => store.save(room));
  const io: GameServer = new Server(app.server, {
    // Comma-separated allow-list in production; any origin in development so phones on the LAN can connect.
    cors: { origin: process.env.CORS_ORIGIN?.split(",").map((o) => withScheme(o.trim())) ?? true },
  });
  const resumeBots = attachSockets(io, rooms, app.log, { botDelayMs });

  /** Loads unfinished games from the store and lets any bot whose turn it is carry on. */
  const restore = async () => {
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

  return { app, io, rooms, restore };
}
