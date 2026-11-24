import dotenv from "dotenv";
import path from "node:path";
import { resolveVersion } from "./version";

// BOT_ENV points at another env file (the test world uses one) instead of the default .env
dotenv.config({ path: process.env.BOT_ENV });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export const config = {
  host: required("MC_HOST"),
  port: Number(process.env.MC_PORT ?? 25565),
  username: required("MC_USERNAME"),
  auth: (process.env.MC_AUTH ?? "microsoft") as "microsoft" | "mojang" | "offline",
  version: resolveVersion(process.env.MC_VERSION),
  // scoped to this project so the Microsoft device-code token cache is easy to find and gitignore,
  // rather than the OS-wide default mineflayer/prismarine-auth otherwise picks
  profilesFolder: path.join(__dirname, "..", "..", ".auth-cache"),

  // the hands that set blocks down (place, pick_up, make_base): off unless PLACEMENT=on, which only the test world's
  // bot.env sets. Off, they answer rejected not_enabled and craft and smelt behave as before.
  placement: process.env.PLACEMENT === "on",

  // pushes embodiment status to the plugin's /scuttle embodiment command — the bot and the
  // plugin run on different machines (a separate box vs. the game host), so RCON is the seam, not a
  // shared file. Optional: left unset, status.ts just logs once and stops trying.
  rcon: {
    host: process.env.RCON_HOST,
    port: Number(process.env.RCON_PORT ?? 25575),
    password: process.env.RCON_PASSWORD,
  },

  // body control API (src/api, API.md). Off unless a port and at least one token are set.
  api: {
    host: process.env.API_HOST ?? "127.0.0.1",
    port: process.env.API_PORT ? Number(process.env.API_PORT) : undefined,
    tokens: parseTokens(process.env.API_TOKENS),
  },
};

const loopback = (h: string | undefined) => !h || h === "127.0.0.1" || h === "localhost";
if (config.auth === "offline" && !(loopback(config.host) && loopback(config.rcon.host))) {
  throw new Error("offline auth is only allowed against 127.0.0.1");
}

// "label:token,label2:token2" -> token -> label. A weak token is a startup error, not a warning.
function parseTokens(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    const label = part.slice(0, i);
    const token = part.slice(i + 1);
    if (i < 1 || token.length < 24) throw new Error("API_TOKENS entries must be label:token with a token of 24+ chars");
    out.set(token, label);
  }
  return out;
}
