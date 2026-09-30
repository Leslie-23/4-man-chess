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
  const identity = "color" in seat ? seat.color : `watcher-${seat.spectator}`;
  const token = new AccessToken(config.apiKey, config.apiSecret, { identity, name: seat.name, ttl: "4h" });
  token.addGrant({ room: `fourman-${roomId}`, roomJoin: true, canSubscribe: true, canPublish: "color" in seat, canPublishData: false });
  return token.toJwt();
}
