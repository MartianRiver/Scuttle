// The numbers and small decisions of `explore`: where a band and a compass point lead, the leash, the legs,
// what stopped a walk in words, and what was newly in view. Pure and tested; positions stay in here and
// only words go out.
import type { CompassPoint, ExploreBand } from "../api/protocol";

export const LEASH = 160; // blocks from home it will not go past
export const DEFAULT_BAND: ExploreBand = "a short walk";
// each band's upper edge in blocks from where it started (the observation scale: near 16, a short walk 32, a fair way 48, far 128)
export const EDGE: Record<ExploreBand, number> = { near: 16, "a short walk": 32, "a fair way": 48, far: 128 };
export const LEG = 14; // one walk toward the target, always inside loaded chunks
export const ARRIVED = 3; // blocks from the target counted as there

export interface Spot {
  x: number;
  z: number;
}

const D = Math.SQRT1_2;
// north is -z, east is +x
const UNIT: Record<CompassPoint, Spot> = {
  north: { x: 0, z: -1 },
  "north-east": { x: D, z: -D },
  east: { x: 1, z: 0 },
  "south-east": { x: D, z: D },
  south: { x: 0, z: 1 },
  "south-west": { x: -D, z: D },
  west: { x: -1, z: 0 },
  "north-west": { x: -D, z: -D },
};

// short of the edge so a walk that stops a little early is still inside the band
export function aimPoint(start: Spot, dir: CompassPoint, far: ExploreBand = DEFAULT_BAND): Spot {
  const reach = EDGE[far] - 2;
  return { x: start.x + UNIT[dir].x * reach, z: start.z + UNIT[dir].z * reach };
}

export const tooFar = (target: Spot, home: Spot): boolean => Math.hypot(target.x - home.x, target.z - home.z) > LEASH;

const away = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);
export const arrived = (at: Spot, goal: Spot): boolean => away(at, goal) <= ARRIVED;

// the point of the next walk: toward the goal, turned by `degrees` (a detour around what blocked the way), at most one leg off
export function legTo(from: Spot, goal: Spot, degrees = 0, step = LEG): Spot {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const turn = (degrees * Math.PI) / 180;
  const ux = (dx * Math.cos(turn) - dz * Math.sin(turn)) / len;
  const uz = (dx * Math.sin(turn) + dz * Math.cos(turn)) / len;
  const run = degrees === 0 ? Math.min(step, len) : step;
  return { x: from.x + ux * run, z: from.z + uz * run };
}

// the order detours are tried in when the straight way is stuck
export const DETOURS = [45, -45, 90, -90] as const;

// a walk may take about this long: the way there at a walking pace, with room for the pathfinder's detours
export const budgetMs = (far: ExploreBand = DEFAULT_BAND): number => Math.min(6 * 60_000, 40_000 + EDGE[far] * 2_500);

export type Ahead = "open" | "water" | "lava" | "wall" | "drop";

// what stopped it, from what lies in the cells ahead (nearest first), in words that carry no number
export function blockedWords(dir: CompassPoint, ahead: readonly Ahead[]): string {
  const first = ahead.find((a) => a !== "open");
  const water = ahead.filter((a) => a === "water").length;
  switch (first) {
    case "water":
      return water >= 3 ? `the sea to the ${dir}` : `water to the ${dir}`;
    case "lava":
      return `lava to the ${dir}`;
    case "wall":
      return `a cliff to the ${dir}`;
    case "drop":
      return `a drop to the ${dir}`;
    default:
      return `no way through to the ${dir}`;
  }
}

export interface Kinds {
  trees: boolean;
  stone: boolean;
  ores: string[];
  water: boolean;
  lava: boolean;
  doors: boolean;
  players: boolean;
}

export const noKinds = (): Kinds => ({ trees: false, stone: false, ores: [], water: false, lava: false, doors: false, players: false });

interface Sight {
  blocks: ReadonlyArray<{ what: string }>;
  near: ReadonlyArray<{ k?: string }>;
  stone?: string;
}

// the kinds in one look
export function kindsIn(look: Sight): Kinds {
  const k = noKinds();
  for (const { what } of look.blocks) {
    if (/^(?!stripped_)\w+_log$/.test(what)) k.trees = true;
    else if (what.endsWith("_ore") || what === "ancient_debris") k.ores.push(what.replace(/_/g, " "));
    else if (what === "water") k.water = true;
    else if (what === "lava") k.lava = true;
    else if (what.endsWith("_door") && !what.includes("trapdoor")) k.doors = true;
  }
  k.stone = look.stone !== undefined;
  k.players = look.near.some((n) => n.k === "player");
  k.ores = [...new Set(k.ores)];
  return k;
}

export function mergeKinds(a: Kinds, b: Kinds): Kinds {
  return {
    trees: a.trees || b.trees,
    stone: a.stone || b.stone,
    ores: [...new Set([...a.ores, ...b.ores])],
    water: a.water || b.water,
    lava: a.lava || b.lava,
    doors: a.doors || b.doors,
    players: a.players || b.players,
  };
}

const MAX_SAW = 8;

// the kinds seen on the way that were not in view at the start, as one short line of words ("" when nothing new)
export function sawWords(start: Kinds, all: Kinds): string {
  const out: string[] = [];
  if (all.trees && !start.trees) out.push("trees");
  if (all.stone && !start.stone) out.push("stone");
  for (const ore of all.ores) if (!start.ores.includes(ore)) out.push(ore);
  if (all.water && !start.water) out.push("water");
  if (all.lava && !start.lava) out.push("lava");
  if (all.doors && !start.doors) out.push("doors");
  if (all.players && !start.players) out.push("players");
  return out.slice(0, MAX_SAW).join(", ");
}
