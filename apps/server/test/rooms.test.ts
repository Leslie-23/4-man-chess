import { chooseBotMove } from "@fourman/game-engine";
import { describe, expect, it } from "vitest";
import { RoomManager } from "../src/rooms.js";

describe("move clock", () => {
  it("plays a move for a player who runs out of time, and puts them out after three in a row", () => {
    const rooms = new RoomManager(() => {}, () => 0.5);
    const { room, color } = rooms.create("Ada", "two", ["hard"]);
    rooms.startPoll(room.id, color);
    rooms.vote(room.id, color, 15);
    expect(room.moveSeconds).toBe(15);

    for (let turn = 0; turn < 3; turn++) {
      expect(room.state.currentPlayer).toBe("white");
      expect(rooms.timeOut(room, room.state.ply, room.turnDeadline! - 1)).toBe(false);
      expect(rooms.timeOut(room, room.state.ply, room.turnDeadline! + 1)).toBe(true);
      if (room.phase !== "playing") break;
      // The bot isn't timed, and answers straight away.
      expect(room.turnDeadline).toBeNull();
      rooms.move(room.id, "black", chooseBotMove(room.state, () => 0.5, "hard")!);
    }
    expect(room.phase).toBe("finished");
    expect(room.state.eliminations).toMatchObject([{ player: "white", reason: "timeout" }]);
    const notices = room.chat.filter((m) => m.system).map((m) => m.text);
    expect(notices.filter((t) => t.startsWith("Ada ran out of time, so a move was played"))).toHaveLength(2);
    expect(notices.at(-1)).toBe("Ada ran out of time 3 turns in a row and is out.");
  });

  it("forgets earlier timeouts once the player moves by themselves", () => {
    const rooms = new RoomManager(() => {}, () => 0.5);
    const { room, color } = rooms.create("Ada", "two", ["hard"]);
    rooms.startPoll(room.id, color);
    rooms.vote(room.id, color, 30);
    rooms.timeOut(room, room.state.ply, room.turnDeadline! + 1);
    rooms.move(room.id, "black", chooseBotMove(room.state, () => 0.5, "hard")!);
    rooms.move(room.id, "white", chooseBotMove(room.state, () => 0.5, "hard")!);
    expect(room.timeouts.white).toBe(0);
  });
});
