// Parametric blueprints: bounded integer arguments in, a validated blueprint or words out. Every generator builds a
// plain object and hands it to parseBlueprint, so the size cap and the palette allowlist apply in one place.
// Axes: x is across (width), z is along (length or depth), y is up. North is z = 0.
import { DEFAULT_LIMITS, FENCES, GLASS, LOGS, PLANKS, STONES, parseBlueprint, type Cell, type Parsed } from "./blueprint";

const MAX = DEFAULT_LIMITS.maxSize;
export const MAX_HEIGHT = 16;

// what a floor takes, and what a wall takes besides
export const FLOOR_MATERIALS: readonly string[] = [...PLANKS, ...STONES];
export const WALL_MATERIALS: readonly string[] = [...FLOOR_MATERIALS, ...LOGS, ...GLASS];

export type Side = "north" | "east" | "south" | "west";
const SIDES: readonly Side[] = ["north", "east", "south", "west"];

const fail = (...problems: string[]): Parsed => ({ ok: false, problems });

function ints(args: Array<[name: string, v: unknown, lo: number, hi: number]>): string[] {
  const out: string[] = [];
  for (const [name, v, lo, hi] of args) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) out.push(`${name} must be a whole number from ${lo} to ${hi}`);
  }
  return out;
}

function material(v: unknown, allowed: readonly string[], what: string): string[] {
  if (typeof v === "string" && allowed.includes(v)) return [];
  return [`${typeof v === "string" ? `"${v}"` : "that"} is not a ${what}; try ${allowed.slice(0, 3).join(", ")}`];
}

function fill(sx: number, sy: number, sz: number, keep: (x: number, y: number, z: number) => string | null): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const p = keep(x, y, z);
    if (p) cells.push({ x, y, z, p });
  }
  return cells;
}

const solid = (): string => "m";

// a flat strip, length along z
export function path(length: number, width: number, block: string): Parsed {
  const bad = [...ints([["length", length, 1, MAX], ["width", width, 1, MAX]]), ...material(block, FLOOR_MATERIALS, "block Scuttle lays a path with")];
  if (bad.length) return fail(...bad);
  return parseBlueprint({ name: `path ${width}x${length}`, size: { x: width, y: 1, z: length }, palette: { m: block }, cells: fill(width, 1, length, solid) });
}

export function platform(w: number, d: number, block: string): Parsed {
  const bad = [...ints([["w", w, 1, MAX], ["d", d, 1, MAX]]), ...material(block, FLOOR_MATERIALS, "block Scuttle lays a floor with")];
  if (bad.length) return fail(...bad);
  return parseBlueprint({ name: `platform ${w}x${d}`, size: { x: w, y: 1, z: d }, palette: { m: block }, cells: fill(w, 1, d, solid) });
}

// one block thick, length along x
export function wall(length: number, height: number, block: string): Parsed {
  const bad = [...ints([["length", length, 1, MAX], ["height", height, 1, MAX_HEIGHT]]), ...material(block, WALL_MATERIALS, "block Scuttle builds a wall with")];
  if (bad.length) return fail(...bad);
  return parseBlueprint({ name: `wall ${length}x${height}`, size: { x: length, y: height, z: 1 }, palette: { m: block }, cells: fill(length, height, 1, solid) });
}

// Full blocks, each step filled down to the ground so every cell has something to be placed against. Climbs toward
// +z, one block per step. Real stair blocks need a facing and a half per cell, which this format does not carry.
export function stairsUp(height: number, width: number, block: string): Parsed {
  const bad = [...ints([["height", height, 1, MAX_HEIGHT], ["width", width, 1, MAX]]), ...material(block, FLOOR_MATERIALS, "block Scuttle builds steps with")];
  if (bad.length) return fail(...bad);
  return parseBlueprint({
    name: `steps ${width} wide up ${height}`,
    size: { x: width, y: height, z: height },
    palette: { m: block },
    cells: fill(width, height, height, (_x, y, z) => (y <= z ? "m" : null)),
  });
}

// Posts in a row along x. A gate (the same wood's) replaces the post at every gateEvery-th place, never at an end.
// The gate's facing is the placer's job: it faces across the line, which is the axis its two fence neighbours sit on.
export function fenceLine(length: number, block: string, gateEvery?: number): Parsed {
  const bad = [...ints([["length", length, 1, MAX]]), ...material(block, FENCES, "fence")];
  if (gateEvery !== undefined) bad.push(...ints([["gateEvery", gateEvery, 3, MAX]]));
  if (bad.length) return fail(...bad);
  if (gateEvery !== undefined && gateEvery > length - 1) return fail(`gateEvery ${gateEvery} puts no gate inside a line of ${length}; use ${length - 1} or less`);
  const gated = (i: number): boolean => gateEvery !== undefined && (i + 1) % gateEvery === 0 && i > 0 && i < length - 1;
  const palette: Record<string, string> = { f: block };
  if (gateEvery !== undefined) palette.g = `${block}_gate`;
  return parseBlueprint({
    name: `fence line ${length}`,
    size: { x: length, y: 1, z: 1 },
    palette,
    cells: fill(length, 1, 1, (x) => (gated(x) ? "g" : "f")),
  });
}

// The ring of a w by d rectangle, a gate in the middle of each side named (floor of the half on an even side).
// Sides are in the blueprint's own frame: north is z = 0, east is x = w - 1.
export function fencePerimeter(w: number, d: number, block: string, gates: readonly Side[] = []): Parsed {
  const bad = [...ints([["w", w, 3, MAX], ["d", d, 3, MAX]]), ...material(block, FENCES, "fence")];
  for (const g of gates) if (!SIDES.includes(g)) bad.push(`"${g}" is not a side; use north, east, south or west`);
  if (new Set(gates).size !== gates.length) bad.push("a side is named twice");
  if (bad.length) return fail(...bad);

  const mx = Math.floor((w - 1) / 2);
  const mz = Math.floor((d - 1) / 2);
  const gateAt = (x: number, z: number): boolean =>
    (gates.includes("north") && z === 0 && x === mx) ||
    (gates.includes("south") && z === d - 1 && x === mx) ||
    (gates.includes("west") && x === 0 && z === mz) ||
    (gates.includes("east") && x === w - 1 && z === mz);
  const palette: Record<string, string> = { f: block };
  if (gates.length) palette.g = `${block}_gate`;
  return parseBlueprint({
    name: `fence ${w}x${d}`,
    size: { x: w, y: 1, z: d },
    palette,
    cells: fill(w, 1, d, (x, _y, z) => (x === 0 || z === 0 || x === w - 1 || z === d - 1 ? (gateAt(x, z) ? "g" : "f") : null)),
  });
}
