import { Rcon } from "rcon-client";
import { config } from "./config";

export function rconConfigured(): boolean {
  return Boolean(config.rcon.host && config.rcon.password);
}

// one short-lived connection per command, for the same reason as any RCON client here — this
// traffic crosses the open internet and nothing here is frequent enough to justify a
// kept-alive connection
export async function sendRcon(command: string): Promise<string> {
  if (!config.rcon.host || !config.rcon.password) {
    throw new Error("RCON not configured (set RCON_HOST/RCON_PASSWORD)");
  }
  const rcon = await Rcon.connect({
    host: config.rcon.host,
    port: config.rcon.port,
    password: config.rcon.password,
  });
  try {
    return await rcon.send(command);
  } finally {
    rcon.end();
  }
}
