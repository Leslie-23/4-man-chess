import type { PlayerColor } from "@fourman/game-engine";
import { AccessToken } from "livekit-server-sdk";

export interface VoiceConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** LiveKit settings from the environment, or null when voice isn't set up. */
export function voiceFromEnv(env = process.env): VoiceConfig | null {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

/**
 * A pass into the room's voice channel, named after the game room. Seated
 * players can talk; spectators listen. The identity is the seat colour, so the
 * board can light up whoever is speaking.
 */
export async function voiceToken(config: VoiceConfig, roomId: string, seat: { color: PlayerColor; name: string } | { spectator: string; name: string }) {
  return voicePass(config, `fourman-${roomId}`, {
    identity: "color" in seat ? seat.color : `watcher-${seat.spectator}`,
    name: seat.name,
    canTalk: "color" in seat,
  });
}

/** A pass into any voice channel; each game names its own channels and identities. */
export async function voicePass(config: VoiceConfig, channel: string, who: { identity: string; name: string; canTalk: boolean }) {
  const token = new AccessToken(config.apiKey, config.apiSecret, { identity: who.identity, name: who.name, ttl: "4h" });
  token.addGrant({ room: channel, roomJoin: true, canSubscribe: true, canPublish: who.canTalk, canPublishData: false });
  return token.toJwt();
}
