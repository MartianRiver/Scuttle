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

type At = { x: number; y: number; z: number };
export const spotKey = (p: At): string => `${p.x},${p.y},${p.z}`;
export const OWN_NEAR = 16; // an own chest this near is where a `store` goes

const flat = (a: At, b: At) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// where a `store` with no chest named goes: the body's own chests within reach of where it stands, nearest first, else the
// base's stash. A stray chest far away never takes the stash over.
export function storeSpots<T extends At>(own: readonly T[], baseSpots: readonly T[], from: At): T[] {
  const near = own.filter((c) => flat(c, from) <= OWN_NEAR).sort((a, b) => flat(a, from) - flat(b, from));
  return near.length > 0 ? near : [...baseSpots];
}

// where a `take` looks: the same near own chests, then every other own chest, then the base's stash; each chest once
export function takeSpots<T extends At>(own: readonly T[], baseSpots: readonly T[], from: At): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of [...[...own].sort((a, b) => flat(a, from) - flat(b, from)), ...baseSpots]) {
    if (seen.has(spotKey(c))) continue;
    seen.add(spotKey(c));
    out.push(c);
  }
  return out;
}

// Whether a `take` goes and opens a chest: not when it was seen lately with none of the item, unless it is near enough
// that a look costs nothing. The memory goes stale without the body knowing (its own `store`, a kid, a restock),
// and trusting it sent the body 250 blocks to the base with a chest holding the item beside it.
export const worthOpening = (seen: number | null, chest: At, from: At): boolean => seen !== 0 || flat(chest, from) <= OWN_NEAR;

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

// What it last saw in each stash chest, by where the chest is (a handle would expire). A chest it has never opened is not known to be empty.
export class StashMemory {
  private looks = new Map<string, Look>();

  note(chest: string, items: Counts, now: number = Date.now()): void {
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

  // what the chest held when last seen, null when never
  lookAt(chest: string): Counts | null {
    return this.looks.get(chest)?.items ?? null;
  }

  // how many of the item the chest held when last seen, null when never seen or not lately
  chestHas(chest: string, item: string, now: number = Date.now()): number | null {
    const look = this.looks.get(chest);
    return look && now - look.at <= FRESH_MS ? (look.items[item] ?? 0) : null;
  }
}

// the body's one memory of its chests
export const stashMemory = new StashMemory();

// "oak_log 12, coal 3" for the observe line of a chest, "empty", or null when it has never been opened
export function stashSummary(items: Counts | null, max = 3): string | null {
  if (items === null) return null;
  const top = Object.entries(items).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (top.length === 0) return "empty";
  return top.slice(0, max).map(([k, n]) => `${k} ${n}`).join(", ") + (top.length > max ? ", and more" : "");
}
