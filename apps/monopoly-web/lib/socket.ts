"use client";

import { DEFAULT_SERVER_PORT, MONOPOLY_NAMESPACE, isMonopolyAnimal, type MonopolyAnimal, type MonopolyClientEvents, type MonopolyServerEvents } from "@fourman/shared";
import { io, type Socket } from "socket.io-client";

export type MonopolySocket = Socket<MonopolyServerEvents, MonopolyClientEvents>;

let socket: MonopolySocket | undefined;

/** The shared game server (the one chess uses), on its Monopoly namespace. */
function serverUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL;
  const base = configured
    ? /^https?:\/\//.test(configured)
      ? configured
      : `https://${configured}`
    : `${window.location.protocol}//${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
  return `${base.replace(/\/$/, "")}${MONOPOLY_NAMESPACE}`;
}

export function getSocket(): MonopolySocket {
  socket ??= io(serverUrl(), { autoConnect: false, transports: ["websocket"] });
  if (!socket.connected) socket.connect();
  return socket;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the seat just won't survive a reload.
  }
}

// The name is shared with chess on purpose, if both run on one domain; seat tokens are per game.
export const loadName = () => read("fourman:name");
export const saveName = (name: string) => write("fourman:name", name);
export const loadToken = (roomId: string) => read(`monopoly:token:${roomId.toUpperCase()}`);
export const saveToken = (roomId: string, token: string) => write(`monopoly:token:${roomId.toUpperCase()}`, token);
/** The animal this player likes to play as; asked for whenever they join a room. */
export const loadAnimal = (): MonopolyAnimal | null => {
  const stored = read("tycoon:animal");
  return isMonopolyAnimal(stored) ? stored : null;
};
export const saveAnimal = (animal: MonopolyAnimal) => write("tycoon:animal", animal);
