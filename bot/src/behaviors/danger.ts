// The decision half of the defence reflex, kept free of mineflayer so it can be tested: given
// where the hostile mobs are, say whether to run and which way. Flee only for now: with bare hands
// there is nothing to fight with, and a fight branch gets built with its own scenario.

export interface Mob {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface Self {
  x: number;
  y: number;
  z: number;
}

// how close a hostile mob has to be before the body runs; creepers are the short fuse, skeletons shoot
const ENTER_DEFAULT = 10;
const ENTER: Record<string, number> = { creeper: 9, skeleton: 20, stray: 20, bogged: 20, blaze: 20, ghast: 30 };
// once running it keeps going until everything is this much further off, so it doesn't twitch at the edge
const EXIT_EXTRA = 6;
export const FLEE_DISTANCE = 16;

export interface DangerState {
  since: number | null; // when the current threat was first noticed
  delay: number; // the reaction delay drawn for it
  fleeing: boolean;
}

export const calm = (): DangerState => ({ since: null, delay: 0, fleeing: false });

// flat distance for the flee direction, true distance for deciding whether a mob matters: a zombie
// in a cave twenty blocks down is not a threat to a bot standing above it
const flat = (s: Self, m: Mob) => Math.hypot(m.x - s.x, m.z - s.z);
const dist = (s: Self, m: Mob) => Math.hypot(m.x - s.x, m.y - s.y, m.z - s.z);

export function threatening(self: Self, mobs: Mob[], fleeing: boolean): Mob[] {
  return mobs.filter((m) => dist(self, m) <= (ENTER[m.name] ?? ENTER_DEFAULT) + (fleeing ? EXIT_EXTRA : 0));
}

export const LEASH = 16; // how far from where the run began the body will go

export interface Point {
  x: number;
  z: number;
}

const clampTo = (p: Point, anchor: Point, leash: number): Point => {
  const d = Math.hypot(p.x - anchor.x, p.z - anchor.z);
  if (d <= leash) return p;
  return { x: anchor.x + ((p.x - anchor.x) / d) * leash, z: anchor.z + ((p.z - anchor.z) / d) * leash };
};

// How far the nearest threat is from a point.
const clearance = (p: Point, threats: Mob[]) => Math.min(...threats.map((m) => Math.hypot(m.x - p.x, m.z - p.z)));

// The point to run to: FLEE_DISTANCE directly away from the threats, nearest weighing most. With a
// leash it never leaves the circle around `anchor`: when straight away would, it picks whichever
// way inside the circle keeps the most room from the nearest threat, which at the edge means
// sliding along it instead of carrying on into whatever lies past it.
export function fleeTarget(self: Self, threats: Mob[], anchor?: Point, leash = LEASH): Point {
  let dx = 0;
  let dz = 0;
  for (const m of threats) {
    const d = Math.max(flat(self, m), 0.5);
    dx += (self.x - m.x) / d / d;
    dz += (self.z - m.z) / d / d;
  }
  const len = Math.hypot(dx, dz);
  const away: Point = len < 1e-6 ? { x: self.x + FLEE_DISTANCE, z: self.z } : { x: self.x + (dx / len) * FLEE_DISTANCE, z: self.z + (dz / len) * FLEE_DISTANCE };
  if (!anchor || Math.hypot(away.x - anchor.x, away.z - anchor.z) <= leash) return away;

  let best = clampTo(away, anchor, leash);
  let bestScore = clearance(best, threats);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const p = clampTo({ x: self.x + Math.cos(a) * FLEE_DISTANCE, z: self.z + Math.sin(a) * FLEE_DISTANCE }, anchor, leash);
    const score = clearance(p, threats);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// The delay is drawn once per new threat; a threat that stays does not draw again.
export function step<T>(
  state: DangerState,
  threats: T[],
  now: number,
  draw: () => number
): { state: DangerState; flee: boolean } {
  if (threats.length === 0) return { state: calm(), flee: false };
  if (state.fleeing) return { state, flee: true };
  const since = state.since ?? now;
  const delay = state.since === null ? draw() : state.delay;
  const ready = now - since >= delay;
  return { state: { since, delay, fleeing: ready }, flee: ready };
}
