import type { BotLevel, GameState, MoveInput, PlayerColor, VariantId } from "@fourman/game-engine";

export const DEFAULT_SERVER_PORT = 4000;

export interface SeatView {
  name: string;
  connected: boolean;
  /** Set when the server plays this seat. */
  bot: BotLevel | null;
}

/** One line on the room's message board. `color` is null for spectators. */
export interface ChatMessage {
  id: number;
  name: string;
  color: PlayerColor | null;
  bot: boolean;
  /** Set on the table's own notices (polls opening and closing, timeouts); `name` is then "Table". */
  system?: boolean;
  text: string;
  /** Epoch milliseconds. */
  at: number;
}

/** Time-per-move choices a poll offers; null means no limit. */
export const MOVE_TIME_OPTIONS: readonly (number | null)[] = [15, 30, 60, null];

/** A vote among the seated people on how long each move may take. */
export interface MovePoll {
  id: number;
  /** Who voted for what, by seat. */
  votes: Partial<Record<PlayerColor, number | null>>;
  /** The seats whose votes count: people, not bots. */
  voters: PlayerColor[];
  /** Milliseconds until the poll closes by itself. */
  closesInMs: number;
}

export const MAX_CHAT_LENGTH = 200;

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
  /** Latest messages, oldest first. */
  chat: ChatMessage[];
  /** Seconds each move may take, as voted; null for no limit. */
  moveSeconds: number | null;
  /** Milliseconds left for the player to move, when there's a limit. Counted from when this view was sent. */
  turnEndsInMs: number | null;
  poll: MovePoll | null;
  /** The coach (explanations written by a language model) is switched on for this server. */
  coach: boolean;
  /** Voice chat is set up on this server. */
  voice: boolean;
}

/** Window a leaderboard covers, counting back from now. */
export type LeaderboardPeriod = "day" | "week" | "all";
export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ["day", "week", "all"];

/**
 * One entrant on the leaderboard. People are grouped by name (there are no
 * accounts); the server's bots are grouped by level, whatever seat they took.
 */
export interface LeaderboardRow {
  key: string;
  name: string;
  bot: BotLevel | null;
  games: number;
  wins: number;
  /** Epoch milliseconds of their latest finished game in the period. */
  lastPlayed: number;
}

/** A finished game, newest first on the leaderboard page. */
export interface RecentGame {
  id: string;
  variant: VariantId;
  finishedAt: number;
  /** Entrant key of the winner; null for a draw. */
  winner: string | null;
  players: { key: string; name: string; bot: BotLevel | null; color: PlayerColor }[];
}

export interface LeaderboardView {
  period: LeaderboardPeriod;
  rows: LeaderboardRow[];
  recent: RecentGame[];
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
  /** Posts to the room's message board; players and spectators alike. */
  "chat:send": (payload: { roomId: string; text: string }, ack: Ack) => void;
  /** Seated people only: opens a poll on time per move. One poll at a time. */
  "poll:start": (payload: { roomId: string }, ack: Ack) => void;
  "poll:vote": (payload: { roomId: string; seconds: number | null }, ack: Ack) => void;
  /** Seated players only: a short plain-English read of the position and a move worth playing. */
  "coach:ask": (payload: { roomId: string }, ack: Ack<{ advice: string }>) => void;
  /** A pass into the room's voice channel: seated players may talk, spectators listen. */
  "voice:token": (payload: { roomId: string }, ack: Ack<{ url: string; token: string; canTalk: boolean }>) => void;
  /** Wins and games per entrant over `period`, plus the latest finished games. No room needed. */
  "leaderboard:get": (payload: { period: LeaderboardPeriod }, ack: Ack<{ board: LeaderboardView }>) => void;
}

export interface ServerToClientEvents {
  "room:update": (room: RoomView) => void;
}
