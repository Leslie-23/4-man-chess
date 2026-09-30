import type { AddressInfo } from "node:net";
import type { ClientToServerEvents, RoomView, SeatGrant, ServerToClientEvents } from "@fourman/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import type { PromptMessage } from "../src/replies.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof buildServer>;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = buildServer({ botDelayMs: 5, complete: null, voice: null });
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

  it("shares chat with everyone in the room, spectators included", async () => {
    const { roomId, sockets } = await fullRoom();
    const watcher = await client();
    await watcher.emitWithAck("room:join", { roomId, name: "Cy" });
    const heard = nextUpdate(sockets[3]!, (room) => room.chat.length === 2);
    expect(await sockets[0]!.emitWithAck("chat:send", { roomId, text: "  hello  " })).toEqual({ ok: true });
    expect(await watcher.emitWithAck("chat:send", { roomId, text: "hi from the stands" })).toEqual({ ok: true });
    expect((await heard).chat).toMatchObject([
      { name: "Ada", color: "red", bot: false, text: "hello" },
      { name: "Cy", color: null, bot: false, text: "hi from the stands" },
    ]);
  });

  it("rejects empty chat, flooding and chat from outside the room", async () => {
    const { roomId, sockets } = await fullRoom();
    const outsider = await client();
    expect(await sockets[0]!.emitWithAck("chat:send", { roomId, text: "   " })).toMatchObject({ ok: false });
    expect(await outsider.emitWithAck("chat:send", { roomId, text: "hi" })).toMatchObject({ ok: false });
    expect(await sockets[1]!.emitWithAck("chat:send", { roomId, text: "one" })).toEqual({ ok: true });
    expect(await sockets[1]!.emitWithAck("chat:send", { roomId, text: "two" })).toMatchObject({ ok: false });
  });

  it("has server bots greet the table and sign off when they're out", async () => {
    const host = await client();
    const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["easy", "hard", "advanced"] });
    if (!created.ok) throw new Error(created.error);
    const done = nextUpdate(host, (room) => room.phase === "finished");
    expect(await host.emitWithAck("game:resign", { roomId: created.roomId })).toEqual({ ok: true });
    const room = await done;
    expect(room.chat[0]).toMatchObject({ bot: true, color: "blue" });
    expect(room.chat.every((m) => m.bot)).toBe(true);
    // Bot games can end in a draw; when someone wins, they say so.
    const winner = room.state.winner;
    if (winner) expect(room.chat.some((m) => m.color === winner)).toBe(true);
  }, 30_000);

  it("ranks finished games on the leaderboard, one row per bot level", async () => {
    const [host, other, reader] = await Promise.all([client(), client(), client()]);
    const play = async (socket: Client, name: string, seats: ("hard" | "easy")[]) => {
      const created = await socket.emitWithAck("room:create", { name, variant: "two", seats });
      if (!created.ok) throw new Error(created.error);
      const done = nextUpdate(socket, (room) => room.phase === "finished");
      await socket.emitWithAck("game:resign", { roomId: created.roomId });
      await done;
    };
    await play(host, "Ada", ["hard"]);
    await play(other, "ada ", ["hard"]);
    await play(other, "Bo", ["easy"]);

    const reply = await reader.emitWithAck("leaderboard:get", { period: "day" });
    if (!reply.ok) throw new Error(reply.error);
    expect(reply.board.rows.map((r) => [r.name, r.wins, r.games])).toEqual([
      ["Hard Bot", 2, 2],
      ["Easy Bot", 1, 1],
      ["ada", 0, 2], // same person, shown with the latest spelling
      ["Bo", 0, 1],
    ]);
    expect(reply.board.recent).toHaveLength(3);
    expect(reply.board.recent[0]).toMatchObject({ winner: "bot:easy", variant: "two" });
    expect(await reader.emitWithAck("leaderboard:get", { period: "year" as never })).toMatchObject({ ok: false });
  });

  it("lets the bot a message names answer it through the language model", async () => {
    const prompts: PromptMessage[][] = [];
    const replying = buildServer({ botDelayMs: 60_000, complete: async (messages) => (prompts.push(messages), '"Yellow Bot: Bold words, Ada."') });
    await replying.app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const host: Client = connect(`http://127.0.0.1:${(replying.app.server.address() as AddressInfo).port}`, { transports: ["websocket"], forceNew: true });
      clients.push(host);
      const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["easy", "hard", "advanced"] });
      if (!created.ok) throw new Error(created.error);
      const answered = nextUpdate(host, (room) => room.chat.some((m) => m.bot && m.text === "Bold words, Ada."));
      await host.emitWithAck("chat:send", { roomId: created.roomId, text: "yellow, you're going down" });
      const room = await answered;
      expect(room.chat.at(-1)).toMatchObject({ color: "yellow", bot: true, name: "Yellow Bot" });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]![0]).toMatchObject({ role: "system" });
      expect(prompts[0]![0]!.content).toContain("Yellow Bot");
      expect(prompts[0]!.at(-1)).toEqual({ role: "user", content: "Ada: yellow, you're going down" });
    } finally {
      await replying.app.close();
    }
  });

  it("sets the time per move by a poll of the people at the table; a tie goes to the longer time", async () => {
    const { roomId, sockets } = await fullRoom();
    const outsider = await client();
    expect(await sockets[1]!.emitWithAck("poll:start", { roomId })).toEqual({ ok: true });
    expect(await sockets[2]!.emitWithAck("poll:start", { roomId })).toMatchObject({ ok: false });
    expect(await outsider.emitWithAck("poll:vote", { roomId, seconds: 15 })).toMatchObject({ ok: false });
    expect(await sockets[0]!.emitWithAck("poll:vote", { roomId, seconds: 42 })).toMatchObject({ ok: false });

    const closed = nextUpdate(sockets[0]!, (room) => room.poll === null && room.moveSeconds !== null);
    for (const [i, seconds] of [15, 15, 60, 60].entries()) {
      expect(await sockets[i]!.emitWithAck("poll:vote", { roomId, seconds })).toEqual({ ok: true });
    }
    const room = await closed;
    expect(room.moveSeconds).toBe(60);
    expect(room.turnEndsInMs).toBeGreaterThan(55_000);
    expect(room.chat.filter((m) => m.system).map((m) => m.text)).toEqual([
      "Friend 0 started a poll: how long should each move take? Now: no time limit.",
      "The table voted for 60 seconds per move.",
    ]);
  });

  it("only offers the coach when a model is set up", async () => {
    const host = await client();
    const first = nextUpdate(host, () => true);
    const created = await host.emitWithAck("room:create", { name: "Ada", variant: "two", seats: ["hard"] });
    if (!created.ok) throw new Error(created.error);
    expect((await first).coach).toBe(false);
    expect(await host.emitWithAck("coach:ask", { roomId: created.roomId })).toMatchObject({ ok: false });
  });

  it("has the coach explain the engine's move, privately to the player who asked", async () => {
    const prompts: PromptMessage[][] = [];
    const coached = buildServer({ botDelayMs: 60_000, complete: async (messages) => (prompts.push(messages), "**Develop** your knight toward the centre.") });
    await coached.app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const host: Client = connect(`http://127.0.0.1:${(coached.app.server.address() as AddressInfo).port}`, { transports: ["websocket"], forceNew: true });
      clients.push(host);
      const first = nextUpdate(host, () => true);
      const created = await host.emitWithAck("room:create", { name: "Ada", variant: "two", seats: ["hard"] });
      if (!created.ok) throw new Error(created.error);
      expect((await first).coach).toBe(true);
      expect(await host.emitWithAck("coach:ask", { roomId: created.roomId })).toEqual({ ok: true, advice: "Develop your knight toward the centre." });
      expect(prompts[0]![1]!.content).toContain("The engine's recommended move for white:");
      expect(prompts[0]![1]!.content).toContain("white (Ada): K e1, Q d1");
      expect(await host.emitWithAck("coach:ask", { roomId: created.roomId })).toMatchObject({ ok: false, error: expect.stringContaining("moment") });
    } finally {
      await coached.app.close();
    }
  });
});
