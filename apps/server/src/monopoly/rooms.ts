import { randomInt, randomUUID } from "node:crypto";
import {
  DEFAULT_OPTIONS,
  IllegalActionError,
  applyAction,
  chooseBotAction,
  createGame,
  currentActor,
  type Action,
  type BotLevel,
  type GameOptions,
  type GameState,
} from "@fourman/monopoly-engine";
import {
  MAX_CHAT_LENGTH,
  MONOPOLY_MAX_PLAYERS,
  MONOPOLY_MIN_PLAYERS,
  type ChatMessage,
  type MonopolyRoomView,
  type MonopolySeatPlan,
} from "@fourman/shared";
import { RoomError } from "../rooms.js";

interface Seat {
  name: string;
  token: string;
  connections: number;
  bot: BotLevel | null;
}

export interface MonopolyRoom {
  id: string;
  phase: "lobby" | "playing" | "finished";
  host: number;
  seats: (Seat | null)[];
  plan: MonopolySeatPlan[];
  options: GameOptions;
  state: GameState | null;
  chat: ChatMessage[];
  lastActivity: number;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHAT_KEPT = 100;
const BOT_NAMES: Record<BotLevel, readonly string[]> = {
  easy: ["Penny", "Dot", "Rusty", "Bingo", "Pip"],
  hard: ["Baron", "Duchess", "Tycoon", "Magnate", "Mogul"],
};
const isPlan = (v: unknown): v is MonopolySeatPlan => v === "friend" || v === "easy" || v === "hard";
const cleanName = (name: unknown) => (typeof name === "string" ? name.trim().slice(0, 20) : "") || "Player";
/** The engine's id for seat `i`. Stable, so reconnecting and replays line up. */
export const seatId = (i: number) => `p${i}`;

/** Only these options can be picked when making a room; the rest keep their defaults. */
function cleanOptions(raw: unknown): Partial<GameOptions> {
  const o = (raw ?? {}) as Partial<GameOptions>;
  const out: Partial<GameOptions> = {};
  if ([1000, 1500, 2000].includes(o.startingCash as number)) out.startingCash = o.startingCash!;
  if (typeof o.parkingJackpot === "boolean") out.parkingJackpot = o.parkingJackpot;
  if (typeof o.auctions === "boolean") out.auctions = o.auctions;
  if (o.turnLimit === null || [60, 120, 200].includes(o.turnLimit as number)) out.turnLimit = o.turnLimit ?? null;
  return out;
}

/** In-memory Monopoly rooms, with the same seat and reconnect model as chess. */
export class MonopolyRooms {
  private rooms = new Map<string, MonopolyRoom>();

  constructor(private random: () => number = Math.random) {}

  create(name: unknown, plans: unknown, options: unknown) {
    if (!Array.isArray(plans) || plans.length + 1 < MONOPOLY_MIN_PLAYERS || plans.length + 1 > MONOPOLY_MAX_PLAYERS || !plans.every(isPlan)) {
      throw new RoomError(`Pick ${MONOPOLY_MIN_PLAYERS - 1} to ${MONOPOLY_MAX_PLAYERS - 1} other seats`);
    }
    let id: string;
    do id = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    while (this.rooms.has(id));
    const host = this.newSeat(name, null);
    const room: MonopolyRoom = {
      id,
      phase: "lobby",
      host: 0,
      seats: [host],
      plan: ["friend", ...(plans as MonopolySeatPlan[])],
      options: { ...DEFAULT_OPTIONS, ...cleanOptions(options) },
      state: null,
      chat: [],
      lastActivity: Date.now(),
    };
    const used = new Set<string>();
    (plans as MonopolySeatPlan[]).forEach((plan) => room.seats.push(plan === "friend" ? null : this.newSeat(this.botName(plan, used), plan)));
    this.rooms.set(id, room);
    this.startIfFull(room);
    return { room, seat: 0, token: host.token };
  }

  get(roomId: unknown): MonopolyRoom {
    const room = typeof roomId === "string" ? this.rooms.get(roomId.toUpperCase()) : undefined;
    if (!room) throw new RoomError("Room not found");
    return room;
  }

  join(roomId: unknown, name: unknown, token?: unknown) {
    const room = this.get(roomId);
    const back = room.seats.findIndex((s) => typeof token === "string" && s?.token === token);
    if (back >= 0) return { room, seat: back, token: token as string };
    const free = room.phase === "lobby" ? room.seats.findIndex((s, i) => !s && room.plan[i] === "friend") : -1;
    if (free < 0) return { room, seat: null, token: null };
    const seat = this.newSeat(name, null);
    room.seats[free] = seat;
    this.startIfFull(room);
    return { room, seat: free, token: seat.token };
  }

  start(roomId: unknown, seat: number | null): MonopolyRoom {
    const room = this.get(roomId);
    if (seat !== room.host) throw new RoomError("Only the host can do that");
    if (room.phase !== "lobby") throw new RoomError("The game has already started");
    if (room.seats.filter(Boolean).length < MONOPOLY_MIN_PLAYERS) throw new RoomError("Need at least 2 players to start");
    this.begin(room);
    return room;
  }

  /** Runs `action` for `seat` through the engine, which checks it's their move and legal. */
  act(roomId: unknown, seat: number | null, action: unknown): MonopolyRoom {
    const room = this.get(roomId);
    if (seat === null) throw new RoomError("Spectators can't play");
    if (room.phase !== "playing" || !room.state) throw new RoomError(room.phase === "lobby" ? "The game hasn't started" : "The game is over");
    if (!action || typeof action !== "object" || typeof (action as Action).type !== "string") throw new RoomError("Malformed action");
    this.apply(room, seatId(seat), action as Action);
    return room;
  }

  /** The bot level of whoever must act now, if that's a bot. */
  botToAct(room: MonopolyRoom): BotLevel | null {
    if (room.phase !== "playing" || !room.state) return null;
    const actor = currentActor(room.state);
    return actor ? (room.seats[Number(actor.slice(1))]?.bot ?? null) : null;
  }

  /** Lets the bot whose move it is take one action. */
  botMove(room: MonopolyRoom): void {
    const level = this.botToAct(room);
    if (!level || !room.state) return;
    const actor = currentActor(room.state)!;
    const action = chooseBotAction(room.state, actor, this.random, level);
    if (action) this.apply(room, actor, action);
  }

  say(roomId: unknown, seat: number | null, name: unknown, text: unknown): MonopolyRoom {
    const room = this.get(roomId);
    const clean = typeof text === "string" ? text.trim().slice(0, MAX_CHAT_LENGTH) : "";
    if (!clean) throw new RoomError("Say something first");
    const s = seat === null ? null : room.seats[seat];
    room.chat.push({ id: (room.chat.at(-1)?.id ?? 0) + 1, name: s ? s.name : cleanName(name), color: null, bot: false, text: clean, at: Date.now() });
    if (room.chat.length > CHAT_KEPT) room.chat.splice(0, room.chat.length - CHAT_KEPT);
    this.touch(room);
    return room;
  }

  connect(room: MonopolyRoom, seat: number | null, delta: 1 | -1) {
    const s = seat === null ? null : room.seats[seat];
    if (s) s.connections = Math.max(0, s.connections + delta);
    this.touch(room);
  }

  sweep(maxIdleMs: number, now = Date.now()) {
    for (const [id, room] of this.rooms) {
      const anyone = room.seats.some((s) => (s?.connections ?? 0) > 0);
      if (!anyone && now - room.lastActivity > maxIdleMs) this.rooms.delete(id);
    }
  }

  view(room: MonopolyRoom): MonopolyRoomView {
    return {
      id: room.id,
      phase: room.phase,
      host: room.host,
      seats: room.seats.map((s, i) => (s ? { id: seatId(i), name: s.name, connected: s.bot !== null || s.connections > 0, bot: s.bot } : null)),
      plan: [...room.plan],
      options: room.options,
      state: room.state,
      chat: room.chat,
    };
  }

  private apply(room: MonopolyRoom, player: string, action: Action) {
    try {
      room.state = applyAction(room.state!, player, action, this.random);
    } catch (error) {
      if (error instanceof IllegalActionError) throw new RoomError(error.message);
      throw error;
    }
    if (room.state.phase === "finished") room.phase = "finished";
    this.touch(room);
  }

  private begin(room: MonopolyRoom) {
    // Empty friend seats are dropped, so the turn order is just the people and bots who are here.
    const seated = room.seats.flatMap((s, i) => (s ? [{ s, i }] : []));
    room.seats = seated.map(({ s }) => s);
    room.plan = seated.map(({ i }) => room.plan[i]!);
    room.state = createGame(room.seats.map((s, i) => ({ id: seatId(i), name: s!.name })), this.random, room.options);
    room.phase = "playing";
    this.touch(room);
  }

  private startIfFull(room: MonopolyRoom) {
    if (room.seats.length === room.plan.length && room.seats.every(Boolean)) this.begin(room);
    else this.touch(room);
  }

  private newSeat(name: unknown, bot: BotLevel | null): Seat {
    return { name: cleanName(name), token: randomUUID(), connections: 0, bot };
  }

  private botName(level: BotLevel, used: Set<string>): string {
    const pool = BOT_NAMES[level].filter((n) => !used.has(n));
    const name = pool[Math.floor(this.random() * pool.length)] ?? `${level} bot`;
    used.add(name);
    return `${name} (bot)`;
  }

  private touch(room: MonopolyRoom) {
    room.lastActivity = Date.now();
  }
}
