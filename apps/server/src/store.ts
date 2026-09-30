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
  close(): Promise<void>;
}

/** No persistence: rooms live only as long as the process (local dev and tests). */
export class MemoryStore implements RoomStore {
  async loadActive(): Promise<Room[]> {
    return [];
  }
  save(): void {}
  async close(): Promise<void> {}
}

type RoomDocument = Omit<Room, "id" | "lastActivity"> & { _id: string; lastActivity: Date; expiresAt: Date };

/** Finished and abandoned rooms are removed by MongoDB itself after this long. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export class MongoStore implements RoomStore {
  /** Rooms with a write in flight, and rooms changed again while it was. */
  private writing = new Map<string, Promise<void>>();
  private dirty = new Set<string>();

  private constructor(
    private client: MongoClient,
    private rooms: Collection<RoomDocument>,
  ) {}

  static async connect(uri: string, dbName = "fourman"): Promise<MongoStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    const rooms = client.db(dbName).collection<RoomDocument>("rooms");
    await rooms.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await rooms.createIndex({ phase: 1, lastActivity: -1 });
    return new MongoStore(client, rooms);
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

  async close(): Promise<void> {
    while (this.writing.size) await Promise.all(this.writing.values());
    await this.client.close();
  }
}
