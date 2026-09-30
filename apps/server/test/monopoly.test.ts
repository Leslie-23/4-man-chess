import type { AddressInfo } from "node:net";
import { currentActor } from "@fourman/monopoly-engine";
import { MONOPOLY_NAMESPACE, type MonopolyClientEvents, type MonopolyRoomView, type MonopolyServerEvents } from "@fourman/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

type Client = Socket<MonopolyServerEvents, MonopolyClientEvents>;
let server: ReturnType<typeof buildServer>;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = buildServer({ botDelayMs: 5, complete: null, voice: null });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}${MONOPOLY_NAMESPACE}`;
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
const nextUpdate = (socket: Client, predicate: (room: MonopolyRoomView) => boolean) =>
  new Promise<MonopolyRoomView>((resolve) => {
    const listener = (room: MonopolyRoomView) => {
      if (!predicate(room)) return;
      socket.off("room:update", listener);
      resolve(room);
    };
    socket.on("room:update", listener);
  });

describe("monopoly rooms", () => {
  it("seats bots, starts, and lets bots play their turns after ours", async () => {
    const host = await client();
    const started = nextUpdate(host, (r) => r.phase === "playing");
    const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["hard", "easy"], options: { turnLimit: 60 } });
    if (!created.ok) throw new Error(created.error);
    const room = await started;
    expect(room.seats.map((s) => s?.bot ?? "person")).toEqual(["person", "hard", "easy"]);
    expect(room.options.turnLimit).toBe(60);
    expect(currentActor(room.state!)).toBe("p0");

    // Play our turns by hand (roll, then decline or end) until the bots have had a go.
    const botsMoved = nextUpdate(host, (r) => (r.state?.turn ?? 0) >= 3);
    for (let i = 0; i < 40; i++) {
      const view = server.monopoly.view(server.monopoly.get(created.roomId));
      if ((view.state?.turn ?? 0) >= 3) break;
      if (currentActor(view.state!) !== "p0") {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      const phase = view.state!.phase;
      const action = phase === "roll" ? { type: "roll" as const } : phase === "buy" ? { type: "decline" as const } : phase === "auction" ? { type: "pass" as const } : phase === "debt" ? { type: "bankrupt" as const } : { type: "end-turn" as const };
      await host.emitWithAck("game:act", { roomId: created.roomId, action });
    }
    expect((await botsMoved).state!.turn).toBeGreaterThanOrEqual(3);
  });

  it("rejects moves out of turn, from spectators, and malformed ones", async () => {
    const [host, friend, watcher] = await Promise.all([client(), client(), client()]);
    const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["friend"] });
    if (!created.ok) throw new Error(created.error);
    const joined = await friend.emitWithAck("room:join", { roomId: created.roomId, name: "Bo" });
    expect(joined).toMatchObject({ ok: true, seat: 1 });
    await watcher.emitWithAck("room:join", { roomId: created.roomId, name: "Cy" });
    expect(await friend.emitWithAck("game:act", { roomId: created.roomId, action: { type: "roll" } })).toMatchObject({ ok: false, error: "It's not your move" });
    expect(await watcher.emitWithAck("game:act", { roomId: created.roomId, action: { type: "roll" } })).toMatchObject({ ok: false });
    expect(await host.emitWithAck("game:act", { roomId: created.roomId, action: null as never })).toMatchObject({ ok: false, error: "Malformed action" });
    expect(await host.emitWithAck("game:act", { roomId: created.roomId, action: { type: "roll" } })).toEqual({ ok: true });
    // Reclaiming a seat with its token after a reload.
    const back = await client();
    expect(await back.emitWithAck("room:join", { roomId: created.roomId, name: "Bo", token: joined.ok ? joined.token! : "" })).toMatchObject({ seat: 1 });
  });

  it("lets the host start early, dropping empty seats", async () => {
    const host = await client();
    const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["friend", "hard", "friend"] });
    if (!created.ok) throw new Error(created.error);
    const started = nextUpdate(host, (r) => r.phase === "playing");
    expect(await host.emitWithAck("game:start", { roomId: created.roomId })).toEqual({ ok: true });
    const room = await started;
    expect(room.seats).toHaveLength(2);
    expect(room.state!.players.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  it("coaches a player privately with the engine's suggestion, and hands out voice passes", async () => {
    const prompts: { role: string; content: string }[][] = [];
    const coached = buildServer({
      botDelayMs: 60_000,
      complete: async (m) => (prompts.push(m), "Roll the dice, then buy what you land on."),
      voice: { url: "wss://example.livekit.cloud", apiKey: "key", apiSecret: "a-secret-that-is-long-enough-for-hs256" },
    });
    await coached.app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const host: Client = connect(`http://127.0.0.1:${(coached.app.server.address() as AddressInfo).port}${MONOPOLY_NAMESPACE}`, { transports: ["websocket"], forceNew: true });
      clients.push(host);
      const first = nextUpdate(host, () => true);
      const created = await host.emitWithAck("room:create", { name: "Ada", seats: ["hard"] });
      if (!created.ok) throw new Error(created.error);
      expect(await first).toMatchObject({ coach: true, voice: true });
      const answer = await host.emitWithAck("coach:ask", { roomId: created.roomId, question: "What should I do?", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello!" }] });
      expect(answer).toEqual({ ok: true, answer: "Roll the dice, then buy what you land on." });
      expect(prompts[0]![0]!.content).toContain("Engine suggestion for this player: Roll the dice.");
      expect(prompts[0]!.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
      const pass = await host.emitWithAck("voice:token", { roomId: created.roomId });
      if (!pass.ok) throw new Error(pass.error);
      const claims = JSON.parse(Buffer.from(pass.token.split(".")[1]!, "base64url").toString());
      expect(claims).toMatchObject({ sub: "p0", video: { room: `tycoon-${created.roomId}`, canPublish: true } });
    } finally {
      await coached.app.close();
    }
  });
});
