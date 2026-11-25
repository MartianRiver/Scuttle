// The mine site: the shaft the body dug down from the surface, the landing at its foot and the kit set down there.
// Kept apart from the base (lib/base.ts), which stays the surface home bedtime, the leash and the stash read. A file
// of its own beside the journal, `sites-<bot name>.json`, with its own parser: a missing or damaged file is no mine,
// and an old base file is never touched. In memory until index.ts opens the file, so unit tests never read one.
import fs from "node:fs";
import path from "node:path";
import type { Pos } from "./block-rules";

export interface Kit {
  chest?: Pos;
  table?: Pos;
  furnace?: Pos;
}

export interface MineSite {
  top: Pos; // the surface cell the first step was taken from (the shaft's first cell)
  facing: { dx: number; dz: number } | null; // the way the stair goes; null until it is dug
  shaft: Pos[]; // the cells its feet stood in, top first, as dug so far
  landing: Pos | null; // the last cell of the shaft once the kit is down
  kit: Kit;
}

const plain = (p: Pos): Pos => ({ x: p.x, y: p.y, z: p.z });
const isPos = (p: unknown): p is Pos => {
  const q = p as Pos;
  return typeof q === "object" && q !== null && Number.isInteger(q.x) && Number.isInteger(q.y) && Number.isInteger(q.z);
};
const sameCell = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

// one step of a stair: a block along and down, or level
const stepOk = (a: Pos, b: Pos): boolean => Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1 && (b.y - a.y === -1 || b.y === a.y);

// null for anything that is not a whole record (a shaft with a gap in it, a landing that is not its last cell): half a
// mine is no mine
export function parseSites(text: string): MineSite | null {
  try {
    const m = (JSON.parse(text) as { mine?: MineSite }).mine;
    if (!m || !isPos(m.top) || !Array.isArray(m.shaft) || !m.shaft.every(isPos)) return null;
    if (m.shaft.length > 0 && !sameCell(m.shaft[0], m.top)) return null;
    for (let i = 1; i < m.shaft.length; i++) if (!stepOk(m.shaft[i - 1], m.shaft[i])) return null;
    const f = m.facing;
    if (f !== null && !(f && Number.isInteger(f.dx) && Number.isInteger(f.dz) && Math.abs(f.dx) + Math.abs(f.dz) === 1)) return null;
    if (m.landing !== null && !(isPos(m.landing) && m.shaft.length > 0 && sameCell(m.landing, m.shaft[m.shaft.length - 1]))) return null;
    const kit: Kit = {};
    for (const k of ["chest", "table", "furnace"] as const) {
      const p = m.kit?.[k];
      if (p === undefined) continue;
      if (!isPos(p)) return null;
      kit[k] = plain(p);
    }
    if (m.landing === null && Object.keys(kit).length > 0) return null;
    return { top: plain(m.top), facing: f ? { dx: f.dx, dz: f.dz } : null, shaft: m.shaft.map(plain), landing: m.landing ? plain(m.landing) : null, kit };
  } catch {
    return null;
  }
}

export const siteText = (m: MineSite): string => JSON.stringify({ mine: m });

let mine: MineSite | null = null;
let file: string | null = null;

export const sitesFile = (dir: string, name: string): string => path.join(dir, `sites-${name}.json`);

export const getMine = (): MineSite | null => mine;

// the mine this bot dug last time, if any
export function openSites(dir: string, name: string): void {
  file = sitesFile(dir, name);
  try {
    mine = fs.existsSync(file) ? parseSites(fs.readFileSync(file, "utf8")) : null;
  } catch {
    mine = null;
  }
}

// keeps the site; a file that cannot be written leaves it for this run
export function setMine(m: MineSite | null): void {
  mine = m;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (m) fs.writeFileSync(file, siteText(m));
    else fs.rmSync(file, { force: true });
  } catch {
    // in memory only
  }
}

// back to no mine, in memory (tests); the file is the caller's to remove
export const resetSites = (): void => {
  mine = null;
};

// ---- measuring from the mine ----

export const MINE_REACH = 64; // blocks, straight line from the landing: its tunnels and branches are inside it

// The body is at work in the mine: well under the shaft's top and within reach of the landing. A landing that is not
// down yet (no kit) is no mine, and neither is the surface above it.
export function inMine(p: Pos, m: MineSite | null = mine): boolean {
  if (!m || !m.landing) return false;
  if (p.y > m.top.y - 2) return false;
  return Math.hypot(p.x - m.landing.x, p.y - m.landing.y, p.z - m.landing.z) <= MINE_REACH;
}

// where a distance rule is measured from: the landing for a task begun in the mine, `home` anywhere else, so the surface
// rules stay as they were
export const originFor = (p: Pos, home: Pos, m: MineSite | null = mine): Pos => (inMine(p, m) ? (m as MineSite).landing as Pos : home);

const AT_LANDING = 6; // blocks: an order aimed this close to the landing is aimed at the mine

// The landing a task's search is centred on when it is a mine task: begun with no aim while the body is in the mine, or
// aimed at the landing itself. null for everything else, which keeps the home table as its centre.
export function mineCentre(aim: Pos | undefined, feet: Pos, m: MineSite | null = mine): Pos | null {
  if (!m || !m.landing) return null;
  if (aim === undefined) return inMine(feet, m) ? m.landing : null;
  return Math.hypot(aim.x - m.landing.x, aim.y - m.landing.y, aim.z - m.landing.z) <= AT_LANDING ? m.landing : null;
}

// how far below the landing a mine task may take rock: the surface floor (STONE_MIN_Y) is no floor down here
export const MINE_FLOOR_BELOW = 40;
