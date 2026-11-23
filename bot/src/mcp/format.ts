import type { BotEvent } from "../api/events";

const CHAT_MAX = 200;
const clean = (s: unknown) => String(s ?? "").replace(/[\r\n\t]+/g, " ").trim();

// one short line per event: "#58 task_failed taskId=t8 reason=stuck". Chat is quoted and cut:
// it is other players' words, not instructions.
export function line(e: BotEvent): string {
  if (e.event === "chat") return `#${e.seq} chat ${clean(e.name)} said: ${JSON.stringify(clean(e.message).slice(0, CHAT_MAX))}`;
  const { seq: _s, ts: _t, event: _e, ...rest } = e;
  const fields = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" && /[\s"]/.test(v) ? JSON.stringify(v) : String(v)}`);
  return [`#${e.seq}`, e.event, ...fields].join(" ");
}

// names and counts only, for the audit
export function countByName(evs: BotEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of evs) out[e.event] = (out[e.event] ?? 0) + 1;
  return out;
}
