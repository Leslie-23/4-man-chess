import type { AddressInfo } from "node:net";
import type { ClientToServerEvents, RecentGame, RoomView, ServerToClientEvents } from "@fourman/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import type { Room } from "../src/rooms.js";
import type { RoomStore } from "../src/store.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Keeps rooms as JSON between "restarts", the way a database would. */
class JsonStore implements RoomStore {
  docs = new Map<string, string>();
  async loadActive(): Promise<Room[]> {
    return [...this.docs.values()]
      .map((d) => JSON.parse(d) as Room)
      .filter((r) => r.phase !== "finished")
      .map((r) => ({ ...r, seats: Object.fromEntries(Object.entries(r.seats).map(([c, s]) => [c, s && { ...s, connections: 0 }])) }));
  }
  save(room: Room): void {
    this.docs.set(room.id, JSON.stringify(room));
  }
  results = new Map<string, string>();
  async loadResults(): Promise<RecentGame[]> {
    return [...this.results.values()].map((r) => JSON.parse(r) as RecentGame);
  }
  saveResult(game: RecentGame): void {
    this.results.set(game.id, JSON.stringify(game));
  }
  async close(): Promise<void> {}
}

const servers: ReturnType<typeof buildServer>[] = [];
const clients: Client[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await Promise.all(servers.splice(0).map((s) => s.app.close()));
});

async function start(store: RoomStore) {
  const server = buildServer({ store, botDelayMs: 5, complete: null, voice: null });
  servers.push(server);
  await server.restore();
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;
  return { server, url };
}

async function client(url: string): Promise<Client> {
  const socket: Client = connect(url, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  return socket;
}

const nextUpdate = (socket: Client, predicate: (room: RoomView) => boolean) =>
  new Promise<RoomView>((resolve) => {
    const listener = (room: RoomView) => {
      if (!predicate(room)) return;
      socket.off("room:update", listener);
      resolve(room);
    };
    socket.on("room:update", listener);
  });

describe("persistence", () => {
  it("resumes a game after the server restarts, with seats and bots intact", async () => {
    const store = new JsonStore();
    const first = await start(store);
    const host = await client(first.url);
    const created = await host.emitWithAck("room:create", { name: "Ada", variant: "two", seats: ["hard"] });
    if (!created.ok) throw new Error(created.error);
    const replied = nextUpdate(host, (r) => r.state.ply === 2);
    await host.emitWithAck("game:move", { roomId: created.roomId, move: { from: "e2", to: "e4" } });
    await replied;

    // Restart: a new server process sharing only the store.
    host.disconnect();
    await first.server.app.close();
    const second = await start(store);

    const back = await client(second.url);
    const updated = nextUpdate(back, () => true);
    const rejoined = await back.emitWithAck("room:join", { roomId: created.roomId, name: "Ada", token: created.token! });
    expect(rejoined).toMatchObject({ ok: true, color: "white" });
    const room = await updated;
    expect(room.state.ply).toBe(2);
    expect(room.seats.black).toMatchObject({ bot: "hard" });

    // The game carries on, and the bot still answers.
    const answered = nextUpdate(back, (r) => r.state.ply === 4);
    expect(await back.emitWithAck("game:move", { roomId: created.roomId, move: { from: "d2", to: "d4" } })).toEqual({ ok: true });
    expect((await answered).state.history.at(-1)!.player).toBe("black");
  });

  it("lets a bot whose turn it was carry on after a restart with nobody connected", async () => {
    const store = new JsonStore();
    const first = await start(store);
    const host = await client(first.url);
    const created = await host.emitWithAck("room:create", { name: "Ada", variant: "three", seats: ["easy", "easy"] });
    if (!created.ok) throw new Error(created.error);
    await host.emitWithAck("game:resign", { roomId: created.roomId });
    host.disconnect();
    await first.server.app.close();

    // Mid-game between two bots; after the restart they should keep playing unattended.
    const plyBefore = (JSON.parse(store.docs.get(created.roomId)!) as Room).state.ply;
    const second = await start(store);
    await new Promise((r) => setTimeout(r, 200));
    const resumed = second.server.rooms.get(created.roomId);
    expect(resumed.state.ply > plyBefore || resumed.phase === "finished").toBe(true);
  });

  it("keeps the leaderboard across a restart", async () => {
    const store = new JsonStore();
    const first = await start(store);
    const host = await client(first.url);
    const created = await host.emitWithAck("room:create", { name: "Ada", variant: "two", seats: ["hard"] });
    if (!created.ok) throw new Error(created.error);
    await host.emitWithAck("game:resign", { roomId: created.roomId });
    host.disconnect();
    await first.server.app.close();

    const second = await start(store);
    const reader = await client(second.url);
    const reply = await reader.emitWithAck("leaderboard:get", { period: "all" });
    if (!reply.ok) throw new Error(reply.error);
    expect(reply.board.rows).toMatchObject([
      { key: "bot:hard", wins: 1, games: 1 },
      { key: "name:ada", wins: 0, games: 1 },
    ]);
  });
});
