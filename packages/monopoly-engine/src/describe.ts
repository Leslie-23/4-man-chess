import { BOARD } from "./board.js";
import type { Action, GameState } from "./types.js";

/** A plain-English line for an action, e.g. "Buy Ruby Road." Used by hints and the coach. */
export function describeAction(state: GameState, action: Action | null): string {
  if (!action) return "Nothing to do; it's someone else's move.";
  switch (action.type) {
    case "buy":
      return `Buy ${BOARD[state.players[state.current]!.position]!.name}.`;
    case "decline":
      return "Decline to buy (it goes to auction).";
    case "bid":
      return `Bid ${action.amount} in the auction.`;
    case "pass":
      return "Stop bidding in the auction.";
    case "build":
      return `Build on ${BOARD[action.tile]!.name}.`;
    case "sell-house":
      return `Sell a building on ${BOARD[action.tile]!.name} to raise cash.`;
    case "mortgage":
      return `Mortgage ${BOARD[action.tile]!.name} to raise cash.`;
    case "unmortgage":
      return `Pay off the mortgage on ${BOARD[action.tile]!.name}.`;
    case "offer":
      return `Offer ${state.players.find((p) => p.id === action.to)?.name} ${action.give.cash} for ${action.get.tiles.map((t) => BOARD[t]!.name).join(", ")} to complete a set.`;
    case "pay-jail":
      return "Pay the fine to get out of jail while there are still squares to buy.";
    case "use-jail-card":
      return "Use the get-out-of-jail-free card.";
    case "pay-debt":
      return "Pay what you owe.";
    case "bankrupt":
      return "There's no way to raise enough; declare bankruptcy.";
    case "roll":
      return "Roll the dice.";
    case "end-turn":
      return "End the turn.";
    default:
      return action.type;
  }
}
