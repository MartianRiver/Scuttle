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

// the point FLEE_DISTANCE away from the threats, weighted so the closest ones count most
export function fleeTarget(self: Self, threats: Mob[]): { x: number; z: number } {
  let dx = 0;
  let dz = 0;
  for (const m of threats) {
    const d = Math.max(flat(self, m), 0.5);
    dx += (self.x - m.x) / d / d;
    dz += (self.z - m.z) / d / d;
  }
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { x: self.x + FLEE_DISTANCE, z: self.z }; // surrounded evenly, any way is as good
  return { x: self.x + (dx / len) * FLEE_DISTANCE, z: self.z + (dz / len) * FLEE_DISTANCE };
}

// The delay is drawn once per new threat; a threat that stays does not draw again.
export function step(
  state: DangerState,
  threats: Mob[],
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
