import { randomInt, randomUUID } from "node:crypto";
import {
  BOT_LEVELS,
  VARIANT_IDS,
  applyMove,
  createGame,
  getVariant,
  resign,
  type BotLevel,
  type GameState,
  type MoveInput,
  type PlayerColor,
  type VariantId,
} from "@fourman/game-engine";
import { MAX_CHAT_LENGTH, type ChatMessage, type RoomPhase, type RoomView, type SeatPlan } from "@fourman/shared";
import { GREETINGS, banter } from "./banter.js";

/** An error whose message is safe to send back to the client. */
export class RoomError extends Error {}

interface Seat {
  name: string;
  /** Secret that lets a player reclaim their seat after a reload. Never broadcast. */
  token: string;
  /** Open sockets for this seat; a player may have several tabs. */
  connections: number;
  bot: BotLevel | null;
}

export interface Room {
  id: string;
  variant: VariantId;
  players: readonly PlayerColor[];
  host: PlayerColor;
  phase: RoomPhase;
  seats: Partial<Record<PlayerColor, Seat | null>>;
  plan: Partial<Record<PlayerColor, SeatPlan>>;
  state: GameState;
  chat: ChatMessage[];
  lastActivity: number;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_NAME_LENGTH = 20;
/** Older messages drop off the board. */
const CHAT_KEPT = 100;

function cleanName(name: unknown): string {
  return (typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "") || "Player";
}

function newSeat(name: unknown, bot: BotLevel | null = null): Seat {
  return { name: cleanName(name), token: randomUUID(), connections: 0, bot };
}

const isPlan = (value: unknown): value is SeatPlan => value === "friend" || BOT_LEVELS.includes(value as BotLevel);

// Named by seat so several bots in one room are easy to tell apart; the plate shows the level.
const botSeat = (color: PlayerColor, level: BotLevel) => newSeat(`${color[0]!.toUpperCase()}${color.slice(1)} Bot`, level);

/** In-memory rooms; the server's single source of truth for every live game. */
export class RoomManager {
  private rooms = new Map<string, Room>();

  /** `onChange` hears about every change to a room, e.g. to persist it. */
  constructor(
    private onChange: (room: Room) => void = () => {},
    /** Decides when bots speak up and what they say. */
    private random: () => number = Math.random,
  ) {}

  /** Puts rooms loaded from storage back into play. */
  restore(rooms: Room[]): void {
    // Rooms saved before the message board existed have no chat yet.
    for (const room of rooms) this.rooms.set(room.id, { ...room, chat: room.chat ?? [] });
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /** Creates a room with the creator in the first seat; `plans` sets up the other seats in turn order. */
  create(name: unknown, variant: unknown = "four", plans: unknown = []): { room: Room; color: PlayerColor; token: string } {
    if (!VARIANT_IDS.includes(variant as VariantId)) throw new RoomError("Unknown board");
    const players = getVariant(variant as VariantId).players;
    const others = players.slice(1);
    if (!Array.isArray(plans) || plans.length > others.length || !plans.every(isPlan)) throw new RoomError("Bad seat plan");

    let id: string;
    do {
      id = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(id));

    const host = players[0]!;
    const seat = newSeat(name);
    const room: Room = {
      id,
      variant: variant as VariantId,
      players,
      host,
      phase: "lobby",
      seats: { [host]: seat },
      plan: {},
      state: createGame({ variant: variant as VariantId }),
      chat: [],
      lastActivity: Date.now(),
    };
    others.forEach((color, i) => this.assign(room, color, (plans as SeatPlan[])[i] ?? "friend"));
    this.rooms.set(id, room);
    this.startIfFull(room);
    return { room, color: host, token: seat.token };
  }

  get(roomId: unknown): Room {
    const room = typeof roomId === "string" ? this.rooms.get(roomId.toUpperCase()) : undefined;
    if (!room) throw new RoomError("Room not found");
    return room;
  }

  /** Reclaims a seat by token, takes the first open friend seat in the lobby, or joins as a spectator. */
  join(roomId: unknown, name: unknown, token?: unknown): { room: Room; color: PlayerColor | null; token: string | null } {
    const room = this.get(roomId);
    const reclaimed = room.players.find((c) => typeof token === "string" && room.seats[c]?.token === token);
    if (reclaimed) return { room, color: reclaimed, token: token as string };

    const free = room.phase === "lobby" ? room.players.find((c) => room.plan[c] === "friend" && !room.seats[c]) : undefined;
    if (!free) return { room, color: null, token: null };
    const seat = newSeat(name);
    room.seats[free] = seat;
    this.startIfFull(room);
    return { room, color: free, token: seat.token };
  }

  /** Host only, in the lobby: makes a seat a friend's seat or a bot. People already seated can't be replaced. */
  setSeat(roomId: unknown, color: PlayerColor | null, target: unknown, plan: unknown): Room {
    const room = this.lobby(roomId, color);
    const seatColor = room.players.find((c) => c === target && c !== room.host);
    if (!seatColor) throw new RoomError("That seat can't be changed");
    if (!isPlan(plan)) throw new RoomError("Unknown seat type");
    const current = room.seats[seatColor];
    if (current && !current.bot) throw new RoomError(`${current.name} is sitting there`);
    this.assign(room, seatColor, plan);
    this.startIfFull(room);
    return room;
  }

  /** The bot level playing the current turn, if a bot is to move. */
  botToMove(room: Room): BotLevel | null {
    return room.phase === "playing" ? (room.seats[room.state.currentPlayer]?.bot ?? null) : null;
  }

  /** Host only: starts with whoever is seated; open seats sit the game out. */
  start(roomId: unknown, color: PlayerColor | null): Room {
    const room = this.lobby(roomId, color);
    if (room.players.filter((c) => room.seats[c]).length < 2) throw new RoomError("Need at least 2 players to start");
    this.begin(room);
    return room;
  }

  move(roomId: unknown, color: PlayerColor | null, move: MoveInput): Room {
    const room = this.playing(roomId, color);
    const before = room.state;
    // The engine rejects anything that isn't this seat's turn or isn't a legal move.
    room.state = applyMove(room.state, { from: move.from, to: move.to, promotion: move.promotion, player: color! });
    this.afterChange(room, before);
    return room;
  }

  resign(roomId: unknown, color: PlayerColor | null): Room {
    const room = this.playing(roomId, color);
    const before = room.state;
    room.state = resign(room.state, color!);
    this.afterChange(room, before);
    return room;
  }

  /** Posts to the message board as the seat `color`, or as a spectator called `name` when `color` is null. */
  say(roomId: unknown, color: PlayerColor | null, name: unknown, text: unknown): Room {
    const room = this.get(roomId);
    const clean = typeof text === "string" ? text.trim().slice(0, MAX_CHAT_LENGTH) : "";
    if (!clean) throw new RoomError("Say something first");
    const seat = color && room.seats[color];
    this.post(room, { name: seat ? seat.name : cleanName(name), color: seat ? color : null, bot: false, text: clean });
    this.touch(room);
    return room;
  }

  connect(room: Room, color: PlayerColor | null, delta: 1 | -1): void {
    const seat = color && room.seats[color];
    if (seat) seat.connections = Math.max(0, seat.connections + delta);
    this.touch(room);
  }

  /** Drops rooms no person is connected to that have been idle longer than `maxIdleMs`. */
  sweep(maxIdleMs: number, now = Date.now()): void {
    for (const [id, room] of this.rooms) {
      const connected = room.players.some((c) => (room.seats[c]?.connections ?? 0) > 0);
      if (!connected && now - room.lastActivity > maxIdleMs) this.rooms.delete(id);
    }
  }

  view(room: Room): RoomView {
    const seats: RoomView["seats"] = {};
    for (const c of room.players) {
      const seat = room.seats[c];
      seats[c] = seat ? { name: seat.name, connected: seat.bot !== null || seat.connections > 0, bot: seat.bot } : null;
    }
    return {
      id: room.id,
      variant: room.variant,
      host: room.host,
      phase: room.phase,
      players: [...room.players],
      seats,
      plan: { ...room.plan },
      state: room.state,
      chat: room.chat,
    };
  }

  private assign(room: Room, color: PlayerColor, plan: SeatPlan): void {
    room.plan[color] = plan;
    room.seats[color] = plan === "friend" ? null : botSeat(color, plan);
  }

  private begin(room: Room): void {
    room.state = room.players.filter((c) => !room.seats[c]).reduce((state, c) => resign(state, c), room.state);
    room.phase = "playing";
    const greeter = room.players.find((c) => room.seats[c]?.bot);
    if (greeter) this.post(room, this.botLine(room, greeter, GREETINGS[Math.floor(this.random() * GREETINGS.length)]!));
    this.touch(room);
  }

  private lobby(roomId: unknown, color: PlayerColor | null): Room {
    const room = this.get(roomId);
    if (color !== room.host) throw new RoomError("Only the host can do that");
    if (room.phase !== "lobby") throw new RoomError("The game has already started");
    return room;
  }

  private startIfFull(room: Room): void {
    if (room.players.every((c) => room.seats[c])) this.begin(room);
    else this.touch(room);
  }

  private playing(roomId: unknown, color: PlayerColor | null): Room {
    const room = this.get(roomId);
    if (!color) throw new RoomError("Spectators cannot play");
    if (room.phase !== "playing") throw new RoomError(room.phase === "lobby" ? "The game has not started" : "The game is over");
    return room;
  }

  private afterChange(room: Room, before: GameState): void {
    if (room.state.status === "finished") room.phase = "finished";
    const isBot = (c: PlayerColor) => Boolean(room.seats[c]?.bot);
    const who = (c: PlayerColor) => room.seats[c]?.name ?? c;
    for (const remark of banter(before, room.state, isBot, who, this.random)) {
      this.post(room, this.botLine(room, remark.color, remark.text));
    }
    this.touch(room);
  }

  private botLine(room: Room, color: PlayerColor, text: string): Omit<ChatMessage, "id" | "at"> {
    return { name: room.seats[color]?.name ?? color, color, bot: true, text };
  }

  private post(room: Room, message: Omit<ChatMessage, "id" | "at">): void {
    room.chat.push({ ...message, id: (room.chat.at(-1)?.id ?? 0) + 1, at: Date.now() });
    if (room.chat.length > CHAT_KEPT) room.chat.splice(0, room.chat.length - CHAT_KEPT);
  }

  private touch(room: Room): void {
    room.lastActivity = Date.now();
    this.onChange(room);
  }
}
