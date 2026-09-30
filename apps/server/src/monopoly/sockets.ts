import type { AckResult, MonopolyClientEvents, MonopolyServerEvents } from "@fourman/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Namespace, Socket } from "socket.io";
import { RoomError } from "../rooms.js";
import type { MonopolyRoom, MonopolyRooms } from "./rooms.js";

interface SocketData {
  roomId?: string;
  seat?: number | null;
  name?: string;
}

export type MonopolyNamespace = Namespace<MonopolyClientEvents, MonopolyServerEvents, {}, SocketData>;
type MonopolySocket = Socket<MonopolyClientEvents, MonopolyServerEvents, {}, SocketData>;

const CHAT_GAP_MS = 500;

/** Monopoly's socket events: the same request → reply → broadcast loop as chess, on its own namespace. */
export function attachMonopoly(nsp: MonopolyNamespace, rooms: MonopolyRooms, log: FastifyBaseLogger, { botDelayMs }: { botDelayMs: number }) {
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
        const { room, seat, token } = rooms.create(payload?.name, payload?.seats, payload?.options);
        enter(room, seat, payload?.name);
        return { room, reply: { roomId: room.id, seat, token } };
      }),
    );

    socket.on("room:join", (payload, ack) =>
      handle(ack, () => {
        const { room, seat, token } = rooms.join(payload?.roomId, payload?.name, payload?.token);
        enter(room, seat, payload?.name);
        return { room, reply: { roomId: room.id, seat, token } };
      }),
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

    socket.on("disconnect", leave);
  });
}
