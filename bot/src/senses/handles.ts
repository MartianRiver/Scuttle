// Short ids the mind uses to point at things: `e4kq` an entity, `b7kq` a block (the two letters are
// this process's tag, so an id from before a restart never matches a new one), and the fixed names of
// the known places. A handle maps to a position or entity id inside the body only; none of that is
// ever sent. Pure.

// `stair` is the one that is not fixed: the way down the body dug, and only once there is one
export const PLACES = ["home", "table", "stash", "furnace", "bed", "stair"] as const;
export type Place = (typeof PLACES)[number];
export const isPlace = (h: string): h is Place => (PLACES as readonly string[]).includes(h);

// the shape check the protocol does; whether it still points at anything is the table's business
export const HANDLE_SHAPE = /^(?:[eb][0-9]{1,9}[a-z]{2}|home|table|stash|furnace|bed|stair)$/;

// a block only: what `collect` takes
export const BLOCK_SHAPE = /^b[0-9]{1,9}[a-z]{2}$/;

// what a task can be aimed at: a block or a known place; not a mob, which moves
export const NEAR_SHAPE = /^(?:b[0-9]{1,9}[a-z]{2}|home|table|stash|furnace|bed)$/;

export type Target =
  | { kind: "entity"; id: number; label: string }
  | { kind: "block"; x: number; y: number; z: number; name: string };

interface Entry {
  target: Target;
  at: number;
}

export const HANDLE_TTL_MS = 10 * 60_000;
const CAP = 256;

export function randomTag(random: () => number = Math.random): string {
  const letter = () => String.fromCharCode(97 + Math.floor(random() * 26));
  return letter() + letter();
}

export class HandleTable {
  private entries = new Map<string, Entry>(); // handle -> entry, oldest first
  private keys = new Map<string, string>(); // what it points at -> its handle
  private n = 0;
  private tag: string;
  private now: () => number;
  private ttl: number;

  constructor(opts: { tag?: string; now?: () => number; ttlMs?: number } = {}) {
    this.tag = opts.tag ?? randomTag();
    this.now = opts.now ?? Date.now;
    this.ttl = opts.ttlMs ?? HANDLE_TTL_MS;
  }

  private static key(t: Target): string {
    return t.kind === "entity" ? `e${t.id}` : `b${t.x},${t.y},${t.z}`;
  }

  // the same thing keeps its handle while it is seen again, and seeing it again keeps the handle fresh
  mint(target: Target): string {
    const key = HandleTable.key(target);
    let handle = this.keys.get(key);
    if (!handle) {
      handle = `${target.kind === "entity" ? "e" : "b"}${++this.n}${this.tag}`;
      this.keys.set(key, handle);
    }
    this.entries.delete(handle);
    this.entries.set(handle, { target, at: this.now() });
    while (this.entries.size > CAP) {
      const [oldest, e] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.keys.delete(HandleTable.key(e.target));
    }
    return handle;
  }

  // null for a handle that is unknown, from another process, or older than the limit
  resolve(handle: string): Target | null {
    const e = this.entries.get(handle);
    if (!e) return null;
    if (this.now() - e.at > this.ttl) {
      this.entries.delete(handle);
      this.keys.delete(HandleTable.key(e.target));
      return null;
    }
    return e.target;
  }
}
