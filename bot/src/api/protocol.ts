// Everything a client may send. Strict on purpose: unknown fields are an error, and there is
// no coordinate or command field anywhere; `say` is the one free-text field. See ../../API.md.
import { HANDLE_SHAPE } from "../senses/handles";

export const TASKS = ["get_wood", "get_stone", "get_iron"] as const;
export type TaskName = (typeof TASKS)[number];

export type Intent =
  | { intent: "come_to" | "follow" | "guard"; player: string }
  | { intent: "go_to"; handle: string }
  | { intent: "give"; player: string; item: string; count?: number }
  | { intent: "task"; name: TaskName }
  | { intent: "say"; text: string }
  | { intent: "stop" }
  | { intent: "status" }
  | { intent: "observe" };

export type ClientMsg =
  | { type: "auth"; token: string; since?: number; epoch?: string }
  | ({ type: "intent"; id: string } & Intent);

export type Parsed = { ok: true; msg: ClientMsg } | { ok: false; id?: string };

const PLAYER = /^[A-Za-z0-9_.]{1,17}$/;
const ITEM = /^[a-z_]{1,48}$/;
export const SAY_MAX = 100;

// one plain line of printable ASCII: nothing that is a command, a control or format character, a section sign
// (the server kicks a client for one) or a look-alike letter
export function sayable(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  return t.length > 0 && t.length <= SAY_MAX && !t.startsWith("/") && /^[\x20-\x7e]+$/.test(t);
}

function onlyKeys(o: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

export function parseFrame(raw: string): Parsed {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return { ok: false };
  const m = o as Record<string, unknown>;

  if (m.type === "auth") {
    if (!onlyKeys(m, ["type", "token", "since", "epoch"])) return { ok: false };
    if (typeof m.token !== "string" || m.token.length > 200) return { ok: false };
    if (m.since !== undefined && !(Number.isInteger(m.since) && (m.since as number) >= 0)) return { ok: false };
    if (m.epoch !== undefined && (typeof m.epoch !== "string" || m.epoch.length > 32)) return { ok: false };
    return { ok: true, msg: m as ClientMsg };
  }

  if (m.type !== "intent") return { ok: false };
  const id = typeof m.id === "string" && m.id.length >= 1 && m.id.length <= 32 ? m.id : undefined;
  if (!id) return { ok: false };
  const bad = { ok: false as const, id };

  switch (m.intent) {
    case "come_to":
    case "follow":
    case "guard":
      if (!onlyKeys(m, ["type", "id", "intent", "player"])) return bad;
      if (typeof m.player !== "string" || !PLAYER.test(m.player)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "go_to":
      if (!onlyKeys(m, ["type", "id", "intent", "handle"])) return bad;
      if (typeof m.handle !== "string" || !HANDLE_SHAPE.test(m.handle)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "give":
      if (!onlyKeys(m, ["type", "id", "intent", "player", "item", "count"])) return bad;
      if (typeof m.player !== "string" || !PLAYER.test(m.player)) return bad;
      if (typeof m.item !== "string" || !ITEM.test(m.item)) return bad;
      if (m.count !== undefined && !(Number.isInteger(m.count) && (m.count as number) >= 1 && (m.count as number) <= 64)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "task":
      if (!onlyKeys(m, ["type", "id", "intent", "name"])) return bad;
      if (!(TASKS as readonly unknown[]).includes(m.name)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "say":
      if (!onlyKeys(m, ["type", "id", "intent", "text"])) return bad;
      if (!sayable(m.text)) return bad;
      return { ok: true, msg: { ...(m as object), text: m.text.trim() } as ClientMsg };
    case "stop":
    case "status":
    case "observe":
      if (!onlyKeys(m, ["type", "id", "intent"])) return bad;
      return { ok: true, msg: m as ClientMsg };
    default:
      return bad;
  }
}
