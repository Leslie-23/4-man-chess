import type { ColorGroup, Tile } from "./types.js";

// Prices, rents and positions follow the classic 40-square layout; the names are our own.
const street = (name: string, group: ColorGroup, price: number, houseCost: number, rent: Tile["rent"]): Tile => ({
  name,
  kind: "street",
  group,
  price,
  houseCost,
  rent,
});
const station = (name: string): Tile => ({ name, kind: "station", price: 200 });
const utility = (name: string): Tile => ({ name, kind: "utility", price: 150 });

export const BOARD: readonly Tile[] = [
  { name: "Go", kind: "go" },
  street("Pebble Lane", "brown", 60, 50, [2, 10, 30, 90, 160, 250]),
  { name: "Community Chest", kind: "chest" },
  street("Cobble Row", "brown", 60, 50, [4, 20, 60, 180, 320, 450]),
  { name: "Income Tax", kind: "tax", tax: 200 },
  station("North Station"),
  street("Kite Street", "sky", 100, 50, [6, 30, 90, 270, 400, 550]),
  { name: "Chance", kind: "chance" },
  street("Breeze Avenue", "sky", 100, 50, [6, 30, 90, 270, 400, 550]),
  street("Cloud Terrace", "sky", 120, 50, [8, 40, 100, 300, 450, 600]),
  { name: "Jail", kind: "jail" },
  street("Flamingo Walk", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
  utility("Power Works"),
  street("Candy Court", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
  street("Rose Parade", "pink", 160, 100, [12, 60, 180, 500, 700, 900]),
  station("East Station"),
  street("Marmalade Mews", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
  { name: "Community Chest", kind: "chest" },
  street("Tangerine Drive", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
  street("Sunset Row", "orange", 200, 100, [16, 80, 220, 600, 800, 1000]),
  { name: "Free Parking", kind: "parking" },
  street("Ruby Road", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
  { name: "Chance", kind: "chance" },
  street("Chilli Crescent", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
  street("Poppy Square", "red", 240, 150, [20, 100, 300, 750, 925, 1100]),
  station("South Station"),
  street("Honey Hill", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
  street("Mustard Mile", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
  utility("Water Works"),
  street("Buttercup Boulevard", "yellow", 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { name: "Go to Jail", kind: "go-to-jail" },
  street("Fern Gardens", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
  street("Emerald Park", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { name: "Community Chest", kind: "chest" },
  street("Clover Heights", "green", 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  station("West Station"),
  { name: "Chance", kind: "chance" },
  street("Harbour View", "navy", 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { name: "Luxury Tax", kind: "tax", tax: 100 },
  street("Sapphire Point", "navy", 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

export const JAIL = 10;
export const JAIL_FINE = 50;
export const HOUSES_IN_BANK = 32;
export const HOTELS_IN_BANK = 12;

export const isBuyable = (index: number) => BOARD[index]!.price !== undefined;

/** Every square in a colour set, e.g. the three reds. */
export const groupOf = (group: ColorGroup) => BOARD.flatMap((t, i) => (t.group === group ? [i] : []));
