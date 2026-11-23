import { readFileSync } from "node:fs";
import dotenv from "dotenv";

export type ApiEnv = { ok: true; url: string; token: string } | { ok: false; error: string };

// Same variables the bot reads. BOT_ENV names the env file (relative to the cwd); real environment
// variables win over the file. Parsed here, not through the bot's config module, which needs the
// game-server settings and writes into process.env.
export function loadApiEnv(env: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, "utf8")): ApiEnv {
  let file: Record<string, string> = {};
  if (env.BOT_ENV) {
    try {
      file = dotenv.parse(read(env.BOT_ENV));
    } catch (e) {
      return { ok: false, error: `can't read BOT_ENV file: ${(e as Error).message}` };
    }
  }
  const get = (k: string) => env[k] || file[k];
  const port = get("API_PORT");
  const first = (get("API_TOKENS") ?? "").split(",").map((s) => s.trim()).find(Boolean);
  const token = first?.slice(first.indexOf(":") + 1);
  if (!port || !/^\d+$/.test(port)) return { ok: false, error: "API_PORT is not set (set BOT_ENV to the bot's env file)" };
  if (!first || !token || first.indexOf(":") < 1) return { ok: false, error: "API_TOKENS is not set, or not label:token" };
  return { ok: true, url: `ws://${get("API_HOST") ?? "127.0.0.1"}:${port}`, token };
}
