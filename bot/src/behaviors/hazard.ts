// The decision half of the self-preservation reflex: what the body is standing in, and the nearest
// cell that is better. Free of mineflayer, so the logic is testable on a made-up grid.

export type Hazard = "lava" | "fire" | "drowning" | "burning";

export interface Sense {
  inLava: boolean;
  inFire: boolean;
  headInWater: boolean;
  feetInWater: boolean;
  oxygen: number; // 0..20, 20 when the server has said nothing
  burning: boolean; // recently in lava or fire, and not yet in water
}

export interface Cell {
  solid: boolean;
  fluid: "water" | "lava" | null;
  fire: boolean;
  // what landing in it does to a fall: soft ends it unharmed (slime, powder snow), cushion cuts it to a
  // fifth (hay, honey), reset wipes what was fallen so far and the drop below still counts (vines, cobweb)
  fall?: "soft" | "cushion" | "reset";
}

export type Grid = (x: number, y: number, z: number) => Cell;
export interface Pos {
  x: number;
  y: number;
  z: number;
}

// air runs out at 20 and drowning starts at 0, so there is time; swimming up starts well before the end
const BREATH_LOW = 12;

// `prev` keeps a drowning rescue going until the body is out of the water, not just until it has air
export function classify(s: Sense, prev: Hazard | null = null): Hazard | null {
  if (s.inLava) return "lava";
  if (s.inFire) return "fire";
  if (s.headInWater && s.oxygen <= BREATH_LOW) return "drowning";
  if (prev === "drowning" && s.feetInWater) return "drowning";
  if (s.burning) return "burning";
  return null;
}

export const standable = (g: Grid, x: number, y: number, z: number): boolean => {
  const feet = g(x, y, z);
  const head = g(x, y + 1, z);
  const floor = g(x, y - 1, z);
  return !feet.solid && !head.solid && feet.fluid === null && !feet.fire && floor.solid && floor.fluid !== "lava";
};

// Nearest cell to head for: dry standing room for lava, fire and drowning, water to put out a burn.
// `vet` checks a candidate only when it would be the new nearest, so an expensive check stays cheap.
export function findCell(hazard: Hazard, g: Grid, from: Pos, radius = 8, vet?: (p: Pos) => boolean): Pos | null {
  const x0 = Math.floor(from.x);
  const y0 = Math.floor(from.y);
  const z0 = Math.floor(from.z);
  let best: Pos | null = null;
  let bestD = Infinity;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -2; dy <= radius; dy++) {
        const x = x0 + dx;
        const y = y0 + dy;
        const z = z0 + dz;
        const ok = hazard === "burning" ? g(x, y, z).fluid === "water" : standable(g, x, y, z);
        if (!ok) continue;
        const d = dx * dx + dz * dz + dy * dy * 2; // going up is slower than going sideways
        if (d < bestD && (!vet || vet({ x, y, z }))) {
          bestD = d;
          best = { x, y, z };
        }
      }
    }
  }
  return best;
}

// Out of lava or fire, or off a burn: water close by does both at once, otherwise dry standing room.
// The walk there is by hand, so a way out across a drop is passed over; out of lava or deep water a
// fall still beats staying, so those take an unsafe one when there is nothing else.
export function findEscape(hazard: Hazard, g: Grid, from: Pos): Pos | null {
  const safe = (p: Pos) => pathSafe(g, from, p);
  if (hazard === "drowning") return findCell("drowning", g, from, 8, safe) ?? findCell("drowning", g, from);
  const out = findCell("burning", g, from, 6, safe) ?? findCell("lava", g, from, 8, safe);
  if (out || hazard !== "lava") return out;
  return findCell("burning", g, from, 6) ?? findCell("lava", g, from);
}

// Falls: damage starts past this many blocks
export const SAFE_DROP = 3;

export type Stop = "hard" | "soft" | "cushion" | "lava";

export interface Landing {
  depth: number; // empty cells between the cell at y and what stops the fall
  stop: Stop;
  reset: boolean; // a vine or cobweb on the way wiped the fall above it
  fall: number; // blocks of it that count: all of depth, or only what lies below the last reset
}

// What stops a fall from the cell at y down. Soft and cushion are looked at before solid: slime and
// hay are full blocks to the planner. A ladder's top counts as ground, so ladders are left as solid.
export function landing(g: Grid, x: number, y: number, z: number, max = 40): Landing {
  let resetAt = -1;
  for (let d = 0; d <= max; d++) {
    const c = g(x, y - 1 - d, z);
    const done = (stop: Stop): Landing => ({ depth: d, stop, reset: resetAt >= 0, fall: resetAt >= 0 ? d - resetAt - 1 : d });
    if (c.fluid === "water" || c.fall === "soft") return done("soft");
    if (c.fall === "cushion") return done("cushion");
    if (c.fluid === "lava") return done("lava");
    if (c.solid) return done("hard");
    if (c.fall === "reset") resetAt = d;
  }
  return { depth: max + 1, stop: "hard", reset: resetAt >= 0, fall: max + 1 };
}

// whether a fall of `fall` blocks onto `stop` costs health
export function hurts(stop: Stop, fall: number): boolean {
  if (stop === "lava") return true;
  if (stop === "soft") return false;
  const damage = fall - SAFE_DROP;
  return stop === "cushion" ? damage * 0.2 >= 1 : damage > 0;
}

// Whether walking straight from `from` to `to` keeps off any drop over SAFE_DROP and out of lava.
// The feet follow the ground: up a one-block step, down a safe drop. A wall the body can't step
// up ends the check as safe; walking into it is not a fall.
export function pathSafe(g: Grid, from: Pos, to: Pos): boolean {
  const tx = to.x + 0.5;
  const tz = to.z + 0.5;
  const steps = Math.ceil(Math.hypot(tx - from.x, tz - from.z) / 0.25);
  let y = Math.floor(from.y);
  let last = "";
  for (let i = 1; i <= steps; i++) {
    const x = Math.floor(from.x + ((tx - from.x) * i) / steps);
    const z = Math.floor(from.z + ((tz - from.z) * i) / steps);
    const key = `${x},${z}`;
    if (key === last) continue;
    last = key;
    if (g(x, y, z).solid) {
      if (g(x, y + 1, z).solid || g(x, y + 2, z).solid) return true;
      y += 1;
      continue;
    }
    const land = landing(g, x, y, z);
    if (hurts(land.stop, land.fall)) return false;
    y -= land.depth;
  }
  return true;
}

// How far sideways the body can still steer while falling `height` more blocks from vertical speed
// `vy` (blocks a tick, down is negative). The game's own air physics: gravity 0.08 and drag 0.98 a
// tick, sideways 0.02 of push against 0.91 drag; momentum already carried is left out.
export function driftBudget(height: number, vy: number): number {
  let fallen = 0;
  let v = vy;
  let ticks = 0;
  while (fallen < height && ticks < 200) {
    v = (v - 0.08) * 0.98;
    fallen -= v;
    ticks++;
  }
  let speed = 0;
  let reach = 0;
  for (let t = 0; t < ticks; t++) {
    speed = speed * 0.91 + 0.02;
    reach += speed;
  }
  return reach;
}

// Where to steer in a fall that will hurt: the nearest column the body can still drift over where
// the landing would not. Null when the landing below is harmless or nothing better is in reach. `fallen` is how far it has dropped already; the cell given is the one just above the stop.
export function findLanding(g: Grid, from: Pos, fallen: number, vy: number, radius = 5): Pos | null {
  const x0 = Math.floor(from.x);
  const y0 = Math.floor(from.y);
  const z0 = Math.floor(from.z);
  const above = from.y - y0; // the part of the feet cell still to fall through
  // a vine or cobweb on the way wipes what was fallen before it
  const total = (l: Landing) => (l.reset ? l.fall : fallen + above + l.depth);
  const here = landing(g, x0, y0, z0);
  if (!hurts(here.stop, total(here))) return null;
  let best: Pos | null = null;
  let bestD = Infinity;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const x = x0 + dx;
      const z = z0 + dz;
      const d = Math.hypot(x + 0.5 - from.x, z + 0.5 - from.z);
      if (d >= bestD) continue;
      const land = landing(g, x, y0, z);
      if (hurts(land.stop, total(land))) continue;
      // the body is 0.6 wide: its edge over the column's edge is enough, the centre leaves a margin
      if (d - 0.5 > driftBudget(above + land.depth, vy)) continue;
      best = { x, y: y0 - land.depth, z };
      bestD = d;
    }
  }
  return best;
}

// Whether a way out is getting any closer: false until `window` ms pass without the distance having fallen
// by `step`. The first sample after a reset starts the clock.
export class Closing {
  private best = Infinity;
  private since = 0;

  constructor(private window = 3000, private step = 0.5) {}

  reset(): void {
    this.best = Infinity;
  }

  stalled(distance: number, now: number): boolean {
    if (distance <= this.best - this.step) {
      this.best = distance;
      this.since = now;
      return false;
    }
    return now - this.since >= this.window;
  }
}
