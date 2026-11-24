// Zones the body keeps out of when it digs, kept by the body itself so that it doesn't depend on
// the server's regions to know a player's build. Pure and clock-injected: persistence is the
// caller's (toJSON out, fromJSON in), tested on made-up positions.
//
// A zone is a circle on the ground plane. With `y` set it is a ball (reach `r` up and down from
// `y`); without, it is a column through every height.

import type { Pos } from "./dig-safety";

export type Reason = "made" | "reverted" | "asked";
export type Zone = { x: number; z: number; r: number; y?: number; reason: Reason; at: number };
export type NewZone = Omit<Zone, "at"> & { at?: number };

const REASONS: readonly Reason[] = ["made", "reverted", "asked"];
export const MAX_ZONES = 200;
// merging stops here, so a chain of builds doesn't swallow the world in one circle
export const MAX_MERGED_RADIUS = 48;
export const CLUSTER_GAP = 4;
export const CLUSTER_MARGIN = 3;

function dist(a: Zone, b: Zone): number {
  const flat = Math.hypot(a.x - b.x, a.z - b.z);
  return a.y !== undefined && b.y !== undefined ? Math.hypot(flat, a.y - b.y) : flat;
}

// the smallest circle (ball, if both have a height) that holds both; a ball and a column make a column
function enclose(a: Zone, b: Zone): Zone {
  const ball = a.y !== undefined && b.y !== undefined;
  const d = dist(a, b);
  const at = Math.max(a.at, b.at);
  if (d + b.r <= a.r && (ball || a.y === undefined)) return { ...a, at };
  if (d + a.r <= b.r && (ball || b.y === undefined)) return { ...b, at };
  const flat: Zone = { x: a.x, z: a.z, r: Math.max(a.r, b.r), reason: a.reason, at };
  if (d === 0) return flat;
  const r = (d + a.r + b.r) / 2;
  const t = (r - a.r) / d;
  const z: Zone = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, r, reason: a.reason, at };
  if (ball) z.y = (a.y as number) + ((b.y as number) - (a.y as number)) * t;
  return z;
}

const overlaps = (a: Zone, b: Zone): boolean => dist(a, b) < a.r + b.r;

export class NoDigMap {
  private zones: Zone[] = [];
  constructor(private readonly cap: number = MAX_ZONES) {}

  get size(): number {
    return this.zones.length;
  }
  list(): readonly Zone[] {
    return this.zones;
  }

  add(zone: NewZone, now: number = Date.now()): void {
    this.zones.push({ ...zone, at: zone.at ?? now });
    this.merge();
    this.trim();
  }

  find(p: Pos): Zone | undefined {
    return this.zones.find((z) => {
      if (Math.hypot(p.x - z.x, p.z - z.z) > z.r) return false;
      return z.y === undefined || Math.abs(p.y - z.y) <= z.r;
    });
  }
  covers(p: Pos): boolean {
    return this.find(p) !== undefined;
  }

  // overlapping zones of the same reason become one, until nothing more overlaps
  merge(): void {
    for (let again = true; again; ) {
      again = false;
      outer: for (let i = 0; i < this.zones.length; i++) {
        for (let j = i + 1; j < this.zones.length; j++) {
          const a = this.zones[i];
          const b = this.zones[j];
          if (a.reason !== b.reason || !overlaps(a, b)) continue;
          const m = enclose(a, b);
          if (m.r > MAX_MERGED_RADIUS) continue;
          this.zones.splice(j, 1);
          this.zones[i] = m;
          again = true;
          break outer;
        }
      }
    }
  }

  // reverted zones are the body's guess and fade; made and asked ones are not forgotten by age
  forget(olderThanMs: number, now: number = Date.now()): number {
    const before = this.zones.length;
    this.zones = this.zones.filter((z) => z.reason !== "reverted" || now - z.at <= olderThanMs);
    return before - this.zones.length;
  }

  // over the cap: oldest reverted goes first, then oldest asked; made is never dropped, the two
  // closest made zones are folded into one circle instead
  private trim(): void {
    while (this.zones.length > this.cap) {
      const oldest = (reason: Reason): number => {
        let best = -1;
        this.zones.forEach((z, i) => {
          if (z.reason === reason && (best < 0 || z.at < this.zones[best].at)) best = i;
        });
        return best;
      };
      const drop = oldest("reverted") >= 0 ? oldest("reverted") : oldest("asked");
      if (drop >= 0) {
        this.zones.splice(drop, 1);
        continue;
      }
      if (!this.foldClosest()) return; // a cap of 1 or less with nothing to fold
    }
  }

  private foldClosest(): boolean {
    let bi = -1;
    let bj = -1;
    let gap = Infinity;
    for (let i = 0; i < this.zones.length; i++) {
      for (let j = i + 1; j < this.zones.length; j++) {
        const g = dist(this.zones[i], this.zones[j]) - this.zones[i].r - this.zones[j].r;
        if (g < gap) [gap, bi, bj] = [g, i, j];
      }
    }
    if (bi < 0) return false;
    this.zones[bi] = enclose(this.zones[bi], this.zones[bj]);
    this.zones.splice(bj, 1);
    return true;
  }

  toJSON(): { v: 1; zones: Zone[] } {
    return { v: 1, zones: this.zones.map((z) => ({ ...z })) };
  }

  // never throws: unreadable input is an empty map, unreadable zones are skipped
  static fromJSON(raw: unknown, cap: number = MAX_ZONES): NoDigMap {
    const map = new NoDigMap(cap);
    try {
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      const list = (data as { zones?: unknown } | null)?.zones;
      if (!Array.isArray(list)) return map;
      for (const item of list) {
        const z = readZone(item);
        if (z) map.zones.push(z);
      }
      map.merge();
      map.trim();
    } catch {
      map.zones = [];
    }
    return map;
  }
}

function readZone(item: unknown): Zone | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!num(o.x) || !num(o.z) || !num(o.r) || o.r <= 0 || !num(o.at)) return null;
  if (!REASONS.includes(o.reason as Reason)) return null;
  if (o.y !== undefined && !num(o.y)) return null;
  const z: Zone = { x: o.x, z: o.z, r: o.r, reason: o.reason as Reason, at: o.at };
  if (o.y !== undefined) z.y = o.y;
  return z;
}

// Made blocks seen in one look become zones: blocks within CLUSTER_GAP of each other are one
// build, and its zone reaches CLUSTER_MARGIN past the farthest block from the middle.
export function noteMade(map: NoDigMap, positions: readonly Pos[], now: number = Date.now()): void {
  const n = positions.length;
  if (n === 0) return;
  const parent = positions.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };

  // hash on a grid of CLUSTER_GAP cells so only neighbouring cells are compared
  const cells = new Map<string, number[]>();
  const cell = (v: number): number => Math.floor(v / CLUSTER_GAP);
  positions.forEach((p, i) => {
    const k = `${cell(p.x)},${cell(p.y)},${cell(p.z)}`;
    const bucket = cells.get(k);
    if (bucket) bucket.push(i);
    else cells.set(k, [i]);
  });
  positions.forEach((p, i) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of cells.get(`${cell(p.x) + dx},${cell(p.y) + dy},${cell(p.z) + dz}`) ?? []) {
            const q = positions[j];
            if (Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z)) <= CLUSTER_GAP) {
              parent[root(i)] = root(j);
            }
          }
        }
      }
    }
  });

  const groups = new Map<number, Pos[]>();
  positions.forEach((p, i) => {
    const r = root(i);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  });
  for (const g of groups.values()) {
    const span = (f: (p: Pos) => number): [number, number] => [Math.min(...g.map(f)), Math.max(...g.map(f))];
    const [x0, x1] = span((p) => p.x);
    const [y0, y1] = span((p) => p.y);
    const [z0, z1] = span((p) => p.z);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    const reach = Math.max(...g.map((p) => Math.max(Math.hypot(p.x - cx, p.z - cz), Math.abs(p.y - cy))));
    map.add({ x: cx, y: cy, z: cz, r: Math.ceil(reach) + CLUSTER_MARGIN, reason: "made" }, now);
  }
}
