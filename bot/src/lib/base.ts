// Where the body lives: the bed, table, furnaces and chests every task walks back to. It starts as the fixed home
// above the shop (lib/home.ts) and `make_base` replaces it with a record of what the body placed itself, kept in a file
// beside the journal. Everything reads `base`, never `home`, so a base made elsewhere moves the leash, bedtime, the
// stash and the tasks' walks with it. In memory until index.ts opens the file, so unit tests never read one.
import fs from "node:fs";
import path from "node:path";
import { Vec3 } from "vec3";
import type { Pos } from "./block-rules";
import { home } from "./home";

export type BaseRecord = { bed: [Pos, Pos]; craftingTable: Pos; furnaces: Pos[]; stashChests: Pos[] };

export interface Base {
  made: boolean; // false: today's home
  bed: [Vec3, Vec3];
  craftingTable: Vec3;
  furnaces: Vec3[];
  stashChests: Vec3[];
}

const vec = (p: Pos): Vec3 => new Vec3(p.x, p.y, p.z);
const plain = (p: Pos): Pos => ({ x: p.x, y: p.y, z: p.z });

export const base: Base = {
  made: false,
  bed: [home.bed[0], home.bed[1]],
  craftingTable: home.craftingTable,
  furnaces: [...home.furnaces],
  stashChests: [...home.stashChests],
};

const isPos = (p: unknown): p is Pos => {
  const q = p as Pos;
  return typeof q === "object" && q !== null && Number.isInteger(q.x) && Number.isInteger(q.y) && Number.isInteger(q.z);
};

// null for anything that is not a whole record: a base is all of it or the default
export function parseBase(text: string): BaseRecord | null {
  try {
    const r = JSON.parse(text) as BaseRecord;
    if (!Array.isArray(r.bed) || r.bed.length !== 2 || !r.bed.every(isPos) || !isPos(r.craftingTable)) return null;
    if (!Array.isArray(r.furnaces) || !r.furnaces.every(isPos) || !Array.isArray(r.stashChests) || !r.stashChests.every(isPos)) return null;
    return { bed: [plain(r.bed[0]), plain(r.bed[1])], craftingTable: plain(r.craftingTable), furnaces: r.furnaces.map(plain), stashChests: r.stashChests.map(plain) };
  } catch {
    return null;
  }
}

export const recordOf = (b: Base): BaseRecord => ({
  bed: [plain(b.bed[0]), plain(b.bed[1])],
  craftingTable: plain(b.craftingTable),
  furnaces: b.furnaces.map(plain),
  stashChests: b.stashChests.map(plain),
});

function apply(r: BaseRecord | null): void {
  base.made = r !== null;
  base.bed = r ? [vec(r.bed[0]), vec(r.bed[1])] : [home.bed[0], home.bed[1]];
  base.craftingTable = r ? vec(r.craftingTable) : home.craftingTable;
  base.furnaces = r ? r.furnaces.map(vec) : [...home.furnaces];
  base.stashChests = r ? r.stashChests.map(vec) : [...home.stashChests];
}

let file: string | null = null;

export const baseFile = (dir: string, name: string): string => path.join(dir, `base-${name}.json`);

// the base this bot made last time, if any; a missing or damaged file is the home
export function openBase(dir: string, name: string): void {
  file = baseFile(dir, name);
  try {
    apply(fs.existsSync(file) ? parseBase(fs.readFileSync(file, "utf8")) : null);
  } catch {
    apply(null);
  }
}

// makes this the base and keeps it; a file that cannot be written leaves it for this run
export function setBase(r: BaseRecord): void {
  apply(r);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(r));
  } catch {
    // in memory only
  }
}

// back to the home, in memory (tests); the file is the caller's to remove
export const resetBase = (): void => apply(null);
