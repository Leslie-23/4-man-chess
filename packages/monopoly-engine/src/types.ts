/** Street colour sets. Owning a whole set doubles its bare rent and lets you build. */
export type ColorGroup = "brown" | "sky" | "pink" | "orange" | "red" | "yellow" | "green" | "navy";

export type TileKind = "go" | "street" | "station" | "utility" | "tax" | "chance" | "chest" | "jail" | "parking" | "go-to-jail";

export interface Tile {
  name: string;
  kind: TileKind;
  /** Purchase price, for streets, stations and utilities. */
  price?: number;
  group?: ColorGroup;
  /** Streets: rent bare, then with 1–4 houses, then with a hotel. */
  rent?: readonly [number, number, number, number, number, number];
  /** Streets: the cost of each house (a hotel costs one more). */
  houseCost?: number;
  /** Tax squares: the amount due. */
  tax?: number;
}

/** Who owns a buyable square and what's on it. */
export interface Deed {
  owner: string | null;
  /** 0–4 houses; 5 means a hotel. */
  houses: number;
  mortgaged: boolean;
}

export interface Player {
  id: string;
  name: string;
  cash: number;
  position: number;
  inJail: boolean;
  /** Failed attempts to roll doubles out of jail this stay. */
  jailTurns: number;
  /** Get-out-of-jail-free cards held. */
  jailCards: number;
  bankrupt: boolean;
}

/**
 * Where the game is in the current turn.
 * - roll: the current player rolls (or, in jail, pays / uses a card first).
 * - buy: they landed on an unowned square and may buy it or decline.
 * - auction: a declined square is up for bids; `auction.bidder` acts.
 * - debt: someone owes more cash than they hold; they raise money (sell houses,
 *   mortgage), then pay, or go bankrupt.
 * - end: the roll is resolved; they may build or mortgage, then end the turn.
 * - finished: one player is left.
 */
export type Phase = "roll" | "buy" | "auction" | "debt" | "end" | "finished";

export interface Auction {
  tile: number;
  highBid: number;
  highBidder: string | null;
  /** Still bidding, in turn order; passing drops you out. */
  active: string[];
  /** Whose bid it is. */
  bidder: string;
}

export interface Debt {
  debtor: string;
  /** Null when the bank is owed. */
  creditor: string | null;
  amount: number;
  reason: string;
}

export type CardDeck = "chance" | "chest";

export interface LogEntry {
  turn: number;
  player: string | null;
  text: string;
}

export interface GameOptions {
  startingCash: number;
  goSalary: number;
  /** Taxes and fines go into a pot the next player to land on Free Parking takes. A popular house rule. */
  parkingJackpot: boolean;
  /** Declined squares go to auction (the official rule). Off: they just stay unsold. */
  auctions: boolean;
  /** End after this many turns; the richest by net worth wins. Null plays to the last player standing. */
  turnLimit: number | null;
}

/** What one side of a trade hands over. */
export interface TradeSide {
  cash: number;
  tiles: number[];
}

/** An offer from `from` to `to`: `give` goes to them, `get` comes back. `to` answers before play goes on. */
export interface Trade {
  from: string;
  to: string;
  give: TradeSide;
  get: TradeSide;
}

export interface GameState {
  options: GameOptions;
  /** In turn order. */
  players: Player[];
  /** Index into `players` of whoever's turn it is. */
  current: number;
  phase: Phase;
  /** One per square; null for squares nobody can own. */
  deeds: (Deed | null)[];
  /** The last roll, for showing and for utility rent. */
  dice: [number, number] | null;
  /** Doubles rolled in a row this turn; three sends you to jail. */
  doubles: number;
  /** Roll again once this roll is settled (they rolled doubles). */
  rollAgain: boolean;
  auction: Auction | null;
  /** Payments someone couldn't cover yet, settled one at a time; the first debtor acts. */
  debts: Debt[];
  trade: Trade | null;
  /** The current player already made an offer this turn (one per turn keeps things moving). */
  offered: boolean;
  /** The card drawn this turn, for showing. */
  card: { deck: CardDeck; text: string } | null;
  /** Card order still to draw, as indices into the deck's card list. */
  decks: Record<CardDeck, number[]>;
  /** Houses and hotels still in the bank; building stops when they run out. */
  bank: { houses: number; hotels: number };
  /** Free Parking pot, when the jackpot house rule is on. */
  pot: number;
  /** Counts every turn, for the log. */
  turn: number;
  log: LogEntry[];
  winner: string | null;
}

export type Action =
  | { type: "roll" }
  | { type: "buy" }
  | { type: "decline" }
  | { type: "bid"; amount: number }
  | { type: "pass" }
  | { type: "build"; tile: number }
  | { type: "sell-house"; tile: number }
  | { type: "mortgage"; tile: number }
  | { type: "unmortgage"; tile: number }
  | { type: "pay-jail" }
  | { type: "use-jail-card" }
  | { type: "pay-debt" }
  | { type: "bankrupt" }
  | { type: "end-turn" }
  | { type: "offer"; to: string; give: TradeSide; get: TradeSide }
  | { type: "accept" }
  | { type: "reject" };

/** A move that isn't allowed right now; the message is safe to show to players. */
export class IllegalActionError extends Error {}
