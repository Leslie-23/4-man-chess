import { activePlayers, applyMove, createGame, getLegalMoves, isInCheck, renderAscii, resign } from "./game.js";
import type { NewGameOptions } from "./game.js";
import type { GameState, LegalMove, MoveInput, PlayerColor, Square } from "./types.js";

export * from "./types.js";
export { BOT_LEVELS, PIECE_VALUE, chooseBotMove, type BotLevel } from "./bot.js";
export { VARIANTS, VARIANT_IDS, getVariant, type BoardLayout, type Variant } from "./variants.js";
export {
  activePlayers,
  applyMove,
  createGame,
  createGameFromPosition,
  type NewGameOptions,
  getLegalMoves,
  isInCheck,
  playersOf,
  renderAscii,
  resign,
} from "./game.js";

/**
 * Convenience wrapper around the pure functions. `state` is a plain JSON-safe
 * object, so it can be stored (e.g. in Redis) and passed back in later.
 */
export class FourPlayerChess {
  state: GameState;

  constructor(stateOrOptions?: GameState | NewGameOptions) {
    this.state =
      stateOrOptions && "board" in stateOrOptions ? stateOrOptions : createGame(stateOrOptions as NewGameOptions);
  }

  move(input: MoveInput): this {
    this.state = applyMove(this.state, input);
    return this;
  }

  resign(player: PlayerColor, reason?: "resigned" | "timeout"): this {
    this.state = resign(this.state, player, reason);
    return this;
  }

  legalMoves(from?: Square): LegalMove[] {
    return getLegalMoves(this.state, from);
  }

  inCheck(color: PlayerColor = this.state.currentPlayer): boolean {
    return isInCheck(this.state, color);
  }

  activePlayers(): PlayerColor[] {
    return activePlayers(this.state);
  }

  toString(): string {
    return renderAscii(this.state);
  }
}
