import { IllegalMoveError, chooseBotMove, type MoveInput, type PlayerColor } from "@fourman/game-engine";
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from "@fourman/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Server, Socket } from "socket.io";
import { RoomError, type Room, type RoomManager } from "./rooms.js";

interface SocketData {
  roomId?: string;
  color?: PlayerColor | null;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

const PROMOTIONS = new Set(["queen", "rook", "bishop", "knight"]);

function parseMove(value: unknown): MoveInput {
  const move = value as Partial<MoveInput> | null;
  if (typeof move?.from !== "string" || typeof move.to !== "string") throw new RoomError("Malformed move");
  if (move.promotion !== undefined && !PROMOTIONS.has(move.promotion)) throw new RoomError("Malformed promotion");
  return { from: move.from, to: move.to, ...(move.promotion && { promotion: move.promotion }) };
}

export interface SocketOptions {
  /** Pause before a bot moves, so humans can follow along. */
  botDelayMs: number;
}

/** Wires up the socket events. Returns a function that lets a bot move in `room` if it's a bot's turn. */
export function attachSockets(io: GameServer, rooms: RoomManager, log: FastifyBaseLogger, options: SocketOptions): (room: Room) => void {
  const botTimers = new Map<string, NodeJS.Timeout>();

  /** Sends the room to everyone in it, then lets a bot move if it's a bot's turn. */
  const broadcast = (room: Room) => {
    io.to(room.id).emit("room:update", rooms.view(room));
    scheduleBot(room);
  };

  const scheduleBot = (room: Room) => {
    const level = rooms.botToMove(room);
    if (!level || botTimers.has(room.id)) return;
    const ply = room.state.ply;
    const timer = setTimeout(() => {
      botTimers.delete(room.id);
      if (room.state.ply !== ply || rooms.botToMove(room) !== level) return scheduleBot(room);
      const color = room.state.currentPlayer;
      const move = chooseBotMove(room.state, Math.random, level);
      if (!move) return;
      try {
        rooms.move(room.id, color, move);
      } catch (error) {
        log.error({ err: error, room: room.id, color }, "bot move failed");
        return;
      }
      broadcast(room);
    }, options.botDelayMs);
    botTimers.set(room.id, timer);
  };

  io.on("connection", (socket: GameSocket) => {
    /**
     * Runs a client request: replies through `ack`, then pushes the new room
     * state to every socket in the room, so all devices redraw together.
     */
    const handle = <T extends object>(ack: unknown, action: () => { room: Room; reply?: T }) => {
      const reply = typeof ack === "function" ? (ack as (r: AckResult<T>) => void) : () => {};
      let room: Room;
      try {
        const result = action();
        room = result.room;
        reply({ ok: true, ...(result.reply as T) });
      } catch (error) {
        if (error instanceof RoomError || error instanceof IllegalMoveError || error instanceof RangeError) {
          reply({ ok: false, error: error.message });
        } else {
          log.error(error);
          reply({ ok: false, error: "Something went wrong" });
        }
        return;
      }
      broadcast(room);
    };

    const leaveCurrentRoom = () => {
      const { roomId, color } = socket.data;
      if (!roomId) return;
      socket.data = {};
      void socket.leave(roomId);
      try {
        const room = rooms.get(roomId);
        rooms.connect(room, color ?? null, -1);
        broadcast(room);
      } catch {
        // Room was already cleaned up.
      }
    };

    const enter = (room: Room, color: PlayerColor | null) => {
      leaveCurrentRoom();
      socket.data = { roomId: room.id, color };
      void socket.join(room.id);
      rooms.connect(room, color, 1);
    };

    socket.on("room:create", (payload, ack) =>
      handle(ack, () => {
        const { room, color, token } = rooms.create(payload?.name, payload?.variant, payload?.seats);
        enter(room, color);
        return { room, reply: { roomId: room.id, color, token } };
      }),
    );

    socket.on("room:join", (payload, ack) =>
      handle(ack, () => {
        const { room, color, token } = rooms.join(payload?.roomId, payload?.name, payload?.token);
        enter(room, color);
        return { room, reply: { roomId: room.id, color, token } };
      }),
    );

    // Game actions use the seat bound to this socket, never a colour sent by the client.
    socket.on("room:set-seat", (payload, ack) =>
      handle(ack, () => ({ room: rooms.setSeat(payload?.roomId, seatIn(payload?.roomId), payload?.color, payload?.plan) })),
    );

    socket.on("game:start", (payload, ack) =>
      handle(ack, () => ({ room: rooms.start(payload?.roomId, seatIn(payload?.roomId)) })),
    );

    socket.on("game:move", (payload, ack) =>
      handle(ack, () => ({ room: rooms.move(payload?.roomId, seatIn(payload?.roomId), parseMove(payload?.move)) })),
    );

    socket.on("game:resign", (payload, ack) =>
      handle(ack, () => ({ room: rooms.resign(payload?.roomId, seatIn(payload?.roomId)) })),
    );

    socket.on("disconnect", leaveCurrentRoom);

    function seatIn(roomId: unknown): PlayerColor | null {
      if (typeof roomId !== "string" || roomId.toUpperCase() !== socket.data.roomId) {
        throw new RoomError("Join the room first");
      }
      return socket.data.color ?? null;
    }
  });

  return scheduleBot;
}
