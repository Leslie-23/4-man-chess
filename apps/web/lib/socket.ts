"use client";

import { DEFAULT_SERVER_PORT, type ClientToServerEvents, type ServerToClientEvents } from "@fourman/shared";
import { io, type Socket } from "socket.io-client";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | undefined;

/**
 * One shared connection per tab. By default the game server is assumed to run on
 * the same host as this page, so a friend opening http://<your-ip>:3000 talks to
 * http://<your-ip>:4000. Override with NEXT_PUBLIC_SERVER_URL in production.
 */
function serverUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL;
  // Render hands out bare hostnames ("fourman-server.onrender.com"); assume HTTPS for those.
  if (configured) return /^https?:\/\//.test(configured) ? configured : `https://${configured}`;
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}

export function getSocket(): GameSocket {
  socket ??= io(serverUrl(), { autoConnect: false, transports: ["websocket"] });
  if (!socket.connected) socket.connect();
  return socket;
}

const NAME_KEY = "fourman:name";
const tokenKey = (roomId: string) => `fourman:token:${roomId.toUpperCase()}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the seat just won't survive a reload.
  }
}

export const loadName = () => read(NAME_KEY);
export const saveName = (name: string) => write(NAME_KEY, name);
export const loadToken = (roomId: string) => read(tokenKey(roomId));
export const saveToken = (roomId: string, token: string) => write(tokenKey(roomId), token);
