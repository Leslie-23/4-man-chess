"use client";

import type { Action } from "@fourman/monopoly-engine";
import type { AckResult, CoachTurn, MonopolyRoomView } from "@fourman/shared";
import { useCallback, useEffect, useState } from "react";
import { getSocket, loadToken, saveToken } from "./socket";

/** Joins `roomId` and mirrors the server's copy of it; every change arrives as a room:update. */
export function useRoom(roomId: string, name: string | null) {
  const [room, setRoom] = useState<MonopolyRoomView | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = roomId.toUpperCase();

  useEffect(() => {
    if (!name) return;
    const socket = getSocket();
    const join = async () => {
      setConnected(true);
      const result = await socket.emitWithAck("room:join", { roomId: id, name, token: loadToken(id) ?? undefined });
      if (!result.ok) return setError(result.error);
      if (result.token) saveToken(id, result.token);
      setSeat(result.seat);
      setError(null);
    };
    const onUpdate = (next: MonopolyRoomView) => next.id === id && setRoom(next);
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
  }, [id, name]);

  const send = useCallback(async (request: Promise<AckResult>) => {
    const result = await request;
    setError(result.ok ? null : result.error);
    return result.ok;
  }, []);

  return {
    room,
    seat,
    /** This device's engine player id, or null when watching. */
    me: seat === null ? null : `p${seat}`,
    connected,
    error,
    act: (action: Action) => send(getSocket().emitWithAck("game:act", { roomId: id, action })),
    start: () => send(getSocket().emitWithAck("game:start", { roomId: id })),
    say: (text: string): Promise<AckResult> => getSocket().emitWithAck("chat:send", { roomId: id, text }),
    askCoach: (question: string, history: CoachTurn[]) =>
      getSocket()
        .timeout(25_000)
        .emitWithAck("coach:ask", { roomId: id, question, history })
        .catch((): AckResult<{ answer: string }> => ({ ok: false, error: "The coach didn't answer in time" })),
  };
}
