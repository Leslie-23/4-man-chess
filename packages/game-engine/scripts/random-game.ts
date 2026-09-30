// Plays a whole game with random legal moves: `pnpm demo [seed]`.
import { FourPlayerChess, type PieceType } from "../src/index.js";

const VALUE: Record<PieceType, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seed = Number(process.argv[2] ?? 1);
const random = mulberry32(seed);
const game = new FourPlayerChess();
const MAX_PLIES = 3000;

console.log(`${game}\n`);
while (game.state.status === "playing" && game.state.ply < MAX_PLIES) {
  const moves = game.legalMoves();
  // Greedy: usually grab the most valuable piece on offer, otherwise play randomly.
  const best = Math.max(0, ...moves.map((m) => (m.capture ? VALUE[m.capture] : 0)));
  const greedy = moves.filter((m) => m.capture && VALUE[m.capture] === best);
  const pool = greedy.length && random() < 0.9 ? greedy : moves;
  const move = pool[Math.floor(random() * pool.length)]!;
  game.move(move);
}

console.log(game.toString());
console.log(`\nseed ${seed}: ${game.state.ply} plies, status ${game.state.status}, ${game.state.winner ? `winner ${game.state.winner}` : `draw (${game.state.drawReason})`}`);
for (const e of game.state.eliminations) {
  console.log(`  ply ${e.ply}: ${e.player} out (${e.reason}${e.by ? ` by ${e.by}` : ""})`);
}
