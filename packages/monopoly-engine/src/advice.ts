import { BOARD, JAIL_FINE, groupOf } from "./board.js";
import { RESERVE, auctionWorth, blocksSet, chooseBotAction, completesSet, judgeTrade } from "./bot.js";
import { describeAction } from "./describe.js";
import { playerById, rentFor, unmortgageCost } from "./game.js";
import type { Action, GameState, Player } from "./types.js";

/** A hint: the move worth making, why, and what to keep an eye on. */
export interface Advice {
  action: Action;
  /** One line, e.g. "Buy Ruby Road." */
  headline: string;
  /** The reasons behind it, most important first. */
  why: string[];
  /** Things worth knowing whatever you do: risky squares ahead, sets about to be finished. */
  watch: string[];
}

/** A square someone else would charge you for, within one roll. */
export interface Danger {
  tile: number;
  /** Who you'd pay; null for the bank (taxes). */
  owner: string | null;
  amount: number;
  /** Chance of landing there on the next roll, 0–1. */
  chance: number;
}

const CUSHION = RESERVE.hard;

/** Chance two dice add up to `sum`. */
export const landingChance = (sum: number) => (sum < 2 || sum > 12 ? 0 : (6 - Math.abs(sum - 7)) / 36);

/** Squares 2–12 ahead of `id` that would cost them money, worst (amount × chance) first. */
export function dangerAhead(state: GameState, id: string): Danger[] {
  const me = playerById(state, id);
  const out: Danger[] = [];
  for (let sum = 2; sum <= 12; sum++) {
    const tile = (me.position + sum) % BOARD.length;
    const info = BOARD[tile]!;
    const deed = state.deeds[tile];
    if (info.tax) out.push({ tile, owner: null, amount: info.tax, chance: landingChance(sum) });
    else if (deed?.owner && deed.owner !== id) {
      const amount = rentFor(state, tile, sum);
      if (amount > 0) out.push({ tile, owner: deed.owner, amount, chance: landingChance(sum) });
    }
  }
  return out.sort((a, b) => b.amount * b.chance - a.amount * a.chance);
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const nameOf = (state: GameState, id: string | null) => (id ? (state.players.find((p) => p.id === id)?.name ?? id) : "the bank");
const ordinal = (n: number) => ["", "first", "second", "third", "fourth"][n] ?? `${n}th`;

/** Rent a street charges with `houses` buildings, given whether the owner holds the whole set. */
const streetRent = (tile: number, houses: number, fullSet: boolean) => (houses > 0 ? BOARD[tile]!.rent![houses]! : BOARD[tile]!.rent![0] * (fullSet ? 2 : 1));

/** Why owning `tile` matters to `me`, in a line or two. */
function valueOf(state: GameState, me: Player, tile: number): string[] {
  const info = BOARD[tile]!;
  const lines: string[] = [];
  if (info.kind === "station") {
    const n = state.deeds.filter((d, i) => d?.owner === me.id && BOARD[i]!.kind === "station").length + 1;
    lines.push(`It'd be your ${ordinal(n)} station: each of yours would then charge $${25 * 2 ** (n - 1)}.`);
  } else if (info.kind === "utility") {
    const other = state.deeds.some((d, i) => i !== tile && d?.owner === me.id && BOARD[i]!.kind === "utility");
    lines.push(other ? "With both utilities, rent is 10× the dice (about $70 a landing)." : "A utility charges 4× the dice: steady but small.");
  } else if (info.group) {
    const group = groupOf(info.group);
    if (completesSet(state, me, tile)) {
      lines.push(`It completes your ${info.group} set: bare rent doubles to $${info.rent![0] * 2} and you can start building.`);
    } else if (blocksSet(state, me, tile)) {
      const rival = state.deeds[group.find((g) => g !== tile)!]!.owner;
      lines.push(`${nameOf(state, rival)} owns the rest of the ${info.group} set; this stops them building there.`);
    } else {
      const mine = group.filter((g) => state.deeds[g]!.owner === me.id).length;
      const taken = group.some((g) => state.deeds[g]!.owner && state.deeds[g]!.owner !== me.id);
      lines.push(
        mine > 0
          ? `You'd hold ${mine + 1} of the ${group.length} ${info.group} squares.`
          : taken
            ? `Someone else already has part of the ${info.group} set, so it's hard to finish; mainly a trading chip.`
            : `It starts a claim on the ${info.group} set.`,
      );
    }
    if (info.group === "orange" || info.group === "red") lines.push(`${info.group === "orange" ? "Orange" : "Red"} squares are among the most landed on (players leaving jail hit them often).`);
  }
  return lines;
}

/** How much cash would be left, and whether that's comfortable given what's ahead. */
function cashLine(state: GameState, me: Player, spend: number): string {
  const left = me.cash - spend;
  const worst = dangerAhead(state, me.id)[0];
  if (left >= CUSHION) return `You'd still have $${left} in hand.`;
  return `It leaves only $${left}${worst && worst.amount > left ? `, less than ${BOARD[worst.tile]!.name}'s $${worst.amount} if you land there` : ""}.`;
}

function reasons(state: GameState, me: Player, action: Action): string[] {
  const debt = state.debts[0];
  switch (action.type) {
    case "buy": {
      const price = BOARD[me.position]!.price!;
      return [...valueOf(state, me, me.position), cashLine(state, me, price)];
    }
    case "decline": {
      const tile = BOARD[me.position]!;
      if (me.cash < tile.price!) return [`You can't afford it: it costs $${tile.price} and you have $${me.cash}.`];
      return [
        `At $${tile.price} it would leave just $${me.cash - tile.price!}, too thin to cover rent if you land somewhere bad.`,
        ...(state.options.auctions ? ["It goes to auction next, where you can still try to get it for less."] : []),
      ];
    }
    case "bid":
    case "pass": {
      const auction = state.auction!;
      const worth = Math.round(auctionWorth(state, me, auction.tile));
      const why = valueOf(state, me, auction.tile);
      const price = BOARD[auction.tile]!.price!;
      if (action.type === "bid") return [worth > price ? `It's worth up to about $${worth} to you, above its $${price} list price.` : `Anything up to its $${price} list price is a fair buy.`, ...why];
      return auction.highBid + 10 > worth
        ? [`The bidding ($${auction.highBid}) is near what it's worth to you, about $${worth}.`]
        : [`Keep your cash: bidding more would leave you under a $${CUSHION / 2} buffer.`];
    }
    case "build": {
      const deed = state.deeds[action.tile]!;
      const info = BOARD[action.tile]!;
      const from = streetRent(action.tile, deed.houses, true);
      const to = streetRent(action.tile, deed.houses + 1, true);
      return [
        `Rent on ${info.name} goes from $${from} to $${to} for $${info.houseCost}.`,
        ...(deed.houses === 2 ? ["The third house is where rent jumps the most."] : []),
        ...(deed.houses === 0 ? ["Houses go up evenly across a set, so this is the next one allowed."] : []),
        cashLine(state, me, info.houseCost!),
      ];
    }
    case "sell-house": {
      const info = BOARD[action.tile]!;
      return [`You owe $${debt?.amount ?? 0} and hold $${me.cash}.`, `Selling returns $${info.houseCost! / 2}. Sets must stay even, so it comes off the fullest street first.`];
    }
    case "mortgage":
      return [`You owe $${debt?.amount ?? 0} and hold $${me.cash}.`, `Mortgaging raises $${BOARD[action.tile]!.price! / 2}; ${BOARD[action.tile]!.name} is your least useful square, and it stops earning rent until you pay it off.`];
    case "unmortgage":
      return [`It costs $${unmortgageCost(action.tile)} (half the price plus 10%), and ${BOARD[action.tile]!.name} starts earning rent again.`, cashLine(state, me, unmortgageCost(action.tile))];
    case "pay-debt":
      return [`You have $${me.cash}, enough to cover the $${debt?.amount ?? 0}.`];
    case "bankrupt":
      return [`Selling and mortgaging everything still can't cover $${debt?.amount ?? 0}.`];
    case "pay-jail": {
      const unsold = state.deeds.filter((d) => d && !d.owner).length;
      return [`${unsold} squares are still for sale; get out and buy them before others do.`, `The fine is $${JAIL_FINE}.`];
    }
    case "use-jail-card":
      return ["It's a free way out, and squares are still worth chasing."];
    case "roll":
      if (me.inJail) {
        const unsold = state.deeds.filter((d) => d && !d.owner).length;
        return unsold <= 8
          ? ["Most squares are sold, so jail is a safe place to sit: you still collect rent but can't land on anyone's. Roll for doubles instead of paying."]
          : [`Paying $${JAIL_FINE} would leave you short; roll for doubles instead.`];
      }
      return [];
    case "offer": {
      const tile = action.get.tiles[0]!;
      const info = BOARD[tile]!;
      return [
        `${info.name} is the last square you need for the ${info.group} set; with it you can build.`,
        `$${action.give.cash} is well over its $${info.price} list price, enough that ${nameOf(state, action.to)} may take it.`,
      ];
    }
    case "accept":
    case "reject": {
      const trade = state.trade!;
      const value = (tiles: number[]) => tiles.reduce((sum, t) => sum + BOARD[t]!.price! * (state.deeds[t]!.mortgaged ? 0.5 : 1), 0);
      const incoming = trade.give.cash + value(trade.give.tiles);
      const outgoing = trade.get.cash + value(trade.get.tiles);
      const finishes = trade.give.tiles.some((t) => BOARD[t]!.group && completesSet(state, me, t));
      const handsSet = trade.get.tiles.some((t) => {
        const group = BOARD[t]!.group;
        return group && groupOf(group).every((g) => g === t || state.deeds[g]!.owner === trade.from);
      });
      const lines = [`You'd get about $${incoming} in value for $${outgoing}.`];
      if (finishes) lines.push("It completes one of your sets.");
      if (handsSet) lines.push(`It hands ${nameOf(state, trade.from)} a full colour set, so they can build.`);
      return judgeTrade(state, me, trade) || action.type === "accept" ? lines : [...lines, "It isn't clearly in your favour."];
    }
    case "end-turn": {
      const sets = new Set(state.deeds.flatMap((d, i) => (d?.owner === me.id && BOARD[i]!.group && groupOf(BOARD[i]!.group!).every((g) => state.deeds[g]!.owner === me.id) ? [BOARD[i]!.group!] : [])));
      if (sets.size === 0) return ["You don't hold a full colour set yet, so there's nothing to build. Trade for one if you're close."];
      return [`Building more would drop you under a $${CUSHION} cushion for rent. Keep the cash for now.`];
    }
    default:
      return [];
  }
}

/** Sets an opponent is one square away from, and who holds that last square. */
function nearSets(state: GameState, me: Player): string[] {
  const groups = [...new Set(BOARD.flatMap((t) => (t.group ? [t.group] : [])))];
  return groups.flatMap((g) => {
    const tiles = groupOf(g);
    const owners = tiles.map((t) => state.deeds[t]!.owner);
    const rival = owners.find((o) => o && o !== me.id && owners.filter((x) => x === o).length === tiles.length - 1);
    if (!rival) return [];
    const missing = tiles[owners.findIndex((o) => o !== rival)]!;
    const holder = state.deeds[missing]!.owner;
    return [
      holder === me.id
        ? `${nameOf(state, rival)} needs your ${BOARD[missing]!.name} to finish the ${g} set. Don't sell it cheap.`
        : holder
          ? `${nameOf(state, rival)} needs ${BOARD[missing]!.name} from ${nameOf(state, holder)} to finish the ${g} set.`
          : `${nameOf(state, rival)} needs only ${BOARD[missing]!.name} for the ${g} set. Grab it if you land there.`,
    ];
  });
}

/** What's worth watching from `me`'s seat, whatever the move. */
function watchList(state: GameState, me: Player): string[] {
  const lines: string[] = [];
  if (state.phase === "roll" && !me.inJail) {
    const danger = dangerAhead(state, me.id).filter((d) => d.owner);
    const risk = danger.reduce((sum, d) => sum + d.chance, 0);
    const top = danger.slice(0, 2).map((d) => `${BOARD[d.tile]!.name} ($${d.amount}, ${pct(d.chance)})`);
    lines.push(danger.length ? `This roll: ${pct(risk)} chance of paying rent. Worst: ${top.join(", ")}.` : "This roll: nobody's squares are in reach. Safe.");
  }
  lines.push(...nearSets(state, me).slice(0, 2));
  return lines;
}

/** The hard bot's move for `id`, with reasons a person can follow. Null when it isn't their move. */
export function adviseMove(state: GameState, id: string): Advice | null {
  const action = chooseBotAction(state, id, () => 0.5, "hard");
  if (!action) return null;
  const me = playerById(state, id);
  return { action, headline: describeAction(state, action), why: reasons(state, me, action), watch: watchList(state, me) };
}
