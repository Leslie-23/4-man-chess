import type { BotLevel, GameState, MoveInput, PlayerColor, VariantId } from "@fourman/game-engine";

export const DEFAULT_SERVER_PORT = 4000;

export interface SeatView {
  name: string;
  connected: boolean;
  /** Set when the server plays this seat. */
  bot: BotLevel | null;
}

export type RoomPhase = "lobby" | "playing" | "finished";

/** Who a seat is for: a friend joining with the room code, or a bot at some level. */
export type SeatPlan = "friend" | BotLevel;

/** Everything a client needs to draw a room; broadcast to the whole room after every change. */
export interface RoomView {
  id: string;
  variant: VariantId;
  host: PlayerColor;
  phase: RoomPhase;
  /** Seats in turn order for this board. */
  players: PlayerColor[];
  seats: Partial<Record<PlayerColor, SeatView | null>>;
  plan: Partial<Record<PlayerColor, SeatPlan>>;
  state: GameState;
}

export type AckResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
type Ack<T = {}> = (result: AckResult<T>) => void;

/** Seat granted on create/join. Keep `token` to reclaim the seat after a reload or reconnect. */
export interface SeatGrant {
  roomId: string;
  color: PlayerColor | null;
  token: string | null;
}

export interface ClientToServerEvents {
  /**
   * Creates a room with you in the first seat. `seats` plans the other seats in
   * turn order (default: all friends). Bots are seated at once; the game starts
   * as soon as every seat is filled.
   */
  "room:create": (payload: { name: string; variant?: VariantId; seats?: SeatPlan[] }, ack: Ack<SeatGrant>) => void;
  /** Joins with a free seat, reclaims one via `token`, or watches as a spectator when full. */
  "room:join": (payload: { roomId: string; name: string; token?: string }, ack: Ack<SeatGrant>) => void;
  /** Host only, before the game starts: makes a seat a friend's seat or a bot of some level. */
  "room:set-seat": (payload: { roomId: string; color: PlayerColor; plan: SeatPlan }, ack: Ack) => void;
  /** Host only. Starts with whoever is seated; empty seats sit the game out. */
  "game:start": (payload: { roomId: string }, ack: Ack) => void;
  "game:move": (payload: { roomId: string; move: MoveInput }, ack: Ack) => void;
  "game:resign": (payload: { roomId: string }, ack: Ack) => void;
}

export interface ServerToClientEvents {
  "room:update": (room: RoomView) => void;
}
