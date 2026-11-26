// The stair `dig_down` cuts, planned apart from the world: which way it faces, what each step digs and where the body
// stands after, when it stops. Pure, on a grid of names, so it is tested on made-up ground.
//
// Standing at S (feet cell, y), facing (dx, dz), the next step is the column c = S + facing: three blocks to take out,
// A = (c, y+1) at head height, B = (c, y) at the feet and C = (c, y-1) one down; then the body walks forward and drops
// into C. C then has B and A over it, two blocks of room, and the floor under C must already be solid. A step into stone
// is never dug (that wants a pickaxe): it stops before. With `through` (a depth was asked for) stone and deepslate are
// dug like any ground, under a tunnel's tool rules, and a cave opened into is a stop.
import { fallingWhy, fallsOver, NATURAL_STONE, isLiquid, isMade, isStandHazard, madeBlocksNear, safeToDig, type NameAt, type Pos } from "./dig-safety";

export const MAX_STEPS = 12;
export const MAX_DEPTH_STEPS = 64; // a call that was given a depth to reach
export const PROBE = 3; // steps looked at when choosing which way to face

export interface Facing {
  dx: -1 | 0 | 1;
  dz: -1 | 0 | 1;
}
export const FACINGS: readonly Facing[] = [{ dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 }, { dx: 0, dz: -1 }];

// the stone the stair stops at: natural rock that wants a pickaxe
export const STONE_STOP: ReadonlySet<string> = new Set(NATURAL_STONE);

export interface Grid {
  name: NameAt;
  solid(p: Pos): boolean; // a full block in the way: something to dig, or ground to stand on
}

export type StepPlan =
  | { kind: "stop" } // stone under it or in front
  | { kind: "blocked"; detail: string } // water, lava, a hollow, a cave, something it cannot break
  | { kind: "refused"; detail: string } // a build, a place where digs were undone, bedrock
  | { kind: "no_tool"; detail: string } // through only: rock that wants a pickaxe it does not carry
  // `settle`: the last cell of `dig` has a column of sand or gravel over it that comes down once it is dug; the plan stops
  // there, the column is cleared from beside it, and the step is planned again
  | { kind: "step"; dig: Pos[]; to: Pos; level: boolean; settle?: Pos };

// how a step is planned: `through` digs stone and deepslate instead of stopping at them, and `missingTool` is the
// tunnel's tool rule (words for the pickaxe it lacks, null when it has what the block needs)
export interface StepOpts {
  through?: boolean;
  missingTool?: (name: string) => string | null;
  cleared?: (p: Pos) => boolean; // cells it opened itself by bringing a column down: air there is not a cave
}

const at = (p: Pos, dx: number, dy: number, dz: number): Pos => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
const SIX: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// "water behind the wall", "lava below": where the liquid is, as a body that has not dug there yet would say
function liquidWords(name: string, below: boolean): string {
  const what = name === "lava" ? "lava" : "water";
  return below ? `${what} below` : `${what} behind the wall`;
}

// the first liquid next to any of the cells (or in them), as words
function liquidNear(g: Grid, cells: Pos[], extra: Pos[]): string | null {
  const bottom = cells.reduce((lowest, p) => Math.min(lowest, p.y), Infinity);
  for (const p of cells) {
    const own = g.name(p);
    if (own !== null && isLiquid(own)) return liquidWords(own, false);
    for (const [dx, dy, dz] of SIX) {
      const n = g.name(at(p, dx, dy, dz));
      if (n !== null && isLiquid(n)) return liquidWords(n, dy < 0 && p.y === bottom);
    }
  }
  for (const p of extra) {
    const n = g.name(p);
    if (n !== null && isLiquid(n)) return liquidWords(n, false);
  }
  return null;
}

// One step from `cur`. `canBreak` says whether the game lets a body break a block of that name at all.
export function planStep(g: Grid, cur: Pos, f: Facing, canBreak: (name: string) => boolean, opts: StepOpts = {}): StepPlan {
  const through = opts.through === true;
  const floor = g.name(at(cur, 0, -1, 0));
  if (!through && floor !== null && STONE_STOP.has(floor)) return { kind: "stop" };

  const c = at(cur, f.dx, 0, f.dz);
  const A = at(c, 0, 1, 0);
  const B = c;
  const C = at(c, 0, -1, 0);
  const names = [A, B, C].map((p) => g.name(p));
  if (names.some((n) => n === null)) return { kind: "blocked", detail: "it cannot see far enough ahead" };
  const [nA, nB, nC] = names as string[];
  if (!through && (STONE_STOP.has(nA) || STONE_STOP.has(nB))) return { kind: "stop" };
  // the step down would be into stone: walk on level onto it instead, and the next look finds stone underfoot
  const level = !through && STONE_STOP.has(nC);
  const dig = level ? [A, B] : [A, B, C];
  const to = level ? B : C;

  const ahead = at(c, f.dx, 0, f.dz);
  const wet = liquidNear(g, dig, level ? [] : [at(ahead, 0, -1, 0), at(ahead, 0, -2, 0)]);
  if (wet) return { kind: "blocked", detail: wet };

  if (!level) {
    const under = at(C, 0, -1, 0);
    const n = g.name(under);
    if (n === null) return { kind: "blocked", detail: "it cannot see far enough ahead" };
    if (!g.solid(under)) return { kind: "blocked", detail: "a hollow below" };
    if (isStandHazard(n)) return { kind: "blocked", detail: "something hot or prickly below" };
  }

  // under rock (three cells over the feet are solid), a dug column that is already open is a cave, not the way down
  const covered = through && g.solid(at(cur, 0, 3, 0));
  for (const p of dig) {
    const n = g.name(p) as string;
    if (!g.solid(p)) {
      if (isStandHazard(n)) return { kind: "blocked", detail: "something sticky or prickly in the way" };
      if (covered && !opts.cleared?.(p)) return { kind: "blocked", detail: "a cave opens ahead" };
      continue; // air, or a plant it walks through
    }
    if (isMade(n)) return { kind: "refused", detail: "something a player built is in the way" };
    if (!canBreak(n)) return through ? { kind: "refused", detail: "bedrock is in the way" } : { kind: "blocked", detail: "rock it cannot break is in the way" };
    const tool = through ? opts.missingTool?.(n) : null;
    if (tool) return { kind: "no_tool", detail: `it needs ${tool}` };
    // the body stands at `cur`, beside the column, never under it
    const falls = fallsOver(g.name, p);
    if (falls) {
      const why = fallingWhy(p, g.name);
      if (why) return { kind: "blocked", detail: why };
    }
    if (!safeToDig(p, g.name, falls ? cur : undefined, { clearFalling: falls })) {
      if (madeBlocksNear(p, g.name).length > 0) return { kind: "refused", detail: "something a player built is too close" };
      return { kind: "blocked", detail: "it cannot see far enough ahead" };
    }
    if (falls) return { kind: "step", dig: dig.slice(0, dig.indexOf(p) + 1), to, level, settle: p };
  }
  return { kind: "step", dig, to, level };
}

// the grid as it will be once `dug` is taken out
function withDug(g: Grid, dug: Pos[]): Grid {
  const key = (p: Pos) => `${p.x},${p.y},${p.z}`;
  const gone = new Set(dug.map(key));
  return {
    name: (p) => (gone.has(key(p)) ? "air" : g.name(p)),
    solid: (p) => !gone.has(key(p)) && g.solid(p),
  };
}

export interface Chosen {
  facing: Facing;
  steps: number; // steps that go through before anything stops it (a stop at stone counts as all)
  first: StepPlan; // what the first step says, for the words when nothing goes through
}

// The way to face: the one whose first few steps all go through, the first of `prefer` on a tie. When every way
// is stopped early the longest is taken, and the stop is found when the body gets there.
export function chooseFacing(g: Grid, start: Pos, prefer: readonly Facing[], canBreak: (name: string) => boolean, opts: StepOpts = {}): Chosen {
  let best: Chosen | null = null;
  for (const f of prefer) {
    let grid = g;
    let cur = start;
    let steps = 0;
    let first: StepPlan | null = null;
    for (; steps < PROBE; steps++) {
      const plan = planStep(grid, cur, f, canBreak, opts);
      first ??= plan;
      if (plan.kind === "stop") {
        steps = PROBE;
        break;
      }
      if (plan.kind !== "step") break;
      grid = withDug(grid, plan.dig);
      cur = plan.to;
    }
    if (!best || steps > best.steps) best = { facing: f, steps, first: first as StepPlan };
    if (steps >= PROBE) break;
  }
  return best as Chosen;
}

// the four facings with the one nearest `yaw` first (mineflayer's yaw: forward is (-sin, -cos))
export function facingsFrom(yaw: number): Facing[] {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return [...FACINGS].sort((a, b) => b.dx * fx + b.dz * fz - (a.dx * fx + a.dz * fz));
}

const NUMBERS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five", "twenty-six", "twenty-seven",
  "twenty-eight", "twenty-nine", "thirty", "thirty-one", "thirty-two",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty"];
// in words up to sixty-four, since a digit would be stripped from a detail on its way out; "many" past that
export const numberWords = (n: number): string => {
  if (n < NUMBERS.length) return NUMBERS[n] ?? "many";
  if (n > 64) return "many";
  const tens = Math.floor(n / 10);
  return n % 10 === 0 ? TENS[tens] : `${TENS[tens]}-${NUMBERS[n % 10]}`;
};

// the status line while digging: a count of steps in words
export const digStatus = (steps: number): string => (steps === 0 ? "digging down" : `digging down, ${numberWords(steps)} ${steps === 1 ? "step" : "steps"}`);

// how far down it came, with no number
export function depthWords(down: number): string {
  if (down <= 0) return "right here";
  if (down <= 2) return "a block or two down";
  if (down <= 5) return "a few blocks down";
  if (down <= 9) return "several blocks down";
  return "a long way down";
}
