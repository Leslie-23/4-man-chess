import { BOARD, JAIL_FINE, groupOf } from "./board.js";
import { currentActor, playerById, unmortgageCost } from "./game.js";
import type { Action, GameState, Player, Trade } from "./types.js";

export type BotLevel = "easy" | "hard";

/** Cash a bot keeps in hand for rent, so one bad landing doesn't bankrupt it. */
const RESERVE: Record<BotLevel, number> = { easy: 50, hard: 150 };

/**
 * What a bot does when it's `id`'s move. Returns null if it isn't. Pass
 * `random` for variety; a seeded one replays games exactly.
 *
 * - easy: buys most things it can afford, bids a little, rarely builds.
 * - hard: keeps a cash cushion, chases colour sets (and blocks others'), builds
 *   evenly on full sets, and sells or mortgages the least useful things first.
 */
export function chooseBotAction(state: GameState, id: string, random: () => number, level: BotLevel = "hard"): Action | null {
  if (currentActor(state) !== id) return null;
  const me = playerById(state, id);
  const reserve = RESERVE[level];
  if (state.trade) return { type: judgeTrade(state, me, state.trade) ? "accept" : "reject" };

  switch (state.phase) {
    case "debt":
      return raiseCash(state, me, state.debts[0]!.amount);

    case "buy": {
      const tile = BOARD[me.position]!;
      if (me.cash < tile.price!) return { type: "decline" };
      const wanted = level === "easy" ? random() < 0.8 : me.cash - tile.price! >= reserve || completesSet(state, me, me.position) || blocksSet(state, me, me.position);
      return wanted ? { type: "buy" } : { type: "decline" };
    }

    case "auction": {
      const auction = state.auction!;
      const tile = BOARD[auction.tile]!;
      const worth = tile.price! * (level === "easy" ? 0.8 : completesSet(state, me, auction.tile) || blocksSet(state, me, auction.tile) ? 1.4 : 1);
      const bid = auction.highBid + (level === "easy" ? 5 : 10);
      return bid <= worth && bid <= me.cash - (level === "easy" ? 0 : reserve / 2) ? { type: "bid", amount: bid } : { type: "pass" };
    }

    case "roll":
      if (me.inJail) {
        if (me.jailCards > 0) return { type: "use-jail-card" };
        // Early on, streets are for sale and it's worth getting out; later, jail is a safe place to sit.
        const unsold = state.deeds.filter((d) => d && !d.owner).length;
        if (unsold > 8 && me.cash >= JAIL_FINE + reserve) return { type: "pay-jail" };
      }
      return { type: "roll" };

    case "end":
      return (level === "hard" && (unmortgageNext(state, me, reserve) ?? buildNext(state, me, reserve) ?? offerForSet(state, me, reserve))) || { type: "end-turn" };

    default:
      return null;
  }
}

/** Pay if possible; otherwise sell a building, then mortgage, then give up. */
function raiseCash(state: GameState, me: Player, owed: number): Action {
  if (me.cash >= owed) return { type: "pay-debt" };
  const mine = state.deeds.flatMap((d, i) => (d?.owner === me.id ? [i] : []));
  // Sell from the fullest street of a set first: the even-selling rule demands it.
  const built = mine
    .filter((i) => state.deeds[i]!.houses > 0)
    .filter((i) => state.deeds[i]!.houses === Math.max(...groupOf(BOARD[i]!.group!).map((g) => state.deeds[g]!.houses)));
  if (built.length > 0) return { type: "sell-house", tile: built.sort((a, b) => BOARD[a]!.houseCost! - BOARD[b]!.houseCost!)[0]! };
  // Mortgage the cheapest thing that isn't part of a set being built on.
  const canMortgage = mine.filter(
    (i) => !state.deeds[i]!.mortgaged && (!BOARD[i]!.group || groupOf(BOARD[i]!.group!).every((g) => state.deeds[g]!.houses === 0)),
  );
  if (canMortgage.length > 0) return { type: "mortgage", tile: canMortgage.sort((a, b) => BOARD[a]!.price! - BOARD[b]!.price!)[0]! };
  return { type: "bankrupt" };
}

function buildNext(state: GameState, me: Player, reserve: number): Action | null {
  const options = state.deeds.flatMap((deed, i) => {
    const tile = BOARD[i]!;
    if (deed?.owner !== me.id || tile.kind !== "street" || deed.houses >= 5) return [];
    const group = groupOf(tile.group!);
    const set = group.every((g) => state.deeds[g]!.owner === me.id && !state.deeds[g]!.mortgaged);
    const even = deed.houses === Math.min(...group.map((g) => state.deeds[g]!.houses));
    const stock = deed.houses === 4 ? state.bank.hotels > 0 : state.bank.houses > 0;
    return set && even && stock && me.cash - tile.houseCost! >= reserve ? [i] : [];
  });
  // Cheapest first spreads houses fastest; three houses is where rent jumps.
  options.sort((a, b) => state.deeds[a]!.houses - state.deeds[b]!.houses || BOARD[a]!.houseCost! - BOARD[b]!.houseCost!);
  return options.length > 0 ? { type: "build", tile: options[0]! } : null;
}

function unmortgageNext(state: GameState, me: Player, reserve: number): Action | null {
  const tile = state.deeds.findIndex((d, i) => d?.owner === me.id && d.mortgaged && me.cash - unmortgageCost(i) >= reserve * 3);
  return tile >= 0 ? { type: "unmortgage", tile } : null;
}

/** Offer cash for the one square missing from a colour set, if its owner could spare it. */
function offerForSet(state: GameState, me: Player, reserve: number): Action | null {
  if (state.offered) return null;
  for (const [i, deed] of state.deeds.entries()) {
    const tile = BOARD[i]!;
    if (!tile.group || !deed?.owner || deed.owner === me.id) continue;
    const group = groupOf(tile.group);
    const rest = group.filter((g) => g !== i);
    if (!rest.every((g) => state.deeds[g]!.owner === me.id) || group.some((g) => state.deeds[g]!.houses > 0)) continue;
    const price = Math.min(me.cash - reserve, Math.round(tile.price! * 1.8));
    if (price >= tile.price! * 1.5) return { type: "offer", to: deed.owner, give: { cash: price, tiles: [] }, get: { cash: 0, tiles: [i] } };
  }
  return null;
}

/**
 * Take a trade when what comes in beats what goes out by a margin, valuing
 * squares at their price, and never break up a set we already hold.
 */
function judgeTrade(state: GameState, me: Player, trade: Trade): boolean {
  const worth = (tiles: number[]) => tiles.reduce((sum, t) => sum + BOARD[t]!.price! * (state.deeds[t]!.mortgaged ? 0.5 : 1), 0);
  const breaksMySet = trade.get.tiles.some((t) => {
    const group = BOARD[t]!.group;
    return group && groupOf(group).every((g) => state.deeds[g]!.owner === me.id);
  });
  if (breaksMySet || me.cash < trade.get.cash) return false;
  const incoming = trade.give.cash + worth(trade.give.tiles);
  const outgoing = trade.get.cash + worth(trade.get.tiles);
  return incoming >= outgoing * 1.4;
}

/** Buying `tile` would give `me` the whole colour set. */
function completesSet(state: GameState, me: Player, tile: number): boolean {
  const group = BOARD[tile]!.group;
  return Boolean(group) && groupOf(group!).every((i) => i === tile || state.deeds[i]!.owner === me.id);
}

/** Someone else owns the rest of `tile`'s set, so buying it stops them. */
function blocksSet(state: GameState, me: Player, tile: number): boolean {
  const group = BOARD[tile]!.group;
  if (!group) return false;
  const others = groupOf(group).filter((i) => i !== tile).map((i) => state.deeds[i]!.owner);
  return others.every((o) => o && o !== me.id && o === others[0]);
}
