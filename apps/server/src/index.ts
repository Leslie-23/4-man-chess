import { networkInterfaces } from "node:os";
import { DEFAULT_SERVER_PORT } from "@fourman/shared";
import { buildServer } from "./app.js";
import { MemoryStore, MongoStore, type RoomStore } from "./store.js";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

// With MONGODB_URI set, rooms survive restarts; without it they live in memory only.
const store: RoomStore = process.env.MONGODB_URI
  ? await MongoStore.connect(process.env.MONGODB_URI, process.env.MONGODB_DB ?? "fourman")
  : new MemoryStore();
const { app, restore } = buildServer({ logger: true, store });
const resumed = await restore();
app.log.info(process.env.MONGODB_URI ? `MongoDB connected; resumed ${resumed} unfinished game(s)` : "No MONGODB_URI: rooms are kept in memory only");

await app.listen({ port, host: "0.0.0.0" });

// Render (and most hosts) send SIGTERM before replacing the instance; flush pending writes first.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n?.family === "IPv4" && !n.internal)
  .map((n) => `http://${n!.address}:${port}`);
app.log.info(`Game server reachable on your network at: ${lan.join(", ") || "(no LAN address found)"}`);
