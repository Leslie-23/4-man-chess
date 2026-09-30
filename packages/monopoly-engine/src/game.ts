import { BOARD, HOTELS_IN_BANK, HOUSES_IN_BANK, JAIL, JAIL_FINE, groupOf, isBuyable } from "./board.js";
import { CARDS, type CardEffect } from "./cards.js";
import { IllegalActionError, type Action, type CardDeck, type Deed, type GameOptions, type GameState, type Player } from "./types.js";

export const DEFAULT_OPTIONS: GameOptions = { startingCash: 1500, goSalary: 200, parkingJackpot: false, auctions: true, turnLimit: null };
const LOG_KEPT = 200;

/** Returns a whole number in [0, n). `random` returns [0, 1), so games replay exactly with a seeded source. */
const pickIndex = (random: () => number, n: number) => Math.floor(random() * n);

function shuffled(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = pickIndex(random, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export function createGame(
  seats: readonly { id: string; name: string }[],
  random: () => number,
  options: Partial<GameOptions> = {},
): GameState {
  if (seats.length < 2 || seats.length > 8) throw new RangeError("A game needs 2 to 8 players");
  if (new Set(seats.map((s) => s.id)).size !== seats.length) throw new RangeError("Player ids must be unique");
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return {
    options: opts,
    players: seats.map((s) => ({ id: s.id, name: s.name, cash: opts.startingCash, position: 0, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false })),
    current: 0,
    phase: "roll",
    deeds: BOARD.map((_, i) => (isBuyable(i) ? { owner: null, houses: 0, mortgaged: false } : null)),
    dice: null,
    doubles: 0,
    rollAgain: false,
    auction: null,
    debts: [],
    trade: null,
    offered: false,
    card: null,
    decks: { chance: shuffled(CARDS.chance.length, random), chest: shuffled(CARDS.chest.length, random) },
    bank: { houses: HOUSES_IN_BANK, hotels: HOTELS_IN_BANK },
    pot: 0,
    turn: 1,
    log: [],
    winner: null,
  };
}

/** The player who must act now: the bidder in an auction, a debtor, or whoever's turn it is. */
export function currentActor(state: GameState): string | null {
  if (state.phase === "finished") return null;
  if (state.trade) return state.trade.to;
  if (state.phase === "auction") return state.auction!.bidder;
  if (state.phase === "debt") return state.debts[0]!.debtor;
  return state.players[state.current]!.id;
}

export function playerById(state: GameState, id: string): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new IllegalActionError("No such player");
  return p;
}

/** Cash plus what everything owned would fetch from the bank: the standings measure. */
export function netWorth(state: GameState, id: string): number {
  const p = playerById(state, id);
  if (p.bankrupt) return 0;
  return state.deeds.reduce((sum, deed, i) => {
    if (deed?.owner !== id) return sum;
    const tile = BOARD[i]!;
    const buildings = deed.houses * (tile.houseCost ?? 0);
    return sum + (deed.mortgaged ? tile.price! / 2 : tile.price!) + buildings;
  }, p.cash);
}

/** Rent due for landing on `index`, or 0. `double` and `tenTimes` come from cards. */
export function rentFor(state: GameState, index: number, dice: number, { double = false, tenTimes = false } = {}): number {
  const tile = BOARD[index]!;
  const deed = state.deeds[index];
  if (!deed?.owner || deed.mortgaged) return 0;
  const owned = (kind: string) => state.deeds.filter((d, i) => d?.owner === deed.owner && BOARD[i]!.kind === kind).length;
  if (tile.kind === "station") return 25 * 2 ** (owned("station") - 1) * (double ? 2 : 1);
  if (tile.kind === "utility") return dice * (tenTimes || owned("utility") === 2 ? 10 : 4);
  const rent = tile.rent!;
  if (deed.houses > 0) return rent[deed.houses]!;
  const fullSet = groupOf(tile.group!).every((i) => state.deeds[i]!.owner === deed.owner);
  return fullSet ? rent[0] * 2 : rent[0];
}

/** Returns the state after `playerId` takes `action`. Throws IllegalActionError if they can't. */
export function applyAction(state: GameState, playerId: string, action: Action, random: () => number): GameState {
  if (currentActor(state) !== playerId) throw new IllegalActionError(state.phase === "finished" ? "The game is over" : "It's not your move");
  const d = structuredClone(state);
  d.card = action.type === "roll" ? null : d.card;
  if (d.trade && action.type !== "accept" && action.type !== "reject") throw new IllegalActionError("Answer the trade offer first");
  const me = playerById(d, playerId);
  const handler = HANDLERS[action.type] as (d: GameState, me: Player, action: Action, random: () => number) => void;
  if (!handler) throw new IllegalActionError("Unknown action");
  handler(d, me, action, random);
  if (d.log.length > LOG_KEPT) d.log.splice(0, d.log.length - LOG_KEPT);
  return d;
}

type Handlers = { [K in Action["type"]]: (d: GameState, me: Player, action: Extract<Action, { type: K }>, random: () => number) => void };

const need = (ok: unknown, message: string) => {
  if (!ok) throw new IllegalActionError(message);
};
const inPhase = (d: GameState, ...phases: GameState["phase"][]) => need(phases.includes(d.phase), "You can't do that right now");

const HANDLERS: Handlers = {
  roll(d, me, _, random) {
    inPhase(d, "roll");
    const dice: [number, number] = [1 + pickIndex(random, 6), 1 + pickIndex(random, 6)];
    d.dice = dice;
    const total = dice[0] + dice[1];
    const doubles = dice[0] === dice[1];
    log(d, me, `rolled ${dice[0]} and ${dice[1]}${doubles ? " (doubles)" : ""}`);

    if (me.inJail) {
      d.rollAgain = false;
      if (doubles) {
        leaveJail(me);
        log(d, me, "rolled out of jail");
      } else if (++me.jailTurns < 3) {
        log(d, me, "stays in jail");
        return settle(d);
      } else {
        // Third try: pay the fine and go. If they can't cover it, they settle up first and stay put this turn.
        leaveJail(me);
        if (!pay(d, me, null, JAIL_FINE, "jail fine")) return;
      }
      return advance(d, me, total, random);
    }

    d.doubles = doubles ? d.doubles + 1 : 0;
    if (d.doubles === 3) {
      log(d, me, "rolled doubles three times and went to jail");
      sendToJail(d, me);
      return settle(d);
    }
    d.rollAgain = doubles;
    advance(d, me, total, random);
  },

  buy(d, me) {
    inPhase(d, "buy");
    const tile = BOARD[me.position]!;
    need(me.cash >= tile.price!, "Not enough cash. Mortgage something first, or decline");
    me.cash -= tile.price!;
    d.deeds[me.position]!.owner = me.id;
    log(d, me, `bought ${tile.name} for ${tile.price}`);
    settle(d);
  },

  decline(d, me) {
    inPhase(d, "buy");
    const active = inTurnOrder(d, d.current);
    if (!d.options.auctions || active.length < 2) {
      log(d, me, `passed on ${BOARD[me.position]!.name}`);
      return settle(d);
    }
    d.auction = { tile: me.position, highBid: 0, highBidder: null, active: active.map((p) => p.id), bidder: me.id };
    d.phase = "auction";
    log(d, me, `put ${BOARD[me.position]!.name} up for auction`);
  },

  bid(d, me, { amount }) {
    inPhase(d, "auction");
    const auction = d.auction!;
    need(Number.isInteger(amount) && amount > auction.highBid, `Bid more than ${auction.highBid}`);
    need(amount <= me.cash, "You can't bid more cash than you have");
    auction.highBid = amount;
    auction.highBidder = me.id;
    log(d, me, `bid ${amount}`);
    nextBidder(d);
  },

  pass(d, me) {
    inPhase(d, "auction");
    const auction = d.auction!;
    need(auction.highBidder !== me.id, "You're the top bidder");
    const at = auction.active.indexOf(me.id);
    auction.active.splice(at, 1);
    log(d, me, "passed");
    if (auction.active.length === 0 || (auction.active.length === 1 && auction.active[0] === auction.highBidder)) return closeAuction(d);
    auction.bidder = auction.active[at % auction.active.length]!;
  },

  build(d, me, { tile }) {
    inPhase(d, "roll", "end");
    const { deed, info, group } = ownedStreet(d, me, tile);
    need(group.every((i) => d.deeds[i]!.owner === me.id), `You need the whole ${info.group} set to build`);
    need(group.every((i) => !d.deeds[i]!.mortgaged), "Pay off the set's mortgages first");
    need(deed.houses < 5, "It already has a hotel");
    need(deed.houses === Math.min(...group.map((i) => d.deeds[i]!.houses)), "Build evenly: add to the emptier streets in the set first");
    need(me.cash >= info.houseCost!, "Not enough cash");
    if (deed.houses === 4) {
      need(d.bank.hotels > 0, "The bank is out of hotels");
      d.bank.hotels--;
      d.bank.houses += 4;
    } else {
      need(d.bank.houses > 0, "The bank is out of houses");
      d.bank.houses--;
    }
    deed.houses++;
    me.cash -= info.houseCost!;
    log(d, me, `built ${deed.houses === 5 ? "a hotel" : `house ${deed.houses}`} on ${info.name}`);
  },

  "sell-house"(d, me, { tile }) {
    inPhase(d, "roll", "end", "debt");
    const { deed, info, group } = ownedStreet(d, me, tile);
    need(deed.houses > 0, "Nothing to sell there");
    need(deed.houses === Math.max(...group.map((i) => d.deeds[i]!.houses)), "Sell evenly: take from the fuller streets in the set first");
    if (deed.houses === 5) {
      need(d.bank.houses >= 4, "The bank hasn't got four houses to swap for the hotel");
      d.bank.houses -= 4;
      d.bank.hotels++;
    } else {
      d.bank.houses++;
    }
    deed.houses--;
    me.cash += info.houseCost! / 2;
    log(d, me, `sold a building on ${info.name} for ${info.houseCost! / 2}`);
  },

  mortgage(d, me, { tile }) {
    inPhase(d, "roll", "buy", "end", "debt");
    const deed = d.deeds[tile];
    need(deed?.owner === me.id, "You don't own that");
    need(!deed!.mortgaged, "It's already mortgaged");
    const info = BOARD[tile]!;
    need(!info.group || groupOf(info.group).every((i) => d.deeds[i]!.houses === 0), "Sell the set's buildings first");
    deed!.mortgaged = true;
    me.cash += info.price! / 2;
    log(d, me, `mortgaged ${info.name} for ${info.price! / 2}`);
  },

  unmortgage(d, me, { tile }) {
    inPhase(d, "roll", "end");
    const deed = d.deeds[tile];
    need(deed?.owner === me.id && deed.mortgaged, "That isn't one of your mortgages");
    const cost = unmortgageCost(tile);
    need(me.cash >= cost, "Not enough cash");
    deed!.mortgaged = false;
    me.cash -= cost;
    log(d, me, `paid off the mortgage on ${BOARD[tile]!.name}`);
  },

  "pay-jail"(d, me) {
    inPhase(d, "roll");
    need(me.inJail, "You're not in jail");
    need(me.cash >= JAIL_FINE, "Not enough cash");
    me.cash -= JAIL_FINE;
    if (d.options.parkingJackpot) d.pot += JAIL_FINE;
    leaveJail(me);
    log(d, me, `paid ${JAIL_FINE} to leave jail`);
  },

  "use-jail-card"(d, me) {
    inPhase(d, "roll");
    need(me.inJail, "You're not in jail");
    need(me.jailCards > 0, "You haven't got a card");
    me.jailCards--;
    leaveJail(me);
    log(d, me, "used a get-out-of-jail-free card");
  },

  "pay-debt"(d, me) {
    inPhase(d, "debt");
    const debt = d.debts[0]!;
    need(me.cash >= debt.amount, `Raise ${debt.amount - me.cash} more first: sell buildings or mortgage`);
    me.cash -= debt.amount;
    receive(d, debt.creditor, debt.amount, debt.reason);
    d.debts.shift();
    log(d, me, `paid ${debt.amount} (${debt.reason})`);
    if (d.debts.length === 0) settle(d);
  },

  bankrupt(d, me) {
    inPhase(d, "debt");
    const creditor = d.debts[0]!.creditor;
    goBankrupt(d, me, creditor ? playerById(d, creditor) : null);
  },

  "end-turn"(d) {
    inPhase(d, "end");
    nextTurn(d);
  },

  offer(d, me, { to, give, get }) {
    inPhase(d, "roll", "end");
    need(!d.offered, "One offer per turn");
    const them = playerById(d, to);
    need(them.id !== me.id && !them.bankrupt, "Pick another player still in the game");
    for (const [side, owner] of [[give, me], [get, them]] as const) {
      need(Number.isInteger(side.cash) && side.cash >= 0 && side.cash <= owner.cash, `${owner.name} hasn't got that much cash`);
      need(new Set(side.tiles).size === side.tiles.length, "Each square once");
      for (const t of side.tiles) tradable(d, owner, t);
    }
    need(give.cash + get.cash + give.tiles.length + get.tiles.length > 0, "Offer something");
    d.trade = { from: me.id, to, give: { cash: give.cash, tiles: [...give.tiles] }, get: { cash: get.cash, tiles: [...get.tiles] } };
    d.offered = true;
    log(d, me, `offered ${them.name} a trade`);
  },

  accept(d, me) {
    const trade = d.trade!;
    need(trade, "There's no offer to answer");
    const from = playerById(d, trade.from);
    // Things may have changed hands since the offer; check again.
    need(from.cash >= trade.give.cash && me.cash >= trade.get.cash, "Someone can no longer afford it");
    trade.give.tiles.forEach((t) => tradable(d, from, t));
    trade.get.tiles.forEach((t) => tradable(d, me, t));
    from.cash += trade.get.cash - trade.give.cash;
    me.cash += trade.give.cash - trade.get.cash;
    trade.give.tiles.forEach((t) => (d.deeds[t]!.owner = me.id));
    trade.get.tiles.forEach((t) => (d.deeds[t]!.owner = from.id));
    d.trade = null;
    log(d, me, `accepted ${from.name}'s trade`);
  },

  reject(d, me) {
    need(d.trade, "There's no offer to answer");
    const from = playerById(d, d.trade!.from);
    d.trade = null;
    log(d, me, `turned down ${from.name}'s trade`);
  },
};

/** A square `owner` can trade away: theirs, and no buildings anywhere in its set. */
function tradable(d: GameState, owner: Player, tile: number) {
  need(d.deeds[tile]?.owner === owner.id, `${owner.name} doesn't own ${BOARD[tile]?.name ?? "that"}`);
  const group = BOARD[tile]!.group;
  need(!group || groupOf(group).every((i) => d.deeds[i]!.houses === 0), `Sell the buildings on the ${group} set first`);
}

/* ---------- Moving and landing ---------- */

function advance(d: GameState, me: Player, steps: number, random: () => number) {
  const target = (me.position + steps) % BOARD.length;
  moveTo(d, me, target, random, { passGo: me.position + steps >= BOARD.length });
}

function moveTo(d: GameState, me: Player, target: number, random: () => number, { passGo = target < me.position, double = false, tenTimes = false } = {}) {
  if (passGo) {
    me.cash += d.options.goSalary;
    log(d, me, `passed Go and collected ${d.options.goSalary}`);
  }
  me.position = target;
  land(d, me, random, { double, tenTimes });
}

function land(d: GameState, me: Player, random: () => number, cardRent: { double: boolean; tenTimes: boolean }) {
  const index = me.position;
  const tile = BOARD[index]!;
  const deed = d.deeds[index];
  switch (tile.kind) {
    case "street":
    case "station":
    case "utility": {
      if (!deed!.owner) {
        d.phase = "buy";
        return;
      }
      if (deed!.owner === me.id || deed!.mortgaged) return settle(d);
      const owner = playerById(d, deed!.owner);
      const rent = rentFor(d, index, (d.dice?.[0] ?? 0) + (d.dice?.[1] ?? 0), cardRent);
      if (pay(d, me, owner, rent, `rent on ${tile.name}`)) settle(d);
      return;
    }
    case "tax":
      if (pay(d, me, null, tile.tax!, tile.name.toLowerCase())) settle(d);
      return;
    case "chance":
    case "chest":
      return drawCard(d, me, tile.kind, random);
    case "go-to-jail":
      sendToJail(d, me);
      return settle(d);
    case "parking":
      if (d.options.parkingJackpot && d.pot > 0) {
        log(d, me, `scooped the Free Parking pot of ${d.pot}`);
        me.cash += d.pot;
        d.pot = 0;
      }
      return settle(d);
    default:
      return settle(d);
  }
}

function drawCard(d: GameState, me: Player, deck: CardDeck, random: () => number) {
  const order = d.decks[deck];
  const index = order.shift()!;
  const card = CARDS[deck][index]!;
  // Cards go back under the pile, except a jail card, which stays with you until it's used.
  if (card.effect.kind !== "jail-card") order.push(index);
  d.card = { deck, text: card.text };
  log(d, me, `drew: ${card.text}`);
  applyCard(d, me, card.effect, random);
}

function applyCard(d: GameState, me: Player, effect: CardEffect, random: () => number) {
  switch (effect.kind) {
    case "money":
      if (effect.amount >= 0) {
        me.cash += effect.amount;
        return settle(d);
      }
      if (pay(d, me, null, -effect.amount, "card")) settle(d);
      return;
    case "each": {
      const others = d.players.filter((p) => p.id !== me.id && !p.bankrupt);
      if (effect.amount < 0) {
        // Each payment that can't be covered waits in the debt queue.
        for (const other of others) pay(d, me, other, -effect.amount, "card", { queue: true });
      } else {
        for (const other of others) pay(d, other, me, effect.amount, "card", { queue: true });
      }
      if (d.debts.length > 0) d.phase = "debt";
      else settle(d);
      return;
    }
    case "move":
      return moveTo(d, me, effect.to, random);
    case "back":
      return moveTo(d, me, (me.position - effect.steps + BOARD.length) % BOARD.length, random, { passGo: false });
    case "nearest": {
      let target = me.position;
      do target = (target + 1) % BOARD.length;
      while (BOARD[target]!.kind !== effect.target);
      return moveTo(d, me, target, random, { double: effect.target === "station", tenTimes: effect.target === "utility" });
    }
    case "jail":
      sendToJail(d, me);
      return settle(d);
    case "jail-card":
      me.jailCards++;
      return settle(d);
    case "repairs": {
      const bill = d.deeds.reduce(
        (sum, deed) => (deed?.owner === me.id ? sum + (deed.houses === 5 ? effect.hotel : deed.houses * effect.house) : sum),
        0,
      );
      if (bill === 0 || pay(d, me, null, bill, "repairs")) settle(d);
      return;
    }
  }
}

function sendToJail(d: GameState, me: Player) {
  me.position = JAIL;
  me.inJail = true;
  me.jailTurns = 0;
  d.rollAgain = false;
  d.doubles = 0;
}

function leaveJail(me: Player) {
  me.inJail = false;
  me.jailTurns = 0;
}

/* ---------- Money ---------- */

/**
 * Pays now if `from` has the cash. Otherwise the payment waits as a debt and
 * the game moves to the debt phase (unless `queue`, where the caller decides).
 */
function pay(d: GameState, from: Player, to: Player | null, amount: number, reason: string, { queue = false } = {}): boolean {
  if (amount <= 0) return true;
  if (from.cash >= amount) {
    from.cash -= amount;
    receive(d, to?.id ?? null, amount, reason);
    log(d, from, `paid ${amount}${to ? ` to ${to.name}` : ""} (${reason})`);
    return true;
  }
  d.debts.push({ debtor: from.id, creditor: to?.id ?? null, amount, reason });
  log(d, from, `owes ${amount}${to ? ` to ${to.name}` : ""} (${reason}) and must raise cash`);
  if (!queue) d.phase = "debt";
  return false;
}

function receive(d: GameState, id: string | null, amount: number, reason: string) {
  if (id) playerById(d, id).cash += amount;
  else if (d.options.parkingJackpot && reason !== "card") d.pot += amount;
}

export const unmortgageCost = (tile: number) => Math.ceil((BOARD[tile]!.price! / 2) * 1.1);

/**
 * Out of the game. A player creditor takes the cash and deeds (mortgages and
 * all) plus half the buildings' value; if the bank is owed, the deeds go back
 * on sale. Their other debts are dropped.
 */
function goBankrupt(d: GameState, me: Player, creditor: Player | null) {
  const wasCurrent = d.players[d.current]!.id === me.id;
  let buildings = 0;
  d.deeds.forEach((deed, i) => {
    if (deed?.owner !== me.id) return;
    if (deed.houses === 5) d.bank.hotels++;
    else d.bank.houses += deed.houses;
    buildings += (deed.houses * (BOARD[i]!.houseCost ?? 0)) / 2;
    deed.houses = 0;
    if (creditor) deed.owner = creditor.id;
    else Object.assign(deed, { owner: null, mortgaged: false } satisfies Partial<Deed>);
  });
  if (creditor) creditor.cash += me.cash + buildings;
  d.log.push({ turn: d.turn, player: me.id, text: `went bankrupt${creditor ? `; ${creditor.name} takes everything` : ""}` });
  me.cash = 0;
  me.jailCards = 0;
  me.bankrupt = true;
  d.debts = d.debts.filter((debt) => debt.debtor !== me.id && debt.creditor !== me.id);

  const left = d.players.filter((p) => !p.bankrupt);
  if (left.length === 1) {
    d.phase = "finished";
    d.winner = left[0]!.id;
    d.log.push({ turn: d.turn, player: d.winner, text: "wins the game!" });
    return;
  }
  if (d.debts.length > 0) d.phase = "debt";
  else if (wasCurrent) nextTurn(d);
  else settle(d);
}

/* ---------- Turn flow ---------- */

/** The roll is dealt with: roll again after doubles, otherwise it's time to end the turn. */
function settle(d: GameState) {
  if (d.debts.length > 0) {
    d.phase = "debt";
    return;
  }
  const me = d.players[d.current]!;
  // The player whose turn it was went bankrupt while others were settling up: move on.
  if (me.bankrupt) return nextTurn(d);
  d.phase = d.rollAgain && !me.inJail ? "roll" : "end";
}

function nextTurn(d: GameState) {
  if (d.options.turnLimit !== null && d.turn >= d.options.turnLimit) return finishOnWorth(d);
  const order = inTurnOrder(d, d.current);
  const next = order.find((p) => p.id !== d.players[d.current]!.id) ?? order[0]!;
  d.current = d.players.indexOf(next);
  d.phase = "roll";
  d.dice = null;
  d.doubles = 0;
  d.rollAgain = false;
  d.card = null;
  d.offered = false;
  d.turn++;
}

/** Time's up: whoever is worth most wins. */
function finishOnWorth(d: GameState) {
  const left = d.players.filter((p) => !p.bankrupt);
  const richest = left.reduce((best, p) => (netWorth(d, p.id) > netWorth(d, best.id) ? p : best));
  d.phase = "finished";
  d.winner = richest.id;
  d.trade = null;
  d.log.push({ turn: d.turn, player: richest.id, text: `wins on net worth (${netWorth(d, richest.id)}) as time runs out` });
}

/** Players still in, starting from seat `from`. */
function inTurnOrder(d: GameState, from: number): Player[] {
  const n = d.players.length;
  return Array.from({ length: n }, (_, i) => d.players[(from + i) % n]!).filter((p) => !p.bankrupt);
}

function nextBidder(d: GameState) {
  const auction = d.auction!;
  if (auction.active.length === 1) return closeAuction(d);
  const at = auction.active.indexOf(auction.bidder);
  auction.bidder = auction.active[(at + 1) % auction.active.length]!;
}

function closeAuction(d: GameState) {
  const auction = d.auction!;
  const tile = BOARD[auction.tile]!;
  d.auction = null;
  if (auction.highBidder) {
    const winner = playerById(d, auction.highBidder);
    winner.cash -= auction.highBid;
    d.deeds[auction.tile]!.owner = winner.id;
    log(d, winner, `won ${tile.name} at auction for ${auction.highBid}`);
  } else {
    d.log.push({ turn: d.turn, player: null, text: `Nobody bid on ${tile.name}` });
  }
  settle(d);
}

function ownedStreet(d: GameState, me: Player, tile: number) {
  const info = BOARD[tile];
  const deed = d.deeds[tile];
  need(info?.kind === "street" && deed?.owner === me.id, "You don't own that street");
  return { deed: deed!, info: info!, group: groupOf(info!.group!) };
}

function log(d: GameState, me: Player, text: string) {
  d.log.push({ turn: d.turn, player: me.id, text });
}
