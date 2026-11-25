// The blueprint format: data, never code. Cells are relative to an origin the plan picks later, so a
// blueprint never carries a world coordinate. The parser returns a value or a list of problems and never throws.
export type Dir = "north" | "east" | "south" | "west";
// clockwise seen from above (north is -z, east is +x)
export const DIRS: readonly Dir[] = ["north", "east", "south", "west"];

export type Cell = { x: number; y: number; z: number; p: string };
export type Size = { x: number; y: number; z: number };
export type Blueprint = {
  name: string;
  size: Size;
  palette: Record<string, string>;
  cells: Cell[];
  // the way the front of the build points; north when absent
  facing?: Dir;
};
export type Parsed = { ok: true; value: Blueprint } | { ok: false; problems: string[] };

export type Limits = { maxSize: number; maxCells: number };
export const DEFAULT_LIMITS: Limits = { maxSize: 32, maxCells: 4096 };
export const MAX_PROBLEMS = 20;

// What Scuttle may build with, by block name (as mineflayer spells it, no minecraft: prefix). Every entry is a plain
// full block, a fence, a gate or a floor torch. Left out on purpose: slabs and stairs (half and facing), wall torches,
// panes, doors, beds, chests (their own intents), anything that falls (sand, gravel), liquids, redstone, the nether
// woods, poplar (new in 26.3, untried) and air (a blueprint never clears).
const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak", "bamboo"];
export const PLANKS: readonly string[] = WOODS.map((w) => `${w}_planks`);
export const LOGS: readonly string[] = WOODS.filter((w) => w !== "bamboo").map((w) => `${w}_log`);
export const FENCES: readonly string[] = WOODS.map((w) => `${w}_fence`);
export const GATES: readonly string[] = WOODS.map((w) => `${w}_fence_gate`);
export const STONES: readonly string[] = ["stone", "cobblestone", "mossy_cobblestone", "stone_bricks", "mossy_stone_bricks", "smooth_stone"];
export const GLASS: readonly string[] = ["glass"];
export const TORCHES: readonly string[] = ["torch"];
export const PALETTE_ALLOWLIST: readonly string[] = [...PLANKS, ...LOGS, ...FENCES, ...GATES, ...STONES, ...GLASS, ...TORCHES];

// keys that would smuggle a world position in; named so the refusal says why
const WORLD_KEYS = new Set(["origin", "pos", "position", "world", "at", "offset", "base", "coords", "coordinates", "location"]);
const TOP_KEYS = ["name", "size", "palette", "cells", "facing"];
const SIZE_KEYS = ["x", "y", "z"];
const CELL_KEYS = ["x", "y", "z", "p"];
const PALETTE_KEY = /^[A-Za-z0-9]{1,12}$/;
const NAME = /^[A-Za-z0-9 _.\-]{1,48}$/;
const MAX_PALETTE = 32;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isDir = (v: unknown): v is Dir => typeof v === "string" && (DIRS as readonly string[]).includes(v);

class Problems {
  readonly list: string[] = [];
  get full(): boolean {
    return this.list.length >= MAX_PROBLEMS;
  }
  add(msg: string): void {
    if (this.list.length < MAX_PROBLEMS) this.list.push(msg);
  }
}

function noExtra(obj: Record<string, unknown>, allowed: readonly string[], where: string, bad: Problems): void {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    bad.add(WORLD_KEYS.has(k) ? `${where}: "${k}" is a world position; blueprints are relative and carry none` : `${where}: unknown key "${k}"`);
  }
}

function parseSize(raw: unknown, limits: Limits, bad: Problems): Size | null {
  if (!isObj(raw)) {
    bad.add("size must be an object {x, y, z}");
    return null;
  }
  noExtra(raw, SIZE_KEYS, "size", bad);
  const out: Partial<Size> = {};
  for (const axis of ["x", "y", "z"] as const) {
    const v = raw[axis];
    if (!isInt(v) || v < 1 || v > limits.maxSize) bad.add(`size.${axis} must be a whole number from 1 to ${limits.maxSize}`);
    else out[axis] = v;
  }
  return out.x !== undefined && out.y !== undefined && out.z !== undefined ? { x: out.x, y: out.y, z: out.z } : null;
}

function parsePalette(raw: unknown, bad: Problems): Record<string, string> | null {
  if (!isObj(raw)) {
    bad.add("palette must be an object mapping a short key to a block name");
    return null;
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) bad.add("palette is empty");
  if (keys.length > MAX_PALETTE) {
    bad.add(`palette has ${keys.length} entries, the most is ${MAX_PALETTE}`);
    return null;
  }
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = raw[k];
    if (!PALETTE_KEY.test(k) || k in Object.prototype) bad.add(`palette key "${k}" must be 1 to 12 letters or digits`);
    else if (typeof v !== "string" || !PALETTE_ALLOWLIST.includes(v)) bad.add(`palette "${k}": ${typeof v === "string" ? `"${v}"` : "that"} is not a block Scuttle builds with`);
    else out[k] = v;
  }
  return Object.keys(out).length === keys.length ? out : null;
}

function parseCells(raw: unknown, size: Size | null, palette: Record<string, string> | null, limits: Limits, bad: Problems): Cell[] | null {
  if (!Array.isArray(raw)) {
    bad.add("cells must be a list");
    return null;
  }
  const cap = Math.min(limits.maxCells, size ? size.x * size.y * size.z : limits.maxCells);
  if (raw.length === 0) bad.add("cells is empty");
  if (raw.length > cap) {
    bad.add(`${raw.length} cells, the most this blueprint can hold is ${cap}`);
    return null;
  }
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length && !bad.full; i++) {
    const c: unknown = raw[i];
    if (!isObj(c)) {
      bad.add(`cell ${i}: must be an object {x, y, z, p}`);
      continue;
    }
    noExtra(c, CELL_KEYS, `cell ${i}`, bad);
    let ok = true;
    for (const axis of ["x", "y", "z"] as const) {
      const v = c[axis];
      if (!isInt(v) || v < 0 || (size && v >= size[axis])) {
        bad.add(`cell ${i}: ${axis} must be a whole number inside the size${size ? ` (0 to ${size[axis] - 1})` : ""}`);
        ok = false;
      }
    }
    const p = c.p;
    if (typeof p !== "string" || (palette && !Object.hasOwn(palette, p))) {
      bad.add(`cell ${i}: p ${typeof p === "string" ? `"${p}"` : ""} is not a palette key`);
      ok = false;
    }
    if (!ok) continue;
    const cell = { x: c.x as number, y: c.y as number, z: c.z as number, p: p as string };
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (seen.has(key)) bad.add(`cell ${i}: ${key} is already filled`);
    seen.add(key);
    out.push(cell);
  }
  return out;
}

export function parseBlueprint(input: unknown, limits: Limits = DEFAULT_LIMITS): Parsed {
  if (!isObj(input)) return { ok: false, problems: ["a blueprint is a JSON object {name, size, palette, cells}"] };
  const bad = new Problems();
  noExtra(input, TOP_KEYS, "blueprint", bad);

  const name = input.name;
  if (typeof name !== "string" || !NAME.test(name)) bad.add("name must be 1 to 48 letters, digits, spaces, dots, dashes or underscores");
  if (input.facing !== undefined && !isDir(input.facing)) bad.add("facing must be north, east, south or west");

  const size = parseSize(input.size, limits, bad);
  const palette = parsePalette(input.palette, bad);
  const cells = parseCells(input.cells, size, palette, limits, bad);

  if (bad.list.length > 0 || !size || !palette || !cells) return { ok: false, problems: bad.list.length > 0 ? bad.list : ["not a blueprint"] };
  const value: Blueprint = { name: name as string, size, palette, cells };
  if (isDir(input.facing)) value.facing = input.facing;
  return { ok: true, value };
}

const turnDir = (d: Dir): Dir => DIRS[(DIRS.indexOf(d) + 1) % 4];

// One quarter turn clockwise seen from above: the north edge becomes the east edge. Cells keep their order, so
// four turns give back the same value.
function turnOnce(bp: Blueprint): Blueprint {
  const { x: sx, y: sy, z: sz } = bp.size;
  const out: Blueprint = {
    name: bp.name,
    size: { x: sz, y: sy, z: sx },
    palette: bp.palette,
    cells: bp.cells.map((c) => ({ x: sz - 1 - c.z, y: c.y, z: c.x, p: c.p })),
  };
  if (bp.facing) out.facing = turnDir(bp.facing);
  return out;
}

export function rotate(bp: Blueprint, quarterTurns: number): Blueprint {
  let out = bp;
  for (let i = 0; i < (((quarterTurns % 4) + 4) % 4); i++) out = turnOnce(out);
  return out;
}

// left to right, as seen from the front
export function mirror(bp: Blueprint): Blueprint {
  const out: Blueprint = {
    name: bp.name,
    size: { ...bp.size },
    palette: bp.palette,
    cells: bp.cells.map((c) => ({ x: bp.size.x - 1 - c.x, y: c.y, z: c.z, p: c.p })),
  };
  if (bp.facing) out.facing = bp.facing === "east" ? "west" : bp.facing === "west" ? "east" : bp.facing;
  return out;
}

// turn the build so its front points at `to`
export function faceTo(bp: Blueprint, to: Dir): Blueprint {
  const turns = (DIRS.indexOf(to) - DIRS.indexOf(bp.facing ?? "north") + 4) % 4;
  const out = rotate(bp, turns);
  return { ...out, facing: to };
}
