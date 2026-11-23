// Everything a client may send. Strict on purpose: unknown fields are an error, and there is
// no coordinate or command field anywhere; `say` is the one free-text field. See ../../API.md.
import { BLOCK_SHAPE, HANDLE_SHAPE, NEAR_SHAPE } from "../senses/handles";

export const TASKS = ["get_wood", "get_stone", "get_iron"] as const;
export type TaskName = (typeof TASKS)[number];

export const COMPASS_POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];
export const EXPLORE_BANDS = ["near", "a short walk", "a fair way", "far"] as const;
export type ExploreBand = (typeof EXPLORE_BANDS)[number];

export type Intent =
  | { intent: "come_to" | "follow" | "guard"; player: string }
  | { intent: "go_to"; handle: string }
  | { intent: "give"; player: string; item: string; count?: number }
  | { intent: "task"; name: TaskName; near?: string }
  | { intent: "recipe"; item: string }
  | { intent: "craft"; item: string; count?: number }
  | { intent: "collect"; handle: string; count?: number }
  | { intent: "equip"; item: string }
  | { intent: "store"; item?: string; count?: number }
  | { intent: "take"; item: string; count?: number }
  | { intent: "stash" }
  | { intent: "explore"; dir: CompassPoint; far?: ExploreBand }
  | { intent: "say"; text: string }
  | { intent: "stop" }
  | { intent: "status" }
  | { intent: "observe" };

// the actions that run like a task: one at a time, with task events
export type ActionIntent = Extract<Intent, { intent: "craft" | "collect" | "store" | "take" | "explore" }>;
export const ACTION_INTENTS = ["craft", "collect", "store", "take", "explore"] as const;

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

const countIn = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max);

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
      if (!onlyKeys(m, ["type", "id", "intent", "name", "near"])) return bad;
      if (!(TASKS as readonly unknown[]).includes(m.name)) return bad;
      if (m.near !== undefined && (typeof m.near !== "string" || !NEAR_SHAPE.test(m.near))) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "recipe":
    case "equip":
      if (!onlyKeys(m, ["type", "id", "intent", "item"])) return bad;
      if (typeof m.item !== "string" || !ITEM.test(m.item)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "craft":
    case "take":
      if (!onlyKeys(m, ["type", "id", "intent", "item", "count"])) return bad;
      if (typeof m.item !== "string" || !ITEM.test(m.item) || !countIn(m.count, 64)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "store":
      if (!onlyKeys(m, ["type", "id", "intent", "item", "count"])) return bad;
      if (m.item !== undefined && (typeof m.item !== "string" || !ITEM.test(m.item))) return bad;
      if (!countIn(m.count, 64) || (m.count !== undefined && m.item === undefined)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "collect":
      if (!onlyKeys(m, ["type", "id", "intent", "handle", "count"])) return bad;
      if (typeof m.handle !== "string" || !BLOCK_SHAPE.test(m.handle) || !countIn(m.count, 16)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "explore":
      if (!onlyKeys(m, ["type", "id", "intent", "dir", "far"])) return bad;
      if (!(COMPASS_POINTS as readonly unknown[]).includes(m.dir)) return bad;
      if (m.far !== undefined && !(EXPLORE_BANDS as readonly unknown[]).includes(m.far)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "say":
      if (!onlyKeys(m, ["type", "id", "intent", "text"])) return bad;
      if (!sayable(m.text)) return bad;
      return { ok: true, msg: { ...(m as object), text: m.text.trim() } as ClientMsg };
    case "stop":
    case "status":
    case "observe":
    case "stash":
      if (!onlyKeys(m, ["type", "id", "intent"])) return bad;
      return { ok: true, msg: m as ClientMsg };
    default:
      return bad;
  }
}
