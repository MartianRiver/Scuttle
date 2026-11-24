// What `collect` may dig and which blocks it takes together: the natural kinds, the tool a block asks
// for, one tree's trunk and a run of the same block. Pure and tested.
import type { Pos } from "./dig-safety";
import { isPlainLogName } from "../lib/movement";

export type Kind = "log" | "stone" | "ore" | "soft";

const STONE = new Set(["stone", "andesite", "diorite", "granite", "deepslate", "tuff", "calcite"]);
const SOFT = new Set(["dirt", "grass_block", "coarse_dirt", "podzol", "sand", "red_sand", "gravel", "clay"]);

// null for anything a player makes or that the world has no business losing: collect only takes natural blocks
export function collectKind(name: string): Kind | null {
  if (isPlainLogName(name)) return "log";
  if (STONE.has(name)) return "stone";
  if (name.endsWith("_ore")) return "ore";
  if (SOFT.has(name)) return "soft";
  return null;
}

export const MAX_COLLECT = 16;

// Why a `collect` ended with fewer blocks than it was asked for: what was passed over for a build or for the places
// digs were undone, else simply that nothing more of it was in reach.
export function shortWords(skipped: { builds: number; undone: number }): string {
  if (skipped.undone > 0) return "the rest is where digs are undone";
  if (skipped.builds > 0) return "the rest is under a build";
  return "no more in reach";
}
export const CLUSTER_RADIUS = 5; // blocks of the same kind are taken from this far around the one pointed at
export const MAX_TRUNK_LOGS = 40;

const TIERS = ["wooden", "golden", "stone", "copper", "iron", "diamond", "netherite"];

// "a stone pickaxe or better", from the names of the tools the registry says can harvest the block;
// null when no tool is needed
export function toolWords(harvestTools: readonly string[] | null | undefined): string | null {
  if (!harvestTools || harvestTools.length === 0) return null;
  const tiers = harvestTools
    .filter((n) => n.endsWith("_pickaxe"))
    .map((n) => TIERS.indexOf(n.replace("_pickaxe", "")))
    .filter((i) => i >= 0);
  if (tiers.length === 0) return "a tool it does not have";
  const lowest = TIERS[Math.min(...tiers)];
  return lowest === "wooden" || lowest === "golden" ? "a pickaxe" : `${/^[aeiou]/.test(lowest) ? "an" : "a"} ${lowest} pickaxe or better`;
}

type NameAt = (p: Pos) => string | null;
const key = (p: Pos) => `${p.x},${p.y},${p.z}`;

// the lowest log of the column this one is in
export function trunkBase(p: Pos, nameAt: NameAt): Pos {
  let y = p.y;
  for (let i = 0; i < MAX_TRUNK_LOGS; i++) {
    const below = nameAt({ x: p.x, y: y - 1, z: p.z });
    if (below === null || !isPlainLogName(below)) break;
    y--;
  }
  return { x: p.x, y, z: p.z };
}

// One tree's logs, bottom first: the column over `at`, and the three others when the base is a 2 by 2 or a
// 3 by 3 trunk (a square of logs at ground level, not any log that touches). Never a flood fill: a cabin post
// standing against a tree would come with it.
export function trunkLogs(at: Pos, nameAt: NameAt): Pos[] {
  const base = trunkBase(at, nameAt);
  const isLog = (p: Pos) => {
    const n = nameAt(p);
    return n !== null && isPlainLogName(n);
  };
  const columns = new Map<string, Pos>([[key(base), base]]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const square = [{ x: base.x + sx, z: base.z }, { x: base.x, z: base.z + sz }, { x: base.x + sx, z: base.z + sz }].map((c) => ({ ...c, y: base.y }));
      if (square.every(isLog)) for (const c of square) columns.set(key(c), c);
    }
  }
  const out: Pos[] = [];
  for (const col of columns.values()) {
    for (let y = col.y; out.length < MAX_TRUNK_LOGS; y++) {
      const p = { x: col.x, y, z: col.z };
      if (!isLog(p)) break;
      out.push(p);
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

// `count` blocks of the same kind touching each other, the one pointed at first, nearest around it after
export function sameKindRun(seed: Pos, nameAt: NameAt, count: number, radius = CLUSTER_RADIUS): Pos[] {
  const name = nameAt(seed);
  if (name === null) return [];
  const seen = new Set([key(seed)]);
  const out: Pos[] = [seed];
  for (let i = 0; i < out.length && out.length < count; i++) {
    const p = out[i];
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (seen.has(key(q)) || Math.max(Math.abs(q.x - seed.x), Math.abs(q.y - seed.y), Math.abs(q.z - seed.z)) > radius) continue;
      seen.add(key(q));
      if (nameAt(q) === name && out.length < count) out.push(q);
    }
  }
  return out;
}
