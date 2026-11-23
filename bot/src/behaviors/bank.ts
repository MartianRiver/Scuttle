// The way out of deep water, when the shore is farther than the quick look in hazard.ts reaches: a
// search through the water itself, so the answer is a bank the body can actually swim to. Pure, on the
// same Grid as hazard.ts.
import { standable, type Grid, type Pos } from "./hazard";

export const BANK_RADIUS = 24; // blocks from the body, sideways
const MAX_CELLS = 30_000;

export interface Route {
  bank: Pos; // a cell it can stand on, beside the water, 2 air above
  path: Pos[]; // the water cells from the body's, ending at the bank
}

const key = (p: Pos) => `${p.x},${p.y},${p.z}`;
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

const swimmable = (g: Grid, p: Pos) => {
  const c = g(p.x, p.y, p.z);
  return c.fluid === "water" && !c.solid;
};

// a standable cell beside a water cell that has air over it: flush with the surface, or one step up
function bankBeside(g: Grid, w: Pos): Pos | null {
  const above = g(w.x, w.y + 1, w.z);
  if (above.solid || above.fluid !== null) return null; // not the surface
  for (const [dx, , dz] of STEPS.slice(0, 4)) {
    for (const up of [1, 2]) {
      const p = { x: w.x + dx, y: w.y + up, z: w.z + dz };
      if (standable(g, p.x, p.y, p.z)) return p;
    }
  }
  return null;
}

// nearest bank by swimming; null when it is not in water, or no bank is in reach (a pit with walls)
export function findBank(g: Grid, from: Pos, radius = BANK_RADIUS): Route | null {
  const feet = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) };
  const start = swimmable(g, feet) ? feet : swimmable(g, { ...feet, y: feet.y - 1 }) ? { ...feet, y: feet.y - 1 } : null;
  if (!start) return null;

  const parent = new Map<string, Pos | null>([[key(start), null]]);
  const queue: Pos[] = [start];
  for (let i = 0; i < queue.length && i < MAX_CELLS; i++) {
    const cur = queue[i];
    const bank = bankBeside(g, cur);
    if (bank) {
      const path: Pos[] = [bank];
      for (let p: Pos | null | undefined = cur; p; p = parent.get(key(p))) path.unshift(p);
      return { bank, path };
    }
    for (const [dx, dy, dz] of STEPS) {
      const n = { x: cur.x + dx, y: cur.y + dy, z: cur.z + dz };
      if (Math.max(Math.abs(n.x - feet.x), Math.abs(n.z - feet.z)) > radius || parent.has(key(n)) || !swimmable(g, n)) continue;
      parent.set(key(n), cur);
      queue.push(n);
    }
  }
  return null;
}

// Where to head from `at`: past the cell of the route it is nearest to, the first one more than a block
// away sideways; the bank when none is left.
export function waypoint(route: Route, at: Pos): Pos {
  const dist = (p: Pos) => Math.hypot(p.x + 0.5 - at.x, p.y + 0.5 - at.y, p.z + 0.5 - at.z);
  let here = 0;
  route.path.forEach((p, i) => {
    if (dist(p) <= dist(route.path[here])) here = i;
  });
  for (const p of route.path.slice(here + 1)) {
    if (Math.hypot(p.x + 0.5 - at.x, p.z + 0.5 - at.z) > 1.2) return p;
  }
  return route.bank;
}
