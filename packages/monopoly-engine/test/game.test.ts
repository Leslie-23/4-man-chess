import { describe, expect, it } from "vitest";
import { BOARD, IllegalActionError, applyAction, chooseBotAction, createGame, currentActor, netWorth, rentFor, type Action, type GameState } from "../src/index.js";

const seeded = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
/** A "random" source that rolls exactly these dice, in order. */
const rolls = (...faces: number[]) => {
  const queue = [...faces];
  return () => ((queue.shift() ?? 1) - 1) / 6 + 0.01;
};
const ADA = "ada";
const BO = "bo";
const newGame = (options = {}) => createGame([{ id: ADA, name: "Ada" }, { id: BO, name: "Bo" }], seeded(1), options);
const act = (state: GameState, id: string, action: Action, random: () => number = seeded(2)) => applyAction(state, id, action, random);
const own = (state: GameState, id: string, ...tiles: number[]) => tiles.forEach((t) => (state.deeds[t]!.owner = id));

describe("moving", () => {
  it("pays the Go salary on the way past and offers the square for sale", () => {
    const state = newGame();
    state.players[0]!.position = 36;
    const next = act(state, ADA, { type: "roll" }, rolls(2, 3));
    expect(next.players[0]).toMatchObject({ position: 1, cash: 1700 });
    expect(next.phase).toBe("buy");
  });

  it("gives another roll after doubles, and jail after three", () => {
    let state = act(newGame(), ADA, { type: "roll" }, rolls(3, 3)); // Kite Street
    expect(state.phase).toBe("buy");
    state = act(state, ADA, { type: "buy" });
    expect(state.phase).toBe("roll");
    expect(currentActor(state)).toBe(ADA);
    const fresh = newGame();
    fresh.doubles = 2;
    const jailed = act(fresh, ADA, { type: "roll" }, rolls(3, 3));
    expect(jailed.players[0]).toMatchObject({ position: 10, inJail: true });
    expect(jailed.phase).toBe("end");
  });

  it("lets you out of jail on doubles, or for the fine", () => {
    const state = newGame();
    Object.assign(state.players[0]!, { position: 10, inJail: true });
    const out = act(state, ADA, { type: "roll" }, rolls(2, 2));
    expect(out.players[0]).toMatchObject({ inJail: false, position: 14 });
    expect(out.rollAgain).toBe(false);
    const paid = act(state, ADA, { type: "pay-jail" });
    expect(paid.players[0]).toMatchObject({ inJail: false, cash: 1450 });
  });
});

describe("buying and rent", () => {
  it("buys, then charges rent that doubles for a full set and grows with houses", () => {
    const state = newGame();
    own(state, BO, 1, 3);
    expect(rentFor(state, 1, 7)).toBe(4);
    state.deeds[1]!.houses = 2;
    expect(rentFor(state, 1, 7)).toBe(30);
    own(state, BO, 5, 15);
    expect(rentFor(state, 5, 7)).toBe(50);
    expect(rentFor(state, 5, 7, { double: true })).toBe(100);
    own(state, BO, 12);
    expect(rentFor(state, 12, 7)).toBe(28);
  });

  it("moves the rent from the lander to the owner", () => {
    const state = newGame();
    own(state, BO, 6);
    const next = act(state, ADA, { type: "roll" }, rolls(2, 4));
    expect(next.players.map((p) => p.cash)).toEqual([1494, 1506]);
    expect(next.phase).toBe("end");
  });

  it("auctions a declined square to the highest bidder", () => {
    let state = newGame();
    state = act(state, ADA, { type: "roll" }, rolls(2, 4)); // Kite Street
    state = act(state, ADA, { type: "decline" });
    expect(state.phase).toBe("auction");
    state = act(state, ADA, { type: "bid", amount: 40 });
    state = act(state, BO, { type: "bid", amount: 60 });
    expect(() => act(state, ADA, { type: "bid", amount: 60 })).toThrow(IllegalActionError);
    state = act(state, ADA, { type: "pass" });
    expect(state.deeds[6]!.owner).toBe(BO);
    expect(state.players[1]!.cash).toBe(1440);
    expect(state.phase).toBe("end");
  });
});

describe("building", () => {
  it("needs the whole set and builds evenly, then pays hotel rent", () => {
    let state = newGame();
    own(state, ADA, 1);
    expect(() => act(state, ADA, { type: "build", tile: 1 })).toThrow(/whole brown set/);
    own(state, ADA, 3);
    state = act(state, ADA, { type: "build", tile: 1 });
    expect(() => act(state, ADA, { type: "build", tile: 1 })).toThrow(/evenly/);
    for (let i = 0; i < 9; i++) state = act(state, ADA, { type: "build", tile: i % 2 === 0 ? 3 : 1 });
    expect(state.deeds[1]!.houses).toBe(5);
    expect(state.deeds[3]!.houses).toBe(5);
    expect(state.bank).toEqual({ houses: 32, hotels: 10 });
    expect(rentFor(state, 3, 7)).toBe(450);
    expect(state.players[0]!.cash).toBe(1000);
  });
});

describe("debt and bankruptcy", () => {
  it("waits while a player raises cash, and hands everything to the creditor if they can't", () => {
    let state = newGame();
    own(state, BO, 39);
    state.deeds[39]!.houses = 5;
    own(state, BO, 37);
    own(state, ADA, 5);
    Object.assign(state.players[0]!, { position: 33, cash: 100 });
    state = act(state, ADA, { type: "roll" }, rolls(3, 3)); // Sapphire Point with a hotel: 2000
    expect(state.phase).toBe("debt");
    expect(currentActor(state)).toBe(ADA);
    expect(() => act(state, ADA, { type: "pay-debt" })).toThrow(/Raise/);
    state = act(state, ADA, { type: "mortgage", tile: 5 });
    expect(state.players[0]!.cash).toBe(200);
    state = act(state, ADA, { type: "bankrupt" });
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe(BO);
    expect(state.deeds[5]).toEqual({ owner: BO, houses: 0, mortgaged: true });
    expect(state.players[1]!.cash).toBe(1700);
  });

  it("only lets the player who must act, act", () => {
    expect(() => act(newGame(), BO, { type: "roll" })).toThrow("It's not your move");
  });

  it("counts net worth from cash, deeds and buildings", () => {
    const state = newGame();
    own(state, ADA, 1, 3);
    state.deeds[1]!.houses = 2;
    state.deeds[3]!.mortgaged = true;
    expect(netWorth(state, ADA)).toBe(1500 + 60 + 100 + 30);
  });
});

describe("bots", () => {
  it.each([1, 2, 3])("play only legal actions through whole games (seed %i)", (seed) => {
    const random = seeded(seed);
    let state = createGame(
      ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() })),
      random,
    );
    let steps = 0;
    while (state.phase !== "finished" && steps < 30_000) {
      const actor = currentActor(state)!;
      // Two hard bots and two easy ones at the table.
      const action = chooseBotAction(state, actor, random, actor < "c" ? "hard" : "easy")!;
      state = applyAction(state, actor, action, random);
      for (const p of state.players) expect(p.cash).toBeGreaterThanOrEqual(0);
      steps++;
    }
    expect(state.phase).toBe("finished");
    expect(state.players.filter((p) => !p.bankrupt)).toHaveLength(1);
    expect(state.deeds.every((d, i) => !d || BOARD[i]!.price)).toBe(true);
  });
});

describe("trading", () => {
  it("swaps cash and squares when the other player accepts, and blocks play until they answer", () => {
    let state = newGame();
    own(state, ADA, 1);
    own(state, BO, 3);
    state = act(state, ADA, { type: "offer", to: BO, give: { cash: 100, tiles: [1] }, get: { cash: 0, tiles: [3] } });
    expect(currentActor(state)).toBe(BO);
    expect(() => act(state, BO, { type: "roll" })).toThrow(/Answer the trade/);
    const done = act(state, BO, { type: "accept" });
    expect(done.deeds[1]!.owner).toBe(BO);
    expect(done.deeds[3]!.owner).toBe(ADA);
    expect(done.players.map((p) => p.cash)).toEqual([1400, 1600]);
    expect(currentActor(done)).toBe(ADA);
    expect(() => act(done, ADA, { type: "offer", to: BO, give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } })).toThrow(/One offer/);
    const turnedDown = act(state, BO, { type: "reject" });
    expect(turnedDown.deeds[1]!.owner).toBe(ADA);
  });

  it("won't trade squares from a set with buildings, or cash nobody has", () => {
    const state = newGame();
    own(state, ADA, 1, 3);
    state.deeds[1]!.houses = 1;
    expect(() => act(state, ADA, { type: "offer", to: BO, give: { cash: 0, tiles: [3] }, get: { cash: 50, tiles: [] } })).toThrow(/buildings/);
    expect(() => act(state, ADA, { type: "offer", to: BO, give: { cash: 0, tiles: [] }, get: { cash: 5000, tiles: [] } })).toThrow(/cash/);
  });

  it("ends a timed game with the richest player winning", () => {
    let state = newGame({ turnLimit: 1 });
    own(state, BO, 39);
    state = act(state, ADA, { type: "roll" }, rolls(1, 2));
    if (state.phase === "buy") state = act(state, ADA, { type: "decline" });
    while (state.phase === "auction") state = act(state, currentActor(state)!, { type: "pass" });
    state = act(state, ADA, { type: "end-turn" });
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe(BO);
  });
});
