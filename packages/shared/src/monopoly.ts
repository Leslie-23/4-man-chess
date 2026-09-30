import type { Action, BotLevel, GameOptions, GameState } from "@fourman/monopoly-engine";
import type { AckResult, ChatMessage } from "./index.js";

/** The Socket.IO namespace Monopoly rooms live on, beside chess on the same server. */
export const MONOPOLY_NAMESPACE = "/monopoly";
export const MONOPOLY_MIN_PLAYERS = 2;
export const MONOPOLY_MAX_PLAYERS = 6;

/** Who a seat is for: a friend joining with the room code, or a bot. */
export type MonopolySeatPlan = "friend" | BotLevel;

export interface MonopolySeatView {
  /** The engine's player id for this seat ("p0", "p1", …). */
  id: string;
  name: string;
  connected: boolean;
  bot: BotLevel | null;
}

export interface MonopolyRoomView {
  id: string;
  phase: "lobby" | "playing" | "finished";
  /** Seat index of the host. */
  host: number;
  /** One per seat, in turn order; null while a friend's seat is open. */
  seats: (MonopolySeatView | null)[];
  plan: MonopolySeatPlan[];
  options: GameOptions;
  /** Null until the game starts. */
  state: GameState | null;
  chat: ChatMessage[];
}

export interface MonopolySeatGrant {
  roomId: string;
  /** Seat index, or null when watching. */
  seat: number | null;
  token: string | null;
}

type Ack<T = {}> = (result: AckResult<T>) => void;

export interface MonopolyClientEvents {
  /** You take seat 0; `seats` plans the rest (1–5 more). Bots sit at once; it starts when every seat is filled. */
  "room:create": (payload: { name: string; seats: MonopolySeatPlan[]; options?: Partial<GameOptions> }, ack: Ack<MonopolySeatGrant>) => void;
  "room:join": (payload: { roomId: string; name: string; token?: string }, ack: Ack<MonopolySeatGrant>) => void;
  /** Host only: start with whoever is seated (at least two); open seats are removed. */
  "game:start": (payload: { roomId: string }, ack: Ack) => void;
  /** Any game action; the server checks it's this seat's move and that it's legal. */
  "game:act": (payload: { roomId: string; action: Action }, ack: Ack) => void;
  "chat:send": (payload: { roomId: string; text: string }, ack: Ack) => void;
}

export interface MonopolyServerEvents {
  "room:update": (room: MonopolyRoomView) => void;
}
