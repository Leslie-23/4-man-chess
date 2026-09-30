import { IllegalMoveError, chooseBotMove, getLegalMoves, type MoveInput, type PlayerColor } from "@fourman/game-engine";
import { LEADERBOARD_PERIODS, type AckResult, type ClientToServerEvents, type LeaderboardPeriod, type ServerToClientEvents } from "@fourman/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Server, Socket } from "socket.io";
import type { Leaderboard } from "./leaderboard.js";
import { chooseResponder, cleanReply, coachPrompt, replyPrompt, type Complete } from "./replies.js";
import { RoomError, type Room, type RoomManager } from "./rooms.js";

interface SocketData {
  roomId?: string;
  color?: PlayerColor | null;
  /** The name given on join, used when a spectator chats. */
  name?: string;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

/** A socket may post at most this often. */
const CHAT_GAP_MS = 500;

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
  leaderboard: Leaderboard;
  /** Writes bots' answers to people's chat. Without it, bots only have their canned lines. */
  complete?: Complete;
}

/** A room's bots answer at most this often, whatever the chat does. */
const REPLY_GAP_MS = 3000;
/** A socket may ask the coach at most this often. */
const COACH_GAP_MS = 8000;
const COACH_MAX_LENGTH = 500;

/** Wires up the socket events. Returns a function that gets a restored room moving again. */
export function attachSockets(io: GameServer, rooms: RoomManager, log: FastifyBaseLogger, options: SocketOptions): (room: Room) => void {
  const botTimers = new Map<string, NodeJS.Timeout>();
  const replying = new Set<string>();
  const lastReply = new Map<string, number>();

  /** Lets one of the room's bots answer the latest chat line, when a model is set up and it isn't too soon. */
  const replyTo = (room: Room) => {
    const message = room.chat.at(-1);
    if (!options.complete || !message || replying.has(room.id)) return;
    if (Date.now() - (lastReply.get(room.id) ?? 0) < REPLY_GAP_MS) return;
    const color = chooseResponder(room, message, Math.random);
    if (!color) return;
    replying.add(room.id);
    void options.complete(replyPrompt(room, color)).then((text) => {
      replying.delete(room.id);
      const seat = room.seats[color];
      const line = text && seat ? cleanReply(text, seat.name) : "";
      if (!line) return;
      lastReply.set(room.id, Date.now());
      rooms.botSay(room, color, line);
      io.to(room.id).emit("room:update", rooms.view(room));
    });
  };

  /** Sends the room to everyone in it, then lets a bot move if it's a bot's turn, and keeps the clocks running. */
  const broadcast = (room: Room) => {
    io.to(room.id).emit("room:update", rooms.view(room));
    scheduleBot(room);
    scheduleClock(room);
    schedulePoll(room);
  };

  // One pending timer per room for the move clock, and one for an open poll. Each is keyed by what
  // it was set for, so a new turn or a new limit replaces it rather than stacking another.
  const clocks = new Map<string, { key: string; timer: NodeJS.Timeout }>();
  const pollTimers = new Map<string, { key: string; timer: NodeJS.Timeout }>();
  const keep = (timers: typeof clocks, room: Room, key: string | null, fire: () => void, at: number) => {
    const current = timers.get(room.id);
    if (current?.key === key) return;
    if (current) clearTimeout(current.timer);
    timers.delete(room.id);
    if (key === null) return;
    const timer = setTimeout(() => {
      timers.delete(room.id);
      fire();
    }, Math.max(0, at - Date.now()) + 25);
    timer.unref();
    timers.set(room.id, { key, timer });
  };
  const scheduleClock = (room: Room) => {
    const { turnDeadline: deadline } = room;
    const ply = room.state.ply;
    keep(clocks, room, deadline === null ? null : `${ply}:${deadline}`, () => {
      try {
        if (rooms.timeOut(room, ply)) broadcast(room);
      } catch (error) {
        log.error({ err: error, room: room.id }, "timeout move failed");
      }
    }, deadline ?? 0);
  };
  const schedulePoll = (room: Room) => {
    const poll = room.poll;
    keep(pollTimers, room, poll ? String(poll.id) : null, () => {
      if (poll && rooms.closePollIfDue(room, poll.id)) broadcast(room);
    }, poll?.closesAt ?? 0);
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
    let lastChat = 0;
    let lastCoach = 0;

    /**
     * Runs a client request: replies through `ack`, then pushes the new room
     * state to every socket in the room, so all devices redraw together.
     */
    const handle = <T extends object>(ack: unknown, action: () => { room: Room; reply?: T }): Room | undefined => {
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
        return undefined;
      }
      broadcast(room);
      return room;
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

    const enter = (room: Room, color: PlayerColor | null, name: unknown) => {
      leaveCurrentRoom();
      socket.data = { roomId: room.id, color, ...(typeof name === "string" && { name }) };
      void socket.join(room.id);
      rooms.connect(room, color, 1);
    };

    socket.on("room:create", (payload, ack) =>
      handle(ack, () => {
        const { room, color, token } = rooms.create(payload?.name, payload?.variant, payload?.seats);
        enter(room, color, payload?.name);
        return { room, reply: { roomId: room.id, color, token } };
      }),
    );

    socket.on("room:join", (payload, ack) =>
      handle(ack, () => {
        const { room, color, token } = rooms.join(payload?.roomId, payload?.name, payload?.token);
        enter(room, color, payload?.name);
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

    socket.on("chat:send", (payload, ack) => {
      const room = handle(ack, () => {
        const color = seatIn(payload?.roomId);
        const now = Date.now();
        if (now - lastChat < CHAT_GAP_MS) throw new RoomError("Slow down a little");
        lastChat = now;
        return { room: rooms.say(payload?.roomId, color, socket.data.name, payload?.text) };
      });
      if (room) replyTo(room);
    });

    socket.on("poll:start", (payload, ack) =>
      handle(ack, () => ({ room: rooms.startPoll(payload?.roomId, seatIn(payload?.roomId)) })),
    );

    socket.on("poll:vote", (payload, ack) =>
      handle(ack, () => ({ room: rooms.vote(payload?.roomId, seatIn(payload?.roomId), payload?.seconds) })),
    );

    // The answer goes only to whoever asked; the rest of the table doesn't see it.
    socket.on("coach:ask", async (payload, ack) => {
      if (typeof ack !== "function") return;
      try {
        const color = seatIn(payload?.roomId);
        const room = rooms.get(payload?.roomId);
        if (!options.complete) throw new RoomError("The coach isn't set up on this server");
        if (!color || room.phase !== "playing") throw new RoomError("The coach helps players during a game");
        if (Date.now() - lastCoach < COACH_GAP_MS) throw new RoomError("The coach needs a moment. Try again shortly");
        lastCoach = Date.now();
        const pick = room.state.currentPlayer === color ? chooseBotMove(room.state, Math.random, "advanced") : null;
        const suggestion = pick ? (getLegalMoves(room.state, pick.from).find((m) => m.to === pick.to) ?? null) : null;
        const advice = await options.complete(coachPrompt(room, color, suggestion));
        if (!advice?.trim()) throw new RoomError("The coach is lost for words. Try again");
        ack({ ok: true, advice: advice.replace(/\*+/g, "").trim().slice(0, COACH_MAX_LENGTH) });
      } catch (error) {
        ack({ ok: false, error: error instanceof RoomError ? error.message : "Something went wrong" });
        if (!(error instanceof RoomError)) log.error(error);
      }
    });

    // Read-only and not tied to a room, so it skips `handle` and its broadcast.
    socket.on("leaderboard:get", (payload, ack) => {
      if (typeof ack !== "function") return;
      const period = payload?.period;
      if (!LEADERBOARD_PERIODS.includes(period as LeaderboardPeriod)) return ack({ ok: false, error: "Unknown period" });
      ack({ ok: true, board: options.leaderboard.view(period) });
    });

    socket.on("disconnect", leaveCurrentRoom);

    function seatIn(roomId: unknown): PlayerColor | null {
      if (typeof roomId !== "string" || roomId.toUpperCase() !== socket.data.roomId) {
        throw new RoomError("Join the room first");
      }
      return socket.data.color ?? null;
    }
  });

  // After a restart: a bot whose turn it is carries on, and a timed player's clock starts again.
  return (room: Room) => {
    scheduleBot(room);
    scheduleClock(room);
  };
}
