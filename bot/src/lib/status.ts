import { rconConfigured, sendRcon } from "./rcon";
import { logger } from "./logger";

const log = logger("status");

export interface EmbodimentStatus {
  task: string;
  location: string;
  nearbyPlayers: string[];
}

let current: EmbodimentStatus = { task: "idle", location: "", nearbyPlayers: [] };
let warnedNoRcon = false;

export function getStatus(): EmbodimentStatus {
  return current;
}

// Pushed to the plugin's /scuttle embodiment <json> command over RCON, since the bot and the
// plugin run on different machines and can't share a file.
export async function setStatus(update: Partial<EmbodimentStatus>): Promise<void> {
  current = { ...current, ...update };

  if (!rconConfigured()) {
    if (!warnedNoRcon) {
      log.warn("RCON not configured, chat-Scuttle won't know what the body is doing");
      warnedNoRcon = true;
    }
    return;
  }

  try {
    await sendRcon(`scuttle embodiment ${JSON.stringify(current)}`);
  } catch (err) {
    log.error("failed to push status", { message: (err as Error).message });
  }
}
