// The two upkeep warnings, as pure state: a pack with no room for what it digs, and a tool near its end. The reading of
// the world is upkeep.ts; this is what counts as new news.

export interface Stack {
  name: string;
  count: number;
  stackSize: number;
}

// whether the drops fit, taken in order: a partial stack of the same item first, else an empty slot
export function roomFor(drops: readonly string[], stacks: readonly Stack[], emptySlots: number): boolean {
  const space = new Map<string, number>();
  for (const s of stacks) space.set(s.name, (space.get(s.name) ?? 0) + Math.max(0, s.stackSize - s.count));
  let empty = emptySlots;
  const size = new Map(stacks.map((s) => [s.name, s.stackSize]));
  for (const d of drops) {
    const left = space.get(d) ?? 0;
    if (left > 0) {
      space.set(d, left - 1);
      continue;
    }
    if (empty <= 0) return false;
    empty--;
    space.set(d, (size.get(d) ?? 64) - 1);
  }
  return true;
}

// one `pack_full` per episode: it is said when the pack first has no room, and again only after a slot has freed
export class PackEpisode {
  private on = false;

  // true when this is news
  note(): boolean {
    const fresh = !this.on;
    this.on = true;
    return fresh;
  }

  // a slot is free again
  clear(): void {
    this.on = false;
  }

  get active(): boolean {
    return this.on;
  }
}

export const WEAR_AT = 10; // percent left at which a held tool is news
export const wearWords = "a few uses left";

// `tool_worn` once per tool: a tool is told of when it first reads at or under WEAR_AT percent, and again only after
// that kind of tool has been seen above it (a fresh one in hand)
export class WearWatch {
  private told = new Set<string>();

  // the item to tell of, or null
  check(held: { name: string; left: number } | null): string | null {
    if (!held) return null;
    if (held.left > WEAR_AT) {
      this.told.delete(held.name);
      return null;
    }
    if (this.told.has(held.name)) return null;
    this.told.add(held.name);
    return held.name;
  }
}

// a pickaxe or sword is what the event is about; an axe or shovel wearing out is the body's own business
export const isWatchedTool = (name: string): boolean => /_(pickaxe|sword)$/.test(name);

export const TORCHES_LOW = 3; // carrying this many or fewer, underground, is news

// `torches_low` at TORCHES_LOW or fewer and `torches_out` at none, while underground, each once an episode. An episode
// ends when it carries more than it did when it was told (a few taken from the chest, a craft), or more than TORCHES_LOW.
// `underground` is asked only when something could be due.
export class TorchWatch {
  private told: { level: "low" | "out"; at: number } | null = null;

  check(count: number, underground: () => boolean): "torches_low" | "torches_out" | null {
    if (this.told && count > this.told.at) this.told = null;
    if (count > TORCHES_LOW) return null;
    const level = count === 0 ? "out" : "low";
    if (this.told && (this.told.level === level || this.told.level === "out")) return null;
    if (!underground()) return null;
    this.told = { level, at: count };
    return level === "out" ? "torches_out" : "torches_low";
  }
}
