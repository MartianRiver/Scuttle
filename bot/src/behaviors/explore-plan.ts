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
// straight on, then the detours: the turns a leg may take, in order
export const ANGLES = [0, ...DETOURS] as const;

// What one column of the world is, for a body that must keep its feet dry: "deep" water is 2 or more blocks, a
// body in it cannot stand; "shallow" is a wade; "unknown" is not loaded.
export type Column = "dry" | "shallow" | "deep" | "lava" | "unknown";

export const LOOK_PAST = 4; // columns checked beyond a leg's end, so a leg never ends at the lip of the sea
export const SCAN = 48; // columns along the compass line looked at to say how wide the water is

// the columns (as block cells) a straight walk from `from` to `to` passes over, then `past` more along the same line
export function lineCells(from: Spot, to: Spot, past = 0): Spot[] {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  if (len < 1e-6) return [];
  const ux = (to.x - from.x) / len;
  const uz = (to.z - from.z) / len;
  const out: Spot[] = [];
  let last = "";
  for (let d = 1; d <= len + past; d++) {
    const x = Math.floor(from.x + ux * d);
    const z = Math.floor(from.z + uz * d);
    const key = `${x},${z}`;
    if (key === last) continue;
    last = key;
    out.push({ x, z });
  }
  return out;
}

// the first thing along the way that a body must not walk into (deep water, lava), or null
export function firstHazard(cols: readonly Column[]): { at: number; kind: "deep" | "lava" } | null {
  const at = cols.findIndex((c) => c === "deep" || c === "lava");
  return at < 0 ? null : { at, kind: cols[at] as "deep" | "lava" };
}

export const SEA_WIDTH = 24; // wet columns in a row that make it the sea
export const LAKE_WIDTH = 6;

// What is in the way along a compass line, in words that carry no number: from the first deep column to the
// first dry one, how wide the water is, or still water where the look ends. Null when the way is clear.
export function wetWords(dir: CompassPoint, cols: readonly Column[]): string | null {
  const hit = firstHazard(cols);
  if (!hit) return null;
  if (hit.kind === "lava") return `lava to the ${dir}`;
  let wet = 0;
  let open = true;
  for (let i = hit.at; i < cols.length; i++) {
    if (cols[i] === "dry") {
      open = false;
      break;
    }
    wet++;
  }
  if (open || wet >= SEA_WIDTH) return `the sea to the ${dir}`;
  return wet >= LAKE_WIDTH ? `a lake to the ${dir}` : `a river to the ${dir}`;
}

// a walk may take about this long: the way there at a walking pace, with room for the pathfinder's detours
export const budgetMs = (far: ExploreBand = DEFAULT_BAND): number => Math.min(6 * 60_000, 40_000 + EDGE[far] * 2_500);

export type Ahead = "open" | "water" | "lava" | "wall" | "drop";

// what stopped it, from what lies in the cells ahead (nearest first), in words that carry no number
export function blockedWords(dir: CompassPoint, ahead: readonly Ahead[]): string {
  const first = ahead.find((a) => a !== "open");
  switch (first) {
    case "water":
      return `water to the ${dir}`; // how wide it is comes from wetWords, which looks further than these cells
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
