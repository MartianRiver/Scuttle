// Everything a client may send. Strict on purpose: unknown fields are an error, and there is no command field;
// `say` is the one free-text field. The only coordinates are `go_to {x,y,z}` and a y for `dig_down {to}` (D12,
// 2026-11-24: the mind plans a strip mine by position). See ../../API.md.
import { CARDINALS, isLengthBand, TUNNEL_MAX, type Cardinal } from "../behaviors/tunnel-plan";
import { BLOCK_SHAPE, HANDLE_SHAPE, NEAR_SHAPE } from "../senses/handles";
import { sayable } from "../lib/speech";

export { SAY_MAX, sayable } from "../lib/speech";

export const TASKS = ["get_wood", "get_stone", "get_iron"] as const;
export type TaskName = (typeof TASKS)[number];

export const COMPASS_POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];
export const EXPLORE_BANDS = ["near", "a short walk", "a fair way", "far"] as const;
export type ExploreBand = (typeof EXPLORE_BANDS)[number];

export const DIG_TARGETS = ["stone"] as const;
export type DigTarget = (typeof DIG_TARGETS)[number] | number; // stone, or a y to dig down to

// where the world's cells can be: far inside the border, and the overworld's height
export const COORD_MAX = 30_000_000;
export const Y_MIN = -2048;
export const Y_MAX = 2048;
const inRange = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
export const isY = (v: unknown): boolean => inRange(v, Y_MIN, Y_MAX);

export type Intent =
  | { intent: "come_to" | "follow" | "guard"; player: string }
  | { intent: "go_to"; handle: string }
  | { intent: "go_to"; x: number; y: number; z: number }
  | { intent: "give"; player: string; item: string; count?: number }
  | { intent: "task"; name: TaskName; near?: string }
  | { intent: "recipe"; item: string }
  | { intent: "craft"; item: string; count?: number }
  | { intent: "collect"; handle: string; count?: number }
  | { intent: "equip"; item: string }
  | { intent: "store"; item?: string; count?: number; chest?: string }
  | { intent: "take"; item: string; count?: number; chest?: string }
  | { intent: "place"; item: string; where?: string }
  | { intent: "pick_up"; handle: string }
  | { intent: "make_base" }
  | { intent: "stash" }
  | { intent: "explore"; dir: CompassPoint; far?: ExploreBand }
  | { intent: "dig_down"; to?: DigTarget; torches?: boolean }
  | { intent: "tunnel"; dir?: Cardinal; length?: number | ExploreBand; through?: boolean; torches?: boolean }
  | { intent: "climb_up" }
  | { intent: "say"; text: string }
  | { intent: "stop" }
  | { intent: "status" }
  | { intent: "observe" };

// the actions that run like a task: one at a time, with task events
export type ActionIntent = Extract<Intent, { intent: "craft" | "collect" | "store" | "take" | "explore" | "dig_down" | "tunnel" | "climb_up" | "place" | "pick_up" | "make_base" }>;
export const ACTION_INTENTS = ["craft", "collect", "store", "take", "explore", "dig_down", "tunnel", "climb_up", "place", "pick_up", "make_base"] as const;
// the intents that change the world with the hands; off unless the body's placement switch is on
export const PLACING_INTENTS = ["place", "pick_up", "make_base"] as const;

// where a `place` goes, in words: never a position
export const WHERE_SHAPE = /^(?:here|ahead|wall|on (?:b[0-9]{1,9}[a-z]{2}|table|stash|furnace|bed))$/;

export type ClientMsg =
  | { type: "auth"; token: string; since?: number; epoch?: string }
  | ({ type: "intent"; id: string } & Intent);

export type Parsed = { ok: true; msg: ClientMsg } | { ok: false; id?: string };

const PLAYER = /^[A-Za-z0-9_.]{1,17}$/;
const ITEM = /^[a-z_]{1,48}$/;

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
      if (!onlyKeys(m, ["type", "id", "intent", "handle", "x", "y", "z"])) return bad;
      if (m.handle !== undefined) {
        // a handle, or a point: never both
        if (m.x !== undefined || m.y !== undefined || m.z !== undefined) return bad;
        if (typeof m.handle !== "string" || !HANDLE_SHAPE.test(m.handle)) return bad;
      } else if (!inRange(m.x, -COORD_MAX, COORD_MAX) || !isY(m.y) || !inRange(m.z, -COORD_MAX, COORD_MAX)) return bad;
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
      if (!onlyKeys(m, ["type", "id", "intent", "item", "count"])) return bad;
      if (typeof m.item !== "string" || !ITEM.test(m.item) || !countIn(m.count, 64)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "take":
      if (!onlyKeys(m, ["type", "id", "intent", "item", "count", "chest"])) return bad;
      if (typeof m.item !== "string" || !ITEM.test(m.item) || !countIn(m.count, 64)) return bad;
      if (m.chest !== undefined && (typeof m.chest !== "string" || !NEAR_SHAPE.test(m.chest))) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "place":
      if (!onlyKeys(m, ["type", "id", "intent", "item", "where"])) return bad;
      if (typeof m.item !== "string" || !ITEM.test(m.item)) return bad;
      if (m.where !== undefined && (typeof m.where !== "string" || !WHERE_SHAPE.test(m.where))) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "pick_up":
      if (!onlyKeys(m, ["type", "id", "intent", "handle"])) return bad;
      if (typeof m.handle !== "string" || !NEAR_SHAPE.test(m.handle)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "store":
      if (!onlyKeys(m, ["type", "id", "intent", "item", "count", "chest"])) return bad;
      if (m.chest !== undefined && (typeof m.chest !== "string" || !NEAR_SHAPE.test(m.chest))) return bad;
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
    case "dig_down":
      if (!onlyKeys(m, ["type", "id", "intent", "to", "torches"])) return bad;
      if (m.to !== undefined && !(DIG_TARGETS as readonly unknown[]).includes(m.to) && !isY(m.to)) return bad;
      if (m.torches !== undefined && typeof m.torches !== "boolean") return bad;
      return { ok: true, msg: m as ClientMsg };
    case "tunnel":
      if (!onlyKeys(m, ["type", "id", "intent", "dir", "length", "through", "torches"])) return bad;
      if (m.torches !== undefined && typeof m.torches !== "boolean") return bad;
      if (m.dir !== undefined && !(CARDINALS as readonly unknown[]).includes(m.dir)) return bad;
      if (m.length !== undefined && !countIn(m.length, TUNNEL_MAX) && !isLengthBand(m.length)) return bad;
      if (m.through !== undefined && typeof m.through !== "boolean") return bad;
      return { ok: true, msg: m as ClientMsg };
    case "say":
      if (!onlyKeys(m, ["type", "id", "intent", "text"])) return bad;
      if (!sayable(m.text)) return bad;
      return { ok: true, msg: { ...(m as object), text: m.text.trim() } as ClientMsg };
    case "stop":
    case "status":
    case "observe":
    case "stash":
    case "climb_up":
    case "make_base":
      if (!onlyKeys(m, ["type", "id", "intent"])) return bad;
      return { ok: true, msg: m as ClientMsg };
    default:
      return bad;
  }
}
