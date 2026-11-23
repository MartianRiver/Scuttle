// What goes into the stash and what it remembers of it. Pure and tested.

export type Counts = Record<string, number>;

export interface Carried {
  name: string;
  count: number;
  durable: boolean; // a tool, a weapon, anything that wears
  food: number; // food points, 0 when not food
}

// Two chests side by side are one double chest: opening either opens the same 54 slots, so only the first of
// each touching pair is a place of its own. Returns indexes into `spots`.
export function distinctChests(spots: ReadonlyArray<{ x: number; y: number; z: number }>): number[] {
  const kept: number[] = [];
  spots.forEach((p, i) => {
    const touching = kept.some((k) => Math.abs(spots[k].x - p.x) + Math.abs(spots[k].y - p.y) + Math.abs(spots[k].z - p.z) === 1);
    if (!touching) kept.push(i);
  });
  return kept;
}

export const KEEP_FOOD = 16;
export const KEEP_COBBLE = 4; // what the tasks keep
export const KEEP_COAL = 4;

// `store` with no item: everything except what it works with. Tools, weapons and armour it carries stay, as
// does food up to 16 (the best first) and the 4 cobblestone and 4 coal the tasks keep for themselves.
export function storeAll(items: readonly Carried[]): Counts {
  const out: Counts = {};
  let food = KEEP_FOOD;
  const byFood = [...items].sort((a, b) => b.food - a.food);
  for (const it of byFood) {
    if (it.durable) continue;
    let keep = 0;
    if (it.food > 0) {
      keep = Math.min(it.count, food);
      food -= keep;
    } else if (it.name === "cobblestone") keep = KEEP_COBBLE;
    else if (it.name === "coal") keep = KEEP_COAL;
    const put = it.count - keep;
    if (put > 0) out[it.name] = (out[it.name] ?? 0) + put;
  }
  return out;
}

// `store` of one item: up to `count` (all of it by default), tools and weapons too since it was asked for by name
export function storeOne(items: readonly Carried[], item: string, count?: number): Counts {
  const have = items.filter((i) => i.name === item).reduce((n, i) => n + i.count, 0);
  const put = Math.min(have, count ?? have);
  return put > 0 ? { [item]: put } : {};
}

// how long a look at a chest counts as current: kids and other players take things out
export const FRESH_MS = 10 * 60_000;
const RECENT_MS = 60_000;

interface Look {
  at: number;
  items: Counts;
}

// What it last saw in each stash chest. A chest it has never opened is not known to be empty.
export class StashMemory {
  private looks = new Map<number, Look>();

  note(chest: number, items: Counts, now: number = Date.now()): void {
    this.looks.set(chest, { at: now, items: { ...items } });
  }

  // what the chests held when last seen; `fresh` only if every chest has been seen lately
  answer(chests: number, now: number = Date.now()): { items: Counts; fresh: boolean; looked: string; unseen?: number } {
    const items: Counts = {};
    let oldest = Infinity;
    let newest = -Infinity;
    for (const look of this.looks.values()) {
      for (const [name, n] of Object.entries(look.items)) items[name] = (items[name] ?? 0) + n;
      oldest = Math.min(oldest, look.at);
      newest = Math.max(newest, look.at);
    }
    const unseen = Math.max(0, chests - this.looks.size);
    const ordered = Object.fromEntries(Object.entries(items).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    const looked = this.looks.size === 0 ? "never" : now - newest <= RECENT_MS ? "just now" : now - newest <= FRESH_MS ? "minutes ago" : "a while ago";
    return { items: ordered, fresh: this.looks.size > 0 && unseen === 0 && now - oldest <= FRESH_MS, looked, ...(unseen > 0 && { unseen }) };
  }

  // how many of the item the chest held when last seen, null when never seen or not lately
  chestHas(chest: number, item: string, now: number = Date.now()): number | null {
    const look = this.looks.get(chest);
    return look && now - look.at <= FRESH_MS ? (look.items[item] ?? 0) : null;
  }
}
