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

export const BACK_RADIUS = 100; // blocks sideways, for the way back to ground the body knows
const MAX_COLUMNS = 60_000;
const BACK_NEAR = 3; // a bank this close to the target ends the search

// a water cell with nothing over it: the top of the water
const surface = (g: Grid, p: Pos) => {
  const above = g(p.x, p.y + 1, p.z);
  return swimmable(g, p) && !above.solid && above.fluid === null;
};

const SIDEWAYS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The bank that is nearest `target` among those that can be swum to, searched along the top of the water so that
// a shore a hundred blocks off is still found. For when no bank is in the quick look: ground it stood on a moment
// ago is the one place known to be dry. Null when not in water or nothing is reachable.
export function findRouteBack(g: Grid, from: Pos, target: Pos, radius = BACK_RADIUS): Route | null {
  const feet = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) };
  const start = swimmable(g, feet) ? feet : swimmable(g, { ...feet, y: feet.y - 1 }) ? { ...feet, y: feet.y - 1 } : null;
  if (!start) return null;

  const rise: Pos[] = [start];
  let top = start;
  for (let i = 0; i < 48 && !surface(g, top); i++) {
    top = { ...top, y: top.y + 1 };
    if (!swimmable(g, top)) return null; // a roof over the water
    rise.push(top);
  }

  const parent = new Map<string, Pos | null>([[key(top), null]]);
  const queue: Pos[] = [top];
  let best: { bank: Pos; at: Pos; d: number } | null = null;
  for (let i = 0; i < queue.length && i < MAX_COLUMNS; i++) {
    const cur = queue[i];
    const bank = bankBeside(g, cur);
    if (bank) {
      const d = Math.hypot(bank.x - target.x, bank.z - target.z);
      if (!best || d < best.d) best = { bank, at: cur, d };
      if (d <= BACK_NEAR) break;
    }
    for (const [dx, dz] of SIDEWAYS) {
      const x = cur.x + dx;
      const z = cur.z + dz;
      if (Math.max(Math.abs(x - top.x), Math.abs(z - top.z)) > radius) continue;
      const next = [cur.y, cur.y + 1, cur.y - 1].map((y) => ({ x, y, z })).find((p) => surface(g, p));
      if (!next || parent.has(key(next))) continue;
      parent.set(key(next), cur);
      queue.push(next);
    }
  }
  if (!best) return null;

  const along: Pos[] = [best.bank];
  for (let p: Pos | null | undefined = best.at; p; p = parent.get(key(p))) along.unshift(p);
  return { bank: best.bank, path: [...rise.slice(0, -1), ...along] };
}

// The way out of the water: the nearest bank and then the way back to known ground, or the other way round
// (`prefer`) for a walk that wants to be back where it was.
export function wayOut(g: Grid, from: Pos, back: Pos | null, prefer: "bank" | "footing" = "bank"): Route | null {
  const bank = () => findBank(g, from);
  const home = () => (back ? findRouteBack(g, from, back) : null);
  return prefer === "bank" ? (bank() ?? home()) : (home() ?? bank());
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
