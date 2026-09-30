// Fills free seats in a room with bots that play their own turns:
//   pnpm bots <ROOM> [count=3] [--level=easy|hard|advanced] [--delay=900]
// Bots connect over Socket.IO exactly like a friend's browser would.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOT_LEVELS, chooseBotMove, type BotLevel, type PlayerColor } from "@fourman/game-engine";
import { DEFAULT_SERVER_PORT, type ClientToServerEvents, type RoomView, type ServerToClientEvents } from "@fourman/shared";
import { io, type Socket } from "socket.io-client";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const roomId = args[0]?.toUpperCase();
const count = Math.min(3, Math.max(1, Number(args[1] ?? 3)));
const delayMs = Number(flag("delay") ?? 900);
const level = (flag("level") ?? "hard") as BotLevel;
const serverUrl = process.env.SERVER_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`;

if (!roomId || !BOT_LEVELS.includes(level)) {
  console.error("Usage: pnpm bots <ROOM> [count=3] [--level=easy|hard|advanced] [--delay=900]");
  process.exit(1);
}

// Tokens are kept so that re-running the command puts the same bots back in their seats.
const tokenDir = join(tmpdir(), "fourman-bots");
const tokenFile = join(tokenDir, `${roomId}.json`);
const tokens: string[] = (() => {
  try {
    return JSON.parse(readFileSync(tokenFile, "utf8")) as string[];
  } catch {
    return [];
  }
})();
const saveTokens = () => {
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(tokenFile, JSON.stringify(tokens));
};

const describe = (room: RoomView, c: PlayerColor) => room.seats[c]?.name ?? c;

async function runBot(slot: number): Promise<void> {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, { transports: ["websocket"] });
  let color: PlayerColor | null = null;
  let thinkingAtPly = -1;

  const join = async () => {
    const result = await socket.emitWithAck("room:join", { roomId: roomId!, name: `${level[0]!.toUpperCase()}${level.slice(1)} Bot ${slot + 1}`, token: tokens[slot] });
    if (!result.ok) {
      console.error(`Bot ${slot + 1}: ${result.error}`);
      process.exit(1);
    }
    if (!result.color) {
      console.log(`Bot ${slot + 1}: no free seat (room full or game already started), leaving.`);
      socket.disconnect();
      return;
    }
    color = result.color;
    tokens[slot] = result.token!;
    saveTokens();
    console.log(`Bot ${slot + 1} is playing ${color}`);
  };

  socket.on("connect", join);
  socket.on("connect_error", (error) => console.error(`Can't reach ${serverUrl}: ${error.message}`));

  socket.on("room:update", (room) => {
    const { state } = room;
    if (room.phase === "finished" && color) {
      console.log(`Bot ${slot + 1}: game over, ${state.winner ? `${describe(room, state.winner)} wins` : "draw"}`);
      socket.disconnect();
      return;
    }
    if (room.phase !== "playing" || state.currentPlayer !== color || thinkingAtPly === state.ply) return;
    thinkingAtPly = state.ply;
    setTimeout(async () => {
      const move = chooseBotMove(state, Math.random, level);
      if (!move) return;
      const result = await socket.emitWithAck("game:move", { roomId: roomId!, move });
      if (result.ok) console.log(`  ${color} ${move.from} → ${move.to}`);
      else console.error(`  ${color} move rejected: ${result.error}`);
    }, delayMs);
  });
}

// Join one at a time so seats fill in order.
for (let slot = 0; slot < count; slot++) {
  await runBot(slot);
  await new Promise((r) => setTimeout(r, 300));
}
