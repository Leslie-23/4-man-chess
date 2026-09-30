# 4-Man Chess

Chess for 2, 3 or 4 players: classic 8×8, a three-player hexagon, and a four-player cross.
Every seat is a friend (joining with a room code) or a bot (Easy, Hard or Advanced).
pnpm + Turborepo monorepo; the rules live in a pure TypeScript engine shared by the web client and game server.

```
packages/game-engine   @fourman/game-engine: rules, no runtime dependencies
packages/shared        @fourman/shared: typed Socket.IO events shared by server and web
apps/server            Fastify + Socket.IO game server (authoritative, in-memory rooms)
apps/web               Next.js client: lobby, board, live updates
```

## Play with friends

```sh
pnpm install
pnpm dev        # game server on :4000, web app on :3000, both on 0.0.0.0
```

Open `http://<your-computer's-LAN-IP>:3000` (Next prints it as "Network"). Pick a board (2, 3 or 4 players)
and set each other seat to **Friend** or a bot level. With only bots the game starts at once; otherwise you get a
room code to send, and the game starts as soon as every friend seat is filled. The host can also **Start now**,
and open seats sit out. Anyone joining a full or running game watches. A reload or dropped connection puts you back in your seat.

### Bots, auto mode and themes

- **Bots in a room:** the host adds them from the lobby, either on an empty seat's name card or with
  **Fill with bots**. The opening page's **Play vs 3 bots** does it in one click. The server plays bot seats itself.
- **Three levels** (`chooseBotMove(state, random, level)` in the engine):

  | Level | How it plays | Tournament result |
  |---|---|---|
  | Easy | Mostly random; notices captures only half the time | — |
  | Hard | One-move lookahead; won't drop the piece it moves | vs 3 easy: never knocked out in 40 games |
  | Advanced | Guards its whole army, makes threats, checks the next player's best capture, pushes pawns and attacks kings | vs 3 hard: won 25/40 (even would be 10) |

- **Auto mode** (room page) lets a bot of your chosen level play *your* moves so you can watch.
- `pnpm bots <ROOM> [count=3] [--level=easy|hard|advanced]` adds bots from the terminal instead. They join over Socket.IO like any other device.
- **Board themes** (Classic, Mono, Tournament, Slate, Paper, Midnight) are saved in each browser's localStorage,
  so every player can use a different one. Bot difficulty and auto-mode level are remembered the same way.

### How sync works

```
device ── game:move {from,to} ──▶ server: is it this seat's turn? is it legal? (engine)
                                     │ apply
every device in the room ◀── room:update (full room state) ──┘
```

The server holds the only real game. Clients never apply their own moves; they redraw from
`room:update`, so every screen always matches. The browser runs the same engine only to highlight legal moves.
For hosting beyond your LAN, deploy `apps/server` and build the web app with `NEXT_PUBLIC_SERVER_URL`
pointing at it; set `CORS_ORIGIN` on the server to the web app's origin.

## Data and deployment

- **MongoDB** (optional): set `MONGODB_URI` for the game server and every room is saved to the `rooms`
  collection after each change. Unfinished games from the last 24 hours are resumed on startup, and
  rooms are deleted automatically 30 days after their last activity. Without it, rooms live in memory only.
  Locally, put it in `apps/server/.env` (git-ignored) and run `node --env-file=.env dist/index.js`.
- **Render**: two web services from this repo.

  | Service | Build command | Start command | Env |
  |---|---|---|---|
  | game server | `corepack enable && pnpm install --frozen-lockfile && pnpm turbo run build --filter=@fourman/server...` | `node apps/server/dist/index.js` | `MONGODB_URI`, health check `/health` |
  | website | `corepack enable && pnpm install --frozen-lockfile && pnpm turbo run build --filter=@fourman/web...` | `cd apps/web && ./node_modules/.bin/next start -H 0.0.0.0 -p $PORT` | `NEXT_PUBLIC_SERVER_URL` = the server's URL |

  MongoDB Atlas must allow connections from Render. The free plan has no fixed outbound IPs, so allow `0.0.0.0/0`.

## Commands

```sh
pnpm test                                   # all packages, via turbo
pnpm build
pnpm --filter @fourman/game-engine demo 3   # play a seeded bot game in the terminal
```

## Engine usage

```ts
import { createGame, applyMove, getLegalMoves } from "@fourman/game-engine";

let state = createGame({ variant: "four" });       // "two" | "three" | "four"; plain JSON, safe to store in Redis
state = applyMove(state, { from: "e2", to: "e4" }); // throws IllegalMoveError if illegal
getLegalMoves(state, "b5");                         // blue's moves from b5
```

`applyMove(state, move) → newState` is deterministic and never mutates its input
(no clocks, randomness or I/O inside the engine). A `FourPlayerChess` class wraps the same functions.

## Boards

| | 2 players | 3 players | 4 players |
|---|---|---|---|
| Board | 8×8 (64) | hexagon, 3 halves of 8×4 (96) | 14×14 cross (160) |
| Colours, turn order | White, Black | White → Red → Black | Red → Blue → Yellow → Green |
| Pawns promote | far rank | back rank of whichever rival half they reach | centre line (`promotionRank`, default 8) |
| No legal move, not in check | draw (stalemate) | out | out |
| 50-move rule | 100 plies | 150 plies | 200 plies |

Common to all: standard piece moves, castling, en passant, and the draw when only kings are left.
In the 3- and 4-player games, checkmate or stalemate is checked when your turn arrives and knocks you out.
Another player's move can leave your king capturable; if the next player takes it, you're out. Last king standing wins.

**3-player geometry.** Each half is two 4×4 quadrants. Going past the centre line takes you into a neighbour's
half, running back toward their back rank: files a–d lead to the half on your left, e–h to the half on your right.
A diagonal through the exact centre point carries on into both other halves.

**How the engine handles shapes.** Each board is described by a few local rules in `packages/game-engine/src/variants.ts`:
where a one-square step leads, and where pawns go. From those it pre-computes every rook and bishop line,
knight jump and pawn move. Move generation, check detection and the bots only read those tables, so they
work unchanged on any board. The tests check that every board is symmetric: each line can be walked back to where it started.
