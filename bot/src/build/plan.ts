// From a blueprint, an origin and a facing: the cells in world coordinates in a build order, what they cost, and an
// audit against the world. Pure; the world comes in as nameAt. Nothing here places a block.
import type { NameAt, Pos } from "../lib/block-rules";
import { faceTo, type Blueprint, type Cell, type Dir } from "./blueprint";

// the most blocks one job may set down; policy.ts's per-job placing budget is smaller and is the build runner's problem
export const MAX_JOB_CELLS = 1024;
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 319;

export type Placement = Pos & { block: string };
export type Plan = {
  name: string;
  origin: Pos;
  facing: Dir;
  // build order: lowest layer first, each cell after something that holds it
  cells: Placement[];
  // cells with no chain of blocks down to the origin layer; they need scaffolding or a block below that is not in the plan
  unsupported: Placement[];
  materials: Record<string, number>;
  min: Pos;
  max: Pos;
};
export type MadePlan = { ok: true; plan: Plan } | { ok: false; problems: string[] };

const SPREAD: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
// a torch hangs off a block; nothing is placed against it
const holds = (block: string): boolean => block !== "torch";

type Local = { x: number; y: number; z: number; block: string };

// Order from the cells alone, so a shuffled input gives the same sequence and a resumed job can take the full order
// and skip what is done. Per layer: cells sitting on the origin layer or on a holding cell below first, then outward
// through neighbours; whatever never gets reached is flagged unsupported and goes last in raster order.
export function buildOrder(cells: readonly Local[]): { ordered: Local[]; unsupported: Local[] } {
  const at = new Map(cells.map((c) => [key(c.x, c.y, c.z), c]));
  const raster = (a: Local, b: Local): number => a.z - b.z || a.x - b.x;
  const layers = new Map<number, Local[]>();
  for (const c of cells) layers.set(c.y, [...(layers.get(c.y) ?? []), c]);

  const held = new Set<string>(); // supported cells that something can be placed against
  const ordered: Local[] = [];
  const unsupported: Local[] = [];
  for (const y of [...layers.keys()].sort((a, b) => a - b)) {
    const layer = layers.get(y)!.sort(raster);
    const done = new Set<string>();
    const queue: Local[] = layer.filter((c) => y === 0 || held.has(key(c.x, y - 1, c.z)));
    for (const c of queue) done.add(key(c.x, y, c.z));
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      ordered.push(c);
      if (!holds(c.block)) continue;
      held.add(key(c.x, y, c.z));
      for (const [dx, dz] of SPREAD) {
        const n = at.get(key(c.x + dx, y, c.z + dz));
        if (n && !done.has(key(n.x, y, n.z))) {
          done.add(key(n.x, y, n.z));
          queue.push(n);
        }
      }
    }
    for (const c of layer) if (!done.has(key(c.x, y, c.z))) {
      ordered.push(c);
      unsupported.push(c);
    }
  }
  return { ordered, unsupported };
}

const worldOf = (c: Local, o: Pos): Placement => ({ x: o.x + c.x, y: o.y + c.y, z: o.z + c.z, block: c.block });

// `origin` is the lowest corner of the build after it is turned to `facing`
export function makePlan(bp: Blueprint, origin: Pos, facing: Dir, maxCells: number = MAX_JOB_CELLS): MadePlan {
  const bad: string[] = [];
  if (![origin.x, origin.y, origin.z].every(Number.isInteger)) bad.push("the origin must be whole block positions");
  if (bp.cells.length > maxCells) bad.push(`${bp.cells.length} blocks is over the ${maxCells} one job may place; split it into parts`);
  if (origin.y + bp.size.y - 1 > WORLD_MAX_Y || origin.y < WORLD_MIN_Y) bad.push(`that does not fit between height ${WORLD_MIN_Y} and ${WORLD_MAX_Y}`);
  if (bad.length) return { ok: false, problems: bad };

  const turned = faceTo(bp, facing);
  const local: Local[] = turned.cells.map((c: Cell) => ({ x: c.x, y: c.y, z: c.z, block: turned.palette[c.p] }));
  const { ordered, unsupported } = buildOrder(local);

  const materials: Record<string, number> = {};
  for (const c of ordered) materials[c.block] = (materials[c.block] ?? 0) + 1;
  return {
    ok: true,
    plan: {
      name: bp.name,
      origin,
      facing,
      cells: ordered.map((c) => worldOf(c, origin)),
      unsupported: unsupported.map((c) => worldOf(c, origin)),
      materials,
      min: { ...origin },
      max: { x: origin.x + turned.size.x - 1, y: origin.y + turned.size.y - 1, z: origin.z + turned.size.z - 1 },
    },
  };
}

export type Audit = {
  total: number;
  done: number;
  wrong: Array<Placement & { have: string }>;
  // not loaded, so neither right nor wrong yet
  unknown: Placement[];
};

// a torch on a wall reads back as wall_torch
const matches = (want: string, have: string): boolean => have === want || (want === "torch" && have === "wall_torch");

export function audit(plan: Plan, nameAt: NameAt): Audit {
  const out: Audit = { total: plan.cells.length, done: 0, wrong: [], unknown: [] };
  for (const c of plan.cells) {
    const have = nameAt(c);
    if (have === null) out.unknown.push(c);
    else if (matches(c.block, have)) out.done++;
    else out.wrong.push({ ...c, have });
  }
  return out;
}

// what is left to do, in the plan's own order; a resumed job walks this
export function remaining(plan: Plan, nameAt: NameAt): Placement[] {
  return plan.cells.filter((c) => {
    const have = nameAt(c);
    return have === null || !matches(c.block, have);
  });
}
