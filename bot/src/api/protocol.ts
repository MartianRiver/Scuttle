// Everything a client may send. Strict on purpose: unknown fields are an error, and there is
// no coordinate, command or chat-text field anywhere. See ../../API.md.

export const TASKS = ["get_wood"] as const;
export type TaskName = (typeof TASKS)[number];

export type Intent =
  | { intent: "come_to" | "follow"; player: string }
  | { intent: "task"; name: TaskName }
  | { intent: "stop" }
  | { intent: "status" };

export type ClientMsg =
  | { type: "auth"; token: string; since?: number; epoch?: string }
  | ({ type: "intent"; id: string } & Intent);

export type Parsed = { ok: true; msg: ClientMsg } | { ok: false; id?: string };

const PLAYER = /^[A-Za-z0-9_.]{1,17}$/;

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
      if (!onlyKeys(m, ["type", "id", "intent", "player"])) return bad;
      if (typeof m.player !== "string" || !PLAYER.test(m.player)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "task":
      if (!onlyKeys(m, ["type", "id", "intent", "name"])) return bad;
      if (!(TASKS as readonly unknown[]).includes(m.name)) return bad;
      return { ok: true, msg: m as ClientMsg };
    case "stop":
    case "status":
      if (!onlyKeys(m, ["type", "id", "intent"])) return bad;
      return { ok: true, msg: m as ClientMsg };
    default:
      return bad;
  }
}
