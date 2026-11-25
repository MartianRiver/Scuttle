// What `clear_trees` works out apart from the world: the square around the base, which trees are in it, the order,
// what to sweep up after, which leaves go with a felled tree, when to stop and how the end is told. Pure and tested.
import { numberWords } from "./dig-down-plan";
import type { Pos } from "./dig-safety";

const DETAIL_MAX = 120; // what api/events.ts lets a detail be
export const CLEAR_DEFAULT = 9; // half-width of the square: nineteen across
export const CLEAR_MIN = 3;
export const CLEAR_MAX = 16;
export const EDGE = 4; // trees this close outside the square are counted as left standing at its edge
export const RING = 4; // the sweep for drops goes this far past the square
const Y_BELOW = 12;
const Y_ABOVE = 20;

export const clearRadius = (r: number | undefined): number => Math.min(CLEAR_MAX, Math.max(CLEAR_MIN, Math.round(r ?? CLEAR_DEFAULT)));

export interface Box {
  x: number;
  y: number;
  z: number; // the base's crafting table
  r: number;
}

// `margin` widens the square sideways only
export function inBox(box: Box, p: Pos, margin = 0): boolean {
  return Math.abs(p.x - box.x) <= box.r + margin && Math.abs(p.z - box.z) <= box.r + margin && p.y >= box.y - Y_BELOW && p.y <= box.y + Y_ABOVE;
}

const key = (p: { x: number; z: number }) => `${p.x},${p.z}`;
const flat = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);

export interface Tree {
  base: Pos; // the lowest log of the trunk
  columns: Pos[]; // every trunk column at that level (one, or four for a thick trunk)
}

export interface Survey {
  inside: Tree[]; // natural trees whose whole trunk is in the square
  edge: number; // natural trees left standing just outside it (a trunk part in, part out counts here)
  notNatural: number; // logs in the square that are no tree: a post, a bare trunk, a cabin
}

// `picked` are the natural trees' base logs (senses/trees.ts pickTrees), `bases` every base log found in and around the
// square. `columnsOf` gives a trunk's columns at ground level. A tree whose every column is in the square is inside; one with
// a column out is left standing, which is the safe side for a trunk on the line.
export function survey(box: Box, picked: readonly Pos[], bases: readonly Pos[], columnsOf: (base: Pos) => Pos[]): Survey {
  const inside: Tree[] = [];
  let edge = 0;
  const natural = new Set<string>();
  for (const base of picked) {
    const columns = columnsOf(base);
    for (const c of columns) natural.add(key(c));
    if (columns.every((c) => inBox(box, c))) inside.push({ base, columns });
    else if (columns.some((c) => inBox(box, c, EDGE))) edge++;
  }
  // a base nobody picked, in the square, is no tree; a thick trunk's other columns are the same trunk
  const seen = new Set<string>();
  let notNatural = 0;
  for (const b of bases) {
    if (!inBox(box, b) || natural.has(key(b)) || seen.has(key(b))) continue;
    seen.add(key(b));
    for (const c of columnsOf(b)) seen.add(key(c));
    notNatural++;
  }
  return { inside, edge, notNatural };
}

// the tree nearest the body, level distance; a tie goes to the lower x then z so the order never wobbles
export function nextTree<T extends { base: Pos }>(trees: readonly T[], from: Pos): T | undefined {
  return [...trees].sort((a, b) => flat(a.base, from) - flat(b.base, from) || a.base.x - b.base.x || a.base.z - b.base.z)[0];
}

// ---- drops ----

// what a tree gives up: logs (not stripped, which is something a player made), saplings, apples, sticks. Nothing else lying in
// the square is the body's to take.
export const wantedDrop = (name: string): boolean => /^(?!stripped_)\w+_log$/.test(name) || /_(sapling|propagule)$/.test(name) || name === "apple" || name === "stick";

export interface Drop {
  id: number;
  name: string | undefined; // unknown until the item data arrives; counts as wanted then, like pickUp's own rule
  pos: Pos;
}

export const SWEEP_TRIES = 2; // walks to one drop
const SWEEP_UP = 8; // a drop this far over (or under) the body is on a canopy or in a pit
export const SWEEP_ROUND_MS = 20_000; // after a tree
export const SWEEP_END_MS = 40_000; // the last one

// the drops to walk to, nearest first: in the square and its ring, of a wanted kind, tried fewer than the cap and not out of reach
// up or down
export function sweepList(drops: readonly Drop[], box: Box, from: Pos, tries: ReadonlyMap<number, number>, maxTries = SWEEP_TRIES): Drop[] {
  const dist = (d: Drop) => Math.hypot(d.pos.x - from.x, d.pos.y - from.y, d.pos.z - from.z);
  return drops
    .filter((d) => (d.name === undefined || wantedDrop(d.name)) && inBox(box, d.pos, RING) && (tries.get(d.id) ?? 0) < maxTries && Math.abs(d.pos.y - from.y) <= SWEEP_UP)
    .sort((a, b) => dist(a) - dist(b) || a.id - b.id);
}

// ---- leaves ----

export const LEAF_REACH_H = 3; // a leaf belongs to a trunk this near, sideways
const LEAF_UP = 8;
const KEPT_NEAR = 2; // a leaf this near a log still standing is that tree's
export const LEAVES_PER_TREE = 24;
export const LEAF_ROUND_MS = 25_000;

// The natural leaves of a felled tree to break: those around its trunk columns that no standing log claims. `logAt` is a log that
// stays (another tree's, never this trunk's floating top); `leafAt` a natural leaf. Order is for the caller to pick.
export function pickLeaves(columns: readonly Pos[], leafAt: (p: Pos) => boolean, logAt: (p: Pos) => boolean): Pos[] {
  const out = new Map<string, Pos>();
  const claimed = (p: Pos): boolean => {
    for (let dx = -KEPT_NEAR; dx <= KEPT_NEAR; dx++)
      for (let dz = -KEPT_NEAR; dz <= KEPT_NEAR; dz++) for (let dy = -3; dy <= 3; dy++) if (logAt({ x: p.x + dx, y: p.y + dy, z: p.z + dz })) return true;
    return false;
  };
  for (const col of columns) {
    for (let dx = -LEAF_REACH_H; dx <= LEAF_REACH_H; dx++) {
      for (let dz = -LEAF_REACH_H; dz <= LEAF_REACH_H; dz++) {
        for (let dy = 1; dy <= LEAF_UP; dy++) {
          const p = { x: col.x + dx, y: col.y + dy, z: col.z + dz };
          const k = `${p.x},${p.y},${p.z}`;
          if (!out.has(k) && leafAt(p) && !claimed(p)) out.set(k, p);
        }
      }
    }
  }
  return [...out.values()];
}

export const nearestTo = <T extends Pos>(cells: readonly T[], from: Pos): T[] =>
  [...cells].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y, a.z - from.z) - Math.hypot(b.x - from.x, b.y - from.y, b.z - from.z) || a.x - b.x || a.z - b.z || a.y - b.y);

// ---- the ground ----

// The small plants that stop a building spot being ready: every flower (tall ones too), mushrooms, saplings, berry bushes, leaf litter and
// the like. Grass and ferns are not here, a block can be set down on them already; wither roses stay, they hurt to touch.
const PLANTS = /^(dandelion|poppy|blue_orchid|allium|azure_bluet|(red|orange|white|pink)_tulip|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|open_eyeblossom|closed_eyeblossom|sunflower|lilac|rose_bush|peony|pitcher_plant|wildflowers|pink_petals|leaf_litter|brown_mushroom|red_mushroom|sweet_berry_bush|bush|firefly_bush|short_dry_grass|tall_dry_grass|cactus_flower)$/;
export const isGroundPlant = (name: string): boolean => PLANTS.test(name) || /_sapling$/.test(name);

export const PLANTS_MAX = 150;
export const PLANT_ROUND_MS = 180_000;

// ---- the pack ----

export const NEAR_FULL_SLOTS = 2; // free slots at or under this: stash first
export const KEEP_SAPLINGS = 4; // of each kind
export const KEEP_APPLES = 16; // food, as `store` keeps it
export const STASH_WALK_MAX = 48; // blocks from the nearest base chest; farther and it ends in words instead of walking back

export const packNearlyFull = (emptySlots: number): boolean => emptySlots <= NEAR_FULL_SLOTS;

export type Counts = Record<string, number>;

// what to put in the stash from what is carried: every log and stick, saplings past a few of each kind, apples past a day's food.
// Tools, food of other kinds and everything else stay.
export function stashPlan(carried: Counts): Array<{ item: string; count: number }> {
  const out: Array<{ item: string; count: number }> = [];
  for (const [item, n] of Object.entries(carried)) {
    let count = 0;
    if (/^(?!stripped_)\w+_log$/.test(item) || item === "stick") count = n;
    else if (/_(sapling|propagule)$/.test(item)) count = n - KEEP_SAPLINGS;
    else if (item === "apple") count = n - KEEP_APPLES;
    if (count > 0) out.push({ item, count });
  }
  return out.sort((a, b) => b.count - a.count || a.item.localeCompare(b.item));
}

// ---- stopping ----

export const MAX_MS = 20 * 60_000;
export const STUCK_TREES = 3; // trees in a row that gave nothing
export const ZONE_CAP = 3; // trees where the server undid a dig

export interface RunState {
  elapsedMs: number;
  stuckInARow: number;
  undone: number;
}

export type StopWhy = "time" | "stuck" | "protected";

export function stopWhy(s: RunState): StopWhy | null {
  if (s.undone >= ZONE_CAP) return "protected";
  if (s.stuckInARow >= STUCK_TREES) return "stuck";
  if (s.elapsedMs >= MAX_MS) return "time";
  return null;
}

// ---- the words ----

// the items a run reports: one kind of log first, then the saplings, the apples and the sticks, then the rest by count; saplings and apples
// are what a count of four would otherwise hide behind a forest of logs
export function rankGot(net: Counts, max = 4): Counts {
  const entries = Object.entries(net).filter(([, n]) => n > 0);
  const isLog = (name: string) => /^(?!stripped_)\w+_log$/.test(name);
  const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
  const firstLog = entries.filter(([k]) => isLog(k)).sort(byCount)[0];
  // after the first log: saplings, apples, sticks, then everything else (other logs included) by count
  const rank = (name: string): number => (/_(sapling|propagule)$/.test(name) ? 1 : name === "apple" ? 2 : name === "stick" ? 3 : 4);
  const rest = entries.filter((e) => e !== firstLog).sort((a, b) => rank(a[0]) - rank(b[0]) || byCount(a, b));
  return Object.fromEntries((firstLog ? [firstLog, ...rest] : rest).slice(0, max));
}

export function timeWords(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (ms < 60_000) return "under a minute";
  return min === 1 ? "about a minute" : `about ${numberWords(min)} minutes`;
}

const trees = (n: number) => `${numberWords(n)} ${n === 1 ? "tree" : "trees"}`;

export interface Tally {
  felled: number;
  edge: number;
  notNatural: number;
  refused: number;
  unreachable: number;
  tall: number; // felled trees with logs left above where the body can reach
  plants: number; // small plants broken on the ground
  ms: number;
  ended?: string; // why it stopped early, in words
}

// "felled six trees, cleared twelve plants, left two at the edge; about three minutes": no digit, and cut to fit the 120 characters a
// detail gets by dropping the least telling parts first (the tall ones, then not natural, out of reach, refused, the edge, the plants)
export function endWords(t: Tally): string {
  const optional: Array<[boolean, string]> = [
    [t.edge > 0, `${numberWords(t.edge)} at the edge`],
    [t.refused > 0, `${numberWords(t.refused)} refused`],
    [t.unreachable > 0, `${numberWords(t.unreachable)} out of reach`],
    [t.notNatural > 0, `${numberWords(t.notNatural)} not natural`],
  ];
  const tail = [t.ended, timeWords(t.ms)].filter(Boolean).join("; ");
  const words = (keep: number, tall: boolean, plants: boolean): string => {
    const left = optional.filter(([on]) => on).map(([, w]) => w).slice(0, keep);
    const parts = [`felled ${t.felled === 0 ? "none" : trees(t.felled)}`];
    if (plants && t.plants > 0) parts.push(`cleared ${numberWords(t.plants)} ${t.plants === 1 ? "plant" : "plants"}`);
    if (left.length > 0) parts.push(`left ${left.join(", ")}`);
    if (tall && t.tall > 0) parts.push(`${numberWords(t.tall)} tall, tops left`);
    return `${parts.join(", ")}; ${tail}`;
  };
  for (const plants of [true, false])
    for (const tall of [true, false]) for (let keep = optional.length; keep >= 0; keep--) if (words(keep, tall, plants).length <= DETAIL_MAX) return words(keep, tall, plants);
  return words(0, false, false).slice(0, DETAIL_MAX);
}
