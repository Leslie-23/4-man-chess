import type { CardDeck } from "./types.js";

export type CardEffect =
  /** Positive: the bank pays you. Negative: you pay the bank. */
  | { kind: "money"; amount: number }
  /** Positive: every other player pays you. Negative: you pay each of them. */
  | { kind: "each"; amount: number }
  /** Go straight to a square, collecting the Go salary if you pass it. */
  | { kind: "move"; to: number }
  | { kind: "back"; steps: number }
  /** To the next station (paying double rent) or utility (paying 10× the dice). */
  | { kind: "nearest"; target: "station" | "utility" }
  | { kind: "jail" }
  | { kind: "jail-card" }
  /** Pay per house and per hotel you own. */
  | { kind: "repairs"; house: number; hotel: number };

export interface Card {
  text: string;
  effect: CardEffect;
}

export const CARDS: Record<CardDeck, readonly Card[]> = {
  chance: [
    { text: "Advance to Go. Collect your salary.", effect: { kind: "move", to: 0 } },
    { text: "Take a trip to Poppy Square.", effect: { kind: "move", to: 24 } },
    { text: "Stroll down to Flamingo Walk.", effect: { kind: "move", to: 11 } },
    { text: "Head to the nearest utility. If it's owned, pay ten times the dice.", effect: { kind: "nearest", target: "utility" } },
    { text: "Catch the nearest train. If the station is owned, pay double rent.", effect: { kind: "nearest", target: "station" } },
    { text: "Catch the nearest train. If the station is owned, pay double rent.", effect: { kind: "nearest", target: "station" } },
    { text: "The bank pays you a dividend of 50.", effect: { kind: "money", amount: 50 } },
    { text: "Get out of jail free. Keep this card until you need it.", effect: { kind: "jail-card" } },
    { text: "Go back three spaces.", effect: { kind: "back", steps: 3 } },
    { text: "Go directly to jail. Do not pass Go.", effect: { kind: "jail" } },
    { text: "General repairs: pay 25 per house and 100 per hotel.", effect: { kind: "repairs", house: 25, hotel: 100 } },
    { text: "Speeding fine: pay 15.", effect: { kind: "money", amount: -15 } },
    { text: "Take the train from North Station.", effect: { kind: "move", to: 5 } },
    { text: "Treat yourself to Sapphire Point.", effect: { kind: "move", to: 39 } },
    { text: "You're elected chair of the board. Pay each player 50.", effect: { kind: "each", amount: -50 } },
    { text: "Your building loan matures. Collect 150.", effect: { kind: "money", amount: 150 } },
  ],
  chest: [
    { text: "Advance to Go. Collect your salary.", effect: { kind: "move", to: 0 } },
    { text: "Bank error in your favour. Collect 200.", effect: { kind: "money", amount: 200 } },
    { text: "Doctor's fees. Pay 50.", effect: { kind: "money", amount: -50 } },
    { text: "You sell some shares. Collect 50.", effect: { kind: "money", amount: 50 } },
    { text: "Get out of jail free. Keep this card until you need it.", effect: { kind: "jail-card" } },
    { text: "Go directly to jail. Do not pass Go.", effect: { kind: "jail" } },
    { text: "Holiday fund matures. Collect 100.", effect: { kind: "money", amount: 100 } },
    { text: "Tax refund. Collect 20.", effect: { kind: "money", amount: 20 } },
    { text: "It's your birthday! Collect 10 from every player.", effect: { kind: "each", amount: 10 } },
    { text: "Life insurance pays out. Collect 100.", effect: { kind: "money", amount: 100 } },
    { text: "Hospital bill. Pay 100.", effect: { kind: "money", amount: -100 } },
    { text: "School fees. Pay 50.", effect: { kind: "money", amount: -50 } },
    { text: "Consultancy fee. Collect 25.", effect: { kind: "money", amount: 25 } },
    { text: "Street repairs: pay 40 per house and 115 per hotel.", effect: { kind: "repairs", house: 40, hotel: 115 } },
    { text: "Second prize in a talent show. Collect 10.", effect: { kind: "money", amount: 10 } },
    { text: "You inherit 100.", effect: { kind: "money", amount: 100 } },
  ],
};
