import type { AckResult, MonopolyClientEvents, MonopolyServerEvents } from "@fourman/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Namespace, Socket } from "socket.io";
import type { Complete } from "../replies.js";
import { RoomError } from "../rooms.js";
import { voicePass, type VoiceConfig } from "../voice.js";
import { coachPrompt } from "./coach.js";
import { seatId, type MonopolyRoom, type MonopolyRooms } from "./rooms.js";

interface SocketData {
  roomId?: string;
  seat?: number | null;
  name?: string;
}

export type MonopolyNamespace = Namespace<MonopolyClientEvents, MonopolyServerEvents, {}, SocketData>;
type MonopolySocket = Socket<MonopolyClientEvents, MonopolyServerEvents, {}, SocketData>;

const CHAT_GAP_MS = 500;
const COACH_GAP_MS = 5000;
const COACH_MAX_LENGTH = 600;

interface Options {
  botDelayMs: number;
  /** Groq, for the coach; without it the coach is off. */
  complete?: Complete;
  voice?: VoiceConfig | null;
}

/**
 * Monopoly's socket events: the same request → reply → broadcast loop as
 * chess, on its own namespace. Returns a function that gets a restored room's
 * bots moving again.
 */
export function attachMonopoly(nsp: MonopolyNamespace, rooms: MonopolyRooms, log: FastifyBaseLogger, { botDelayMs, complete, voice }: Options) {
  const botTimers = new Map<string, NodeJS.Timeout>();

  const broadcast = (room: MonopolyRoom) => {
    nsp.to(room.id).emit("room:update", rooms.view(room));
    scheduleBot(room);
  };

  // Bots take one action per tick, so people can follow a bot's roll, buy and build.
  const scheduleBot = (room: MonopolyRoom) => {
    if (!rooms.botToAct(room) || botTimers.has(room.id)) return;
    const timer = setTimeout(() => {
      botTimers.delete(room.id);
      try {
        rooms.botMove(room);
      } catch (error) {
        log.error({ err: error, room: room.id }, "monopoly bot move failed");
        return;
      }
      broadcast(room);
    }, botDelayMs);
    botTimers.set(room.id, timer);
  };

  nsp.on("connection", (socket: MonopolySocket) => {
    let lastChat = 0;
    let lastCoach = 0;

    const handle = <T extends object>(ack: unknown, action: () => { room: MonopolyRoom; reply?: T }) => {
      const reply = typeof ack === "function" ? (ack as (r: AckResult<T>) => void) : () => {};
      let room: MonopolyRoom;
      try {
        const result = action();
        room = result.room;
        reply({ ok: true, ...(result.reply as T) });
      } catch (error) {
        if (error instanceof RoomError) reply({ ok: false, error: error.message });
        else {
          log.error(error);
          reply({ ok: false, error: "Something went wrong" });
        }
        return;
      }
      broadcast(room);
    };

    const leave = () => {
      const { roomId, seat } = socket.data;
      if (!roomId) return;
      socket.data = {};
      void socket.leave(roomId);
      try {
        const room = rooms.get(roomId);
        rooms.connect(room, seat ?? null, -1);
        broadcast(room);
      } catch {
        // Already swept.
      }
    };

    const enter = (room: MonopolyRoom, seat: number | null, name: unknown) => {
      leave();
      socket.data = { roomId: room.id, seat, ...(typeof name === "string" && { name }) };
      void socket.join(room.id);
      rooms.connect(room, seat, 1);
    };

    const seatIn = (roomId: unknown): number | null => {
      if (typeof roomId !== "string" || roomId.toUpperCase() !== socket.data.roomId) throw new RoomError("Join the room first");
      return socket.data.seat ?? null;
    };

    socket.on("room:create", (payload, ack) =>
      handle(ack, () => {
        const { room, seat, token } = rooms.create(payload?.name, payload?.seats, payload?.options, payload?.animal);
        enter(room, seat, payload?.name);
        return { room, reply: { roomId: room.id, seat, token } };
      }),
    );

    socket.on("room:join", (payload, ack) =>
      handle(ack, () => {
        const { room, seat, token } = rooms.join(payload?.roomId, payload?.name, payload?.token, payload?.animal);
        enter(room, seat, payload?.name);
        return { room, reply: { roomId: room.id, seat, token } };
      }),
    );

    socket.on("seat:animal", (payload, ack) =>
      handle(ack, () => ({ room: rooms.setAnimal(payload?.roomId, seatIn(payload?.roomId), payload?.animal) })),
    );

    socket.on("game:start", (payload, ack) => handle(ack, () => ({ room: rooms.start(payload?.roomId, seatIn(payload?.roomId)) })));

    socket.on("game:act", (payload, ack) =>
      handle(ack, () => ({ room: rooms.act(payload?.roomId, seatIn(payload?.roomId), payload?.action) })),
    );

    socket.on("chat:send", (payload, ack) =>
      handle(ack, () => {
        const seat = seatIn(payload?.roomId);
        if (Date.now() - lastChat < CHAT_GAP_MS) throw new RoomError("Slow down a little");
        lastChat = Date.now();
        return { room: rooms.say(payload?.roomId, seat, socket.data.name, payload?.text) };
      }),
    );

    // Private to whoever asked: the rest of the table doesn't see the coach's advice.
    socket.on("coach:ask", async (payload, ack) => {
      if (typeof ack !== "function") return;
      try {
        const seat = seatIn(payload?.roomId);
        const room = rooms.get(payload?.roomId);
        if (!complete) throw new RoomError("The coach isn't set up on this server");
        if (seat === null || !room.state) throw new RoomError("The coach helps players during a game");
        const question = typeof payload?.question === "string" ? payload.question.trim() : "";
        if (!question) throw new RoomError("Ask the coach something");
        if (Date.now() - lastCoach < COACH_GAP_MS) throw new RoomError("The coach needs a moment. Try again shortly");
        lastCoach = Date.now();
        const answer = await complete(coachPrompt(room.state, seatId(seat), question, Array.isArray(payload?.history) ? payload.history : []));
        if (!answer?.trim()) throw new RoomError("The coach is lost for words. Try again");
        ack({ ok: true, answer: answer.replace(/\*+/g, "").trim().slice(0, COACH_MAX_LENGTH) });
      } catch (error) {
        ack({ ok: false, error: error instanceof RoomError ? error.message : "Something went wrong" });
        if (!(error instanceof RoomError)) log.error(error);
      }
    });

    socket.on("voice:token", async (payload, ack) => {
      if (typeof ack !== "function") return;
      try {
        const seat = seatIn(payload?.roomId);
        const room = rooms.get(payload?.roomId);
        if (!voice) throw new RoomError("Voice chat isn't set up on this server");
        const person = seat === null ? null : room.seats[seat];
        const canTalk = Boolean(person && !person.bot);
        const token = await voicePass(voice, `tycoon-${room.id}`, {
          identity: canTalk ? seatId(seat!) : `watcher-${socket.id}`,
          name: person?.name ?? socket.data.name ?? "Watcher",
          canTalk,
        });
        ack({ ok: true, url: voice.url, token, canTalk });
      } catch (error) {
        ack({ ok: false, error: error instanceof RoomError ? error.message : "Something went wrong" });
        if (!(error instanceof RoomError)) log.error(error);
      }
    });

    socket.on("disconnect", leave);
  });

  return scheduleBot;
}
