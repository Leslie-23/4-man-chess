import type { AddressInfo } from "node:net";
import type { ClientToServerEvents, RoomView, SeatGrant, ServerToClientEvents } from "@fourman/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof buildServer>;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = buildServer({ botDelayMs: 5 });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await server.app.close();
});

async function client(): Promise<Client> {
  const socket: Client = connect(url, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  return socket;
}

/** Resolves with the next room update that satisfies `predicate`. */
function nextUpdate(socket: Client, predicate: (room: RoomView) => boolean = () => true): Promise<RoomView> {
  return new Promise((resolve) => {
    const listener = (room: RoomView) => {
      if (!predicate(room)) return;
      socket.off("room:update", listener);
      resolve(room);
    };
    socket.on("room:update", listener);
  });
}

async function fullRoom() {
  const [host, ...friends] = await Promise.all([client(), client(), client(), client()]);
  const created = await host!.emitWithAck("room:create", { name: "Ada" });
  if (!created.ok) throw new Error(created.error);
  const grants: SeatGrant[] = [created];
  for (const [i, friend] of friends.entries()) {
    const joined = await friend.emitWithAck("room:join", { roomId: created.roomId, name: `Friend ${i}` });
    if (!joined.ok) throw new Error(joined.error);
    grants.push(joined);
  }
  return { roomId: created.roomId, sockets: [host!, ...friends], grants };
}

describe("multiplayer sockets", () => {
  it("seats four players in turn order and starts automatically", async () => {
    const { roomId, grants, sockets } = await fullRoom();
    expect(grants.map((g) => g.color)).toEqual(["red", "blue", "yellow", "green"]);
    const spectator = await client();
    const updated = nextUpdate(sockets[0]!);
    const watched = await spectator.emitWithAck("room:join", { roomId, name: "Eve" });
    expect(watched).toMatchObject({ ok: true, color: null, token: null });
    expect((await updated).phase).toBe("playing");
  });

  it("pushes a move to every device in the room", async () => {
    const { roomId, sockets } = await fullRoom();
    const updates = sockets.map((s) => nextUpdate(s, (room) => room.state.ply === 1));
    const result = await sockets[0]!.emitWithAck("game:move", { roomId, move: { from: "e2", to: "e4" } });
    expect(result).toEqual({ ok: true });
    for (const room of await Promise.all(updates)) {
      expect(room.state.history[0]).toMatchObject({ player: "red", from: "e2", to: "e4" });
      expect(room.state.currentPlayer).toBe("blue");
    }
  });

  it("rejects moves out of turn, illegal moves, junk and spectators", async () => {
    const { roomId, sockets } = await fullRoom();
    const [red, blue] = sockets;
    expect(await blue!.emitWithAck("game:move", { roomId, move: { from: "b5", to: "d5" } })).toMatchObject({ ok: false });
    expect(await red!.emitWithAck("game:move", { roomId, move: { from: "e2", to: "e6" } })).toMatchObject({ ok: false });
    expect(await red!.emitWithAck("game:move", { roomId, move: { from: "zz", to: "e4" } })).toMatchObject({ ok: false });
    expect(await red!.emitWithAck("game:move", { roomId, move: null as never })).toMatchObject({ ok: false, error: "Malformed move" });
    const spectator = await client();
    await spectator.emitWithAck("room:join", { roomId, name: "Eve" });
    expect(await spectator.emitWithAck("game:move", { roomId, move: { from: "e2", to: "e4" } })).toMatchObject({
      ok: false,
      error: "Spectators cannot play",
    });
  });

  it("lets a player reconnect into their seat with their token", async () => {
    const { roomId, sockets, grants } = await fullRoom();
    const blueToken = grants[1]!.token!;
    const disconnected = nextUpdate(sockets[0]!, (room) => room.seats.blue?.connected === false);
    sockets[1]!.disconnect();
    await disconnected;

    const rejoined = await client();
    expect(await rejoined.emitWithAck("room:join", { roomId, name: "Friend 0", token: blueToken })).toMatchObject({
      ok: true,
      color: "blue",
    });
    await sockets[0]!.emitWithAck("game:move", { roomId, move: { from: "e2", to: "e4" } });
    expect(await rejoined.emitWithAck("game:move", { roomId, move: { from: "b5", to: "d5" } })).toEqual({ ok: true });
  });

  it("lets the host turn open seats into bots that play their own turns", async () => {
    const [host, friend] = await Promise.all([client(), client()]);
    const created = await host.emitWithAck("room:create", { name: "Ada" });
    if (!created.ok) throw new Error(created.error);
    const roomId = created.roomId;
    await friend.emitWithAck("room:join", { roomId, name: "Bo" });
    expect(await friend.emitWithAck("room:set-seat", { roomId, color: "yellow", plan: "easy" })).toMatchObject({ ok: false });
    expect(await host.emitWithAck("room:set-seat", { roomId, color: "yellow", plan: "genius" as never })).toMatchObject({ ok: false });
    expect(await host.emitWithAck("room:set-seat", { roomId, color: "blue", plan: "easy" })).toMatchObject({
      ok: false,
      error: "Bo is sitting there",
    });

    expect(await host.emitWithAck("room:set-seat", { roomId, color: "green", plan: "advanced" })).toEqual({ ok: true });
    const full = nextUpdate(host, (room) => room.phase === "playing");
    expect(await host.emitWithAck("room:set-seat", { roomId, color: "yellow", plan: "hard" })).toEqual({ ok: true });
    const room = await full;
    expect(room.seats.yellow).toMatchObject({ name: "Yellow Bot", bot: "hard", connected: true });
    expect(room.seats.green).toMatchObject({ name: "Green Bot", bot: "advanced" });

    // Red and blue are human; after blue moves, both bots answer by themselves.
    await host.emitWithAck("game:move", { roomId, move: { from: "e2", to: "e4" } });
    const botsMoved = nextUpdate(host, (r) => r.state.ply === 4);
    await friend.emitWithAck("game:move", { roomId, move: { from: "b5", to: "d5" } });
    const after = await botsMoved;
    expect(after.state.history.slice(2).map((m) => m.player)).toEqual(["yellow", "green"]);
    expect(after.state.currentPlayer).toBe("red");
  });

  it("plays a whole bot game to the end", async () => {
    const host = await client();
    const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["easy", "hard", "advanced"] });
    if (!created.ok) throw new Error(created.error);
    await host.emitWithAck("game:resign", { roomId: created.roomId });
    const finished = await nextUpdate(host, (room) => room.phase === "finished");
    expect(finished.state.status).toBe("finished");
  }, 60_000);

  it("runs a 2-player game between two friends", async () => {
    const [white, black] = await Promise.all([client(), client()]);
    const created = await white.emitWithAck("room:create", { name: "Ada", variant: "two" });
    if (!created.ok) throw new Error(created.error);
    expect(created.color).toBe("white");
    const started = nextUpdate(white, (room) => room.phase === "playing");
    expect(await black.emitWithAck("room:join", { roomId: created.roomId, name: "Bo" })).toMatchObject({ ok: true, color: "black" });
    const room = await started;
    expect(room).toMatchObject({ variant: "two", players: ["white", "black"] });

    // Fool's mate, played over the wire.
    const moves = [[white, "f2", "f3"], [black, "e7", "e5"], [white, "g2", "g4"], [black, "d8", "h4"]] as const;
    const over = nextUpdate(white, (r) => r.phase === "finished");
    for (const [socket, from, to] of moves) {
      expect(await socket.emitWithAck("game:move", { roomId: created.roomId, move: { from, to } })).toEqual({ ok: true });
    }
    expect((await over).state.winner).toBe("black");
  });

  it("starts a 2-player game against a bot straight away", async () => {
    const host = await client();
    const first = nextUpdate(host, (room) => room.phase === "playing");
    const created = await host.emitWithAck("room:create", { name: "Ada", variant: "two", seats: ["advanced"] });
    if (!created.ok) throw new Error(created.error);
    expect((await first).seats.black).toMatchObject({ bot: "advanced" });
    const replied = nextUpdate(host, (room) => room.state.ply === 2);
    await host.emitWithAck("game:move", { roomId: created.roomId, move: { from: "e2", to: "e4" } });
    expect((await replied).state.history[1]!.player).toBe("black");
  });

  it("fills a 3-player room with a friend and a bot, never putting the friend in the bot's seat", async () => {
    const [host, friend] = await Promise.all([client(), client()]);
    const created = await host.emitWithAck("room:create", { name: "Ada", variant: "three", seats: ["hard", "friend"] });
    if (!created.ok) throw new Error(created.error);
    const started = nextUpdate(host, (room) => room.phase === "playing");
    expect(await friend.emitWithAck("room:join", { roomId: created.roomId, name: "Bo" })).toMatchObject({ color: "black" });
    const room = await started;
    expect(room.players).toEqual(["white", "red", "black"]);
    expect(room.seats.red).toMatchObject({ bot: "hard" });
  });

  it("rejects unknown boards and bad seat plans", async () => {
    const host = await client();
    expect(await host.emitWithAck("room:create", { name: "Ada", variant: "five" as never })).toMatchObject({ ok: false });
    expect(await host.emitWithAck("room:create", { name: "Ada", variant: "two", seats: ["hard", "easy"] })).toMatchObject({ ok: false });
  });

  it("lets the host start early; empty seats sit out", async () => {
    const [host, friend] = await Promise.all([client(), client()]);
    const created = await host.emitWithAck("room:create", { name: "Ada" });
    if (!created.ok) throw new Error(created.error);
    await friend.emitWithAck("room:join", { roomId: created.roomId, name: "Bo" });
    expect(await friend.emitWithAck("game:start", { roomId: created.roomId })).toMatchObject({ ok: false });
    const started = nextUpdate(friend, (room) => room.phase === "playing");
    expect(await host.emitWithAck("game:start", { roomId: created.roomId })).toEqual({ ok: true });
    expect((await started).state.eliminations.map((e) => e.player)).toEqual(["yellow", "green"]);
  });
});
