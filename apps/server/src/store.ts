import type { RecentGame } from "@fourman/shared";
import { MongoClient, type Collection } from "mongodb";
import type { Room } from "./rooms.js";

/**
 * Where rooms are kept between restarts. The server always works from its
 * in-memory copy; the store is written behind it after every change and read
 * once at startup.
 */
export interface RoomStore {
  /** Unfinished rooms touched within `maxAgeMs`, ready to resume. */
  loadActive(maxAgeMs: number): Promise<Room[]>;
  save(room: Room): void;
  /** Every finished game, for the leaderboard. */
  loadResults(): Promise<RecentGame[]>;
  saveResult(game: RecentGame): void;
  close(): Promise<void>;
}

/** No persistence: rooms live only as long as the process (local dev and tests). */
export class MemoryStore implements RoomStore {
  async loadActive(): Promise<Room[]> {
    return [];
  }
  save(): void {}
  async loadResults(): Promise<RecentGame[]> {
    return [];
  }
  saveResult(): void {}
  async close(): Promise<void> {}
}

type RoomDocument = Omit<Room, "id" | "lastActivity"> & { _id: string; lastActivity: Date; expiresAt: Date };
/** Results are kept for good: the all-time leaderboard needs them. */
type ResultDocument = Omit<RecentGame, "id" | "finishedAt"> & { _id: string; finishedAt: Date };

/** Finished and abandoned rooms are removed by MongoDB itself after this long. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export class MongoStore implements RoomStore {
  /** Rooms with a write in flight, and rooms changed again while it was. */
  private writing = new Map<string, Promise<void>>();
  private dirty = new Set<string>();
  private pendingResults = new Set<Promise<void>>();

  private constructor(
    private client: MongoClient,
    private rooms: Collection<RoomDocument>,
    private results: Collection<ResultDocument>,
  ) {}

  static async connect(uri: string, dbName = "fourman"): Promise<MongoStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    const rooms = client.db(dbName).collection<RoomDocument>("rooms");
    await rooms.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await rooms.createIndex({ phase: 1, lastActivity: -1 });
    const results = client.db(dbName).collection<ResultDocument>("results");
    await results.createIndex({ finishedAt: -1 });
    return new MongoStore(client, rooms, results);
  }

  async loadActive(maxAgeMs: number): Promise<Room[]> {
    const docs = await this.rooms
      .find({ phase: { $ne: "finished" }, lastActivity: { $gt: new Date(Date.now() - maxAgeMs) } })
      .toArray();
    return docs.map(({ _id, lastActivity, expiresAt: _expires, seats, ...rest }) => ({
      ...rest,
      id: _id,
      lastActivity: lastActivity.getTime(),
      // Nobody is connected to a room the server has only just loaded.
      seats: Object.fromEntries(Object.entries(seats).map(([c, s]) => [c, s && { ...s, connections: 0 }])),
    }));
  }

  /**
   * Writes the room's latest state. Writes for one room never overlap or land
   * out of order: a change made mid-write is picked up by one more write.
   */
  save(room: Room): void {
    if (this.writing.has(room.id)) {
      this.dirty.add(room.id);
      return;
    }
    const run = async () => {
      do {
        this.dirty.delete(room.id);
        const { id, lastActivity, ...rest } = room;
        const doc: RoomDocument = {
          ...structuredClone(rest),
          _id: id,
          lastActivity: new Date(lastActivity),
          expiresAt: new Date(lastActivity + KEEP_MS),
        };
        try {
          await this.rooms.replaceOne({ _id: id }, doc, { upsert: true });
        } catch (error) {
          // The in-memory game carries on; the next change retries the write.
          console.error(`Saving room ${id} to MongoDB failed:`, error);
        }
      } while (this.dirty.has(room.id));
      this.writing.delete(room.id);
    };
    this.writing.set(room.id, run());
  }

  async loadResults(): Promise<RecentGame[]> {
    const docs = await this.results.find().toArray();
    return docs.map(({ _id, finishedAt, ...rest }) => ({ ...rest, id: _id, finishedAt: finishedAt.getTime() }));
  }

  saveResult(game: RecentGame): void {
    const { id, finishedAt, ...rest } = game;
    const write = this.results
      .replaceOne({ _id: id }, { ...rest, finishedAt: new Date(finishedAt) }, { upsert: true })
      .then(
        () => {},
        (error: unknown) => console.error(`Saving the result of room ${id} to MongoDB failed:`, error),
      )
      .finally(() => this.pendingResults.delete(write));
    this.pendingResults.add(write);
  }

  async close(): Promise<void> {
    await Promise.all(this.pendingResults);
    while (this.writing.size) await Promise.all(this.writing.values());
    await this.client.close();
  }
}
