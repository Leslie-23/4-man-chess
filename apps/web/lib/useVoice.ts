"use client";

import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

export interface VoiceState {
  status: "off" | "joining" | "on";
  error: string | null;
  /** We hold a seat, so we may talk; spectators only listen. */
  canTalk: boolean;
  muted: boolean;
  /** Seat colours of everyone in the voice channel, and of whoever is talking right now. */
  present: ReadonlySet<string>;
  speaking: ReadonlySet<string>;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => Promise<void>;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The room's voice channel, like people talking around one table. Joining
 * needs a tap: browsers only allow sound and the microphone after one.
 */
export function useVoice(roomId: string): VoiceState {
  const [status, setStatus] = useState<VoiceState["status"]>("off");
  const [error, setError] = useState<string | null>(null);
  const [canTalk, setCanTalk] = useState(false);
  const [muted, setMuted] = useState(false);
  const [present, setPresent] = useState(EMPTY);
  const [speaking, setSpeaking] = useState(EMPTY);
  const room = useRef<Room | null>(null);
  // Remote voices play through audio elements kept out of sight.
  const speakers = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    const r = room.current;
    if (!r) return setPresent(EMPTY);
    setPresent(new Set([r.localParticipant.identity, ...r.remoteParticipants.keys()]));
  }, []);

  const leave = useCallback(() => {
    room.current?.disconnect();
    room.current = null;
    speakers.current?.remove();
    speakers.current = null;
    setStatus("off");
    setPresent(EMPTY);
    setSpeaking(EMPTY);
  }, []);

  useEffect(() => leave, [leave, roomId]);

  const join = useCallback(async () => {
    if (room.current) return;
    setStatus("joining");
    setError(null);
    const pass = await getSocket().timeout(10_000).emitWithAck("voice:token", { roomId: roomId.toUpperCase() }).catch(() => null);
    if (!pass?.ok) {
      setStatus("off");
      return setError(pass ? pass.error : "Can't reach the game server");
    }
    const r = new Room({ adaptiveStream: true, dynacast: true });
    const box = document.createElement("div");
    box.hidden = true;
    document.body.append(box);
    speakers.current = box;
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) box.append(track.attach());
    });
    r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((el) => el.remove()));
    r.on(RoomEvent.ActiveSpeakersChanged, (people: Participant[]) => setSpeaking(new Set(people.map((p) => p.identity))));
    r.on(RoomEvent.ParticipantConnected, refresh);
    r.on(RoomEvent.ParticipantDisconnected, refresh);
    r.on(RoomEvent.Disconnected, () => {
      if (room.current === r) leave();
    });
    try {
      await r.connect(pass.url, pass.token);
      room.current = r;
      await r.startAudio();
      if (pass.canTalk) await r.localParticipant.setMicrophoneEnabled(true);
      setCanTalk(pass.canTalk);
      setMuted(!pass.canTalk);
      setStatus("on");
      refresh();
    } catch (err) {
      r.disconnect();
      box.remove();
      speakers.current = null;
      setStatus("off");
      setError(err instanceof Error && err.name === "NotAllowedError" ? "Allow the microphone to talk, or join to just listen." : "Couldn't join voice. Try again.");
    }
  }, [roomId, refresh, leave]);

  const toggleMute = useCallback(async () => {
    const r = room.current;
    if (!r || !canTalk) return;
    await r.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }, [canTalk, muted]);

  return { status, error, canTalk, muted, present, speaking, join, leave, toggleMute };
}
