"use client";

import type { MoveInput, PlayerColor } from "@fourman/game-engine";
import type { AckResult, RoomView } from "@fourman/shared";
import { useCallback, useEffect, useState } from "react";
import { getSocket, loadToken, saveToken } from "./socket";

/**
 * Joins `roomId` and keeps `room` in sync with the server. Every change anyone
 * makes arrives as a `room:update`, including our own moves, so all devices
 * always draw exactly what the server holds.
 */
export function useRoom(roomId: string, name: string | null) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [color, setColor] = useState<PlayerColor | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    const socket = getSocket();
    const id = roomId.toUpperCase();

    // Runs on first connect and after every reconnect; the token puts us back in our seat.
    const join = async () => {
      setConnected(true);
      const result = await socket.emitWithAck("room:join", { roomId: id, name, token: loadToken(id) ?? undefined });
      if (!result.ok) return setError(result.error);
      if (result.token) saveToken(id, result.token);
      setColor(result.color);
      setError(null);
    };
    const onUpdate = (next: RoomView) => {
      if (next.id === id) setRoom(next);
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onUpdate);
    if (socket.connected) void join();
    return () => {
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onUpdate);
    };
  }, [roomId, name]);

  const send = useCallback(async (request: Promise<AckResult>) => {
    const result = await request;
    setError(result.ok ? null : result.error);
    return result.ok;
  }, []);

  const id = roomId.toUpperCase();
  return {
    room,
    color,
    connected,
    error,
    move: (move: MoveInput) => send(getSocket().emitWithAck("game:move", { roomId: id, move })),
    start: () => send(getSocket().emitWithAck("game:start", { roomId: id })),
    resign: () => send(getSocket().emitWithAck("game:resign", { roomId: id })),
    /** Chat replies go back to the caller, so the message box can show its own errors. */
    say: (text: string): Promise<AckResult> => getSocket().emitWithAck("chat:send", { roomId: id, text }),
  };
}
