import fs from "node:fs";
import path from "node:path";

const QUICK_MS = 60_000; // a run shorter than this counts as a failed start
const FORGET_MS = 10 * 60_000; // an older streak is ignored
const BASE_MS = 2_000;
const MAX_MS = 5 * 60_000;

export function isDuplicateLogin(reason: unknown): boolean {
  const text = typeof reason === "string" ? reason : JSON.stringify(reason ?? "");
  return /duplicate_login|another location/i.test(text);
}

// A fast restart after a duplicate login would fight whoever holds the account, so wait the maximum.
export function restartDelayMs(streak: number, duplicate: boolean): number {
  if (duplicate) return MAX_MS;
  return Math.min(BASE_MS * 2 ** (streak - 1), MAX_MS);
}

// The supervisor restarts the process the moment it exits, so the backoff is a wait before
// exiting. The streak lives in a file because each run is a fresh process.
export function exitDelayMs(stateFile: string, startedAt: number, duplicate: boolean, now = Date.now()): number {
  let previous = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (now - saved.at < FORGET_MS) previous = Number(saved.streak) || 0;
  } catch {
    // no file yet
  }
  const streak = now - startedAt < QUICK_MS ? previous + 1 : 1;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ streak, at: now }));
  } catch {
    // the delay still applies this once
  }
  return restartDelayMs(streak, duplicate);
}
