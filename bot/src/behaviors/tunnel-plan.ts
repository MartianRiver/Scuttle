// The branch mine `tunnel` digs, planned apart from the world: a one-wide, two-high passage at foot level, one column
// at a time, and the ore its walls show as they open. Pure, on a grid of names, so it is tested on made-up rock.
//
// From the feet cell `cur` facing f, the next column c holds A (head height) and B (feet); the floor F under B is never
// dug, only walked on, so a hole or a drop there stops it. Each cell goes through the same dig rules as every other dig:
// liquid in or beside it, a build in it or near it, sand or gravel over it, rock the game will not break, a tool it lacks.
import { isFalling, isLiquid, isMade, isStandHazard, madeBlocksNear, safeToDig, type Pos } from "./dig-safety";
import { numberWords, type Facing, type Grid } from "./dig-down-plan";

export const TUNNEL_DEFAULT = 16;
export const TUNNEL_MAX = 32;

// the cardinal points a tunnel may be aimed at, and what each is on the map (+x is east, +z is south)
export const CARDINALS = ["north", "east", "south", "west"] as const;
export type Cardinal = (typeof CARDINALS)[number];
const FACING_OF: Record<Cardinal, Facing> = { north: { dx: 0, dz: -1 }, east: { dx: 1, dz: 0 }, south: { dx: 0, dz: 1 }, west: { dx: -1, dz: 0 } };
export const facingOf = (dir: Cardinal): Facing => FACING_OF[dir];

// the same band words `explore` has, as lengths
const BAND_LENGTH: Record<string, number> = { near: 8, "a short walk": 16, "a fair way": 24, far: TUNNEL_MAX };
export const isLengthBand = (v: unknown): boolean => typeof v === "string" && Object.hasOwn(BAND_LENGTH, v);

// a count or a band word, held to the cap; the default when it is not given
export function tunnelLength(v: number | string | undefined): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? BAND_LENGTH[v] : TUNNEL_DEFAULT;
  return Math.min(TUNNEL_MAX, Math.max(1, Math.floor(n ?? TUNNEL_DEFAULT)));
}

export type TunnelStep =
  | { kind: "blocked"; detail: string } // liquid, a drop, rock it cannot break, sand or gravel over it
  | { kind: "refused"; detail: string } // a build, or a place where digs were undone
  | { kind: "no_tool"; detail: string } // rock that wants a pickaxe it does not carry
  | { kind: "step"; dig: Pos[]; to: Pos }; // head cell first, then the feet cell, which is where it ends up

export interface Rules {
  canBreak(name: string): boolean; // whether the game lets a body break it at all
  missingTool(name: string): string | null; // words for the tool it lacks, null when it has what the block needs
}

const at = (p: Pos, dx: number, dy: number, dz: number): Pos => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
const SIX: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const key = (p: Pos) => `${p.x},${p.y},${p.z}`;

const what = (name: string) => (name === "lava" ? "lava" : "water");

// the first liquid in or next to the cells, as a body that has not broken through yet would say it
function liquidWords(g: Grid, cells: Pos[], f: Facing): string | null {
  for (const p of cells) {
    const own = g.name(p);
    if (own !== null && isLiquid(own)) return `${what(own)} ahead`;
  }
  for (const p of cells) {
    for (const [dx, dy, dz] of SIX) {
      const n = g.name(at(p, dx, dy, dz));
      if (n === null || !isLiquid(n)) continue;
      return dx === f.dx && dz === f.dz && dy === 0 ? `${what(n)} ahead` : `${what(n)} behind the wall`;
    }
  }
  return null;
}

// the grid as it will be once `p` is taken out
function withDug(g: Grid, p: Pos): Grid {
  const gone = key(p);
  return { name: (q) => (key(q) === gone ? "air" : g.name(q)), solid: (q) => key(q) !== gone && g.solid(q) };
}

// One column on from `cur`.
export function planTunnelStep(g: Grid, cur: Pos, f: Facing, rules: Rules): TunnelStep {
  const B = at(cur, f.dx, 0, f.dz);
  const A = at(B, 0, 1, 0);
  const F = at(B, 0, -1, 0);
  const names = [A, B, F].map((p) => g.name(p));
  if (names.some((n) => n === null)) return { kind: "blocked", detail: "it cannot see far enough ahead" };
  const nF = names[2] as string;

  if (isLiquid(nF)) return { kind: "blocked", detail: `${what(nF)} below` };
  if (!g.solid(F)) return { kind: "blocked", detail: "a drop ahead" };
  if (isStandHazard(nF)) return { kind: "blocked", detail: "something hot or prickly below" };
  const wet = liquidWords(g, [A, B], f);
  if (wet) return { kind: "blocked", detail: wet };

  let grid = g;
  const dig: Pos[] = [];
  for (const p of [A, B]) {
    const n = grid.name(p) as string;
    if (isMade(n)) return { kind: "refused", detail: "something a player built is in the way" };
    if (!grid.solid(p)) {
      if (isStandHazard(n)) return { kind: "blocked", detail: "something sticky or prickly in the way" };
      continue; // air, or a plant it walks through
    }
    if (!rules.canBreak(n)) return { kind: "blocked", detail: "rock it cannot break is in the way" };
    const tool = rules.missingTool(n);
    if (tool) return { kind: "no_tool", detail: `it needs ${tool}` };
    if (!safeToDig(p, grid.name)) {
      if (madeBlocksNear(p, grid.name).length > 0) return { kind: "refused", detail: "something a player built is too close" };
      const falling = [1, 2].some((dy) => {
        const over = grid.name(at(p, 0, dy, 0));
        return over !== null && isFalling(over);
      });
      return { kind: "blocked", detail: falling ? "sand or gravel overhead" : "it cannot see far enough ahead" };
    }
    dig.push(p);
    grid = withDug(grid, p);
  }
  return { kind: "step", dig, to: B };
}

// ---- the ore its walls show ----

export const isOre = (name: string): boolean => name.endsWith("_ore");

export interface WallOre {
  pos: Pos;
  name: string;
}

// The ore in the blocks around the cells just opened: left, right, over, under and ahead. Each has an open face on
// the cell it touches, so it is a block a player in the tunnel would see; nothing deeper in the rock is looked at.
export function wallOres(g: Grid, opened: Pos[]): WallOre[] {
  const inside = new Set(opened.map(key));
  const seen = new Set<string>();
  const out: WallOre[] = [];
  for (const p of opened) {
    for (const [dx, dy, dz] of SIX) {
      const q = at(p, dx, dy, dz);
      const k = key(q);
      if (inside.has(k) || seen.has(k)) continue;
      seen.add(k);
      const n = g.name(q);
      if (n !== null && isOre(n)) out.push({ pos: q, name: n });
    }
  }
  return out;
}

const label = (name: string) => name.replace(/_/g, " ");

function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// "iron ore in the wall": why a tunnel stopped
export function stopWords(names: readonly string[]): string {
  return `${list([...new Set(names)].map(label))} in the wall`;
}

// What a tunnel saw, biggest kind first, counts in words (a digit would be stripped on the way out): "two coal ore, iron ore"
export function sawWords(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([n, c]) => (c > 1 ? `${numberWords(c)} ${label(n)}` : label(n)))
    .join(", ");
}

// the status line while tunnelling: how far in, in words
export function tunnelStatus(dug: number): string {
  if (dug <= 0) return "tunnelling";
  return `tunnelling, ${numberWords(dug)} ${dug === 1 ? "block" : "blocks"}`;
}
