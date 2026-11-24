// The decision half of guarding a player, free of mineflayer so it can be tested: which hostile mobs
// count as threats to the ward, and when the ward counts as lost.

import type { Mob } from "./danger";
import { GUARD, type Ward } from "./stance";

// how far a running fight may reach past the ring, as danger.ts does for the body, so a mob at the
// edge doesn't flicker in and out of the threat list
const EXIT_EXTRA = 6;

// hostile mobs within wardRadius of the ward (true distance), and `engaged` stretches the ring
export function wardThreats(ward: Ward, mobs: Mob[], engaged: boolean): Mob[] {
  const reach = GUARD.wardRadius + (engaged ? EXIT_EXTRA : 0);
  return mobs.filter((m) => Math.hypot(m.x - ward.x, m.y - ward.y, m.z - ward.z) <= reach);
}

// the body's own threats and the ward's, each mob once
export function mergeThreats(a: Mob[], b: Mob[]): Mob[] {
  const seen = new Set(a.map((m) => m.id));
  return [...a, ...b.filter((m) => m.id === undefined || !seen.has(m.id))];
}

export const WARD_LOST_MS = 15_000; // out of view or too far for this long ends the guard
export const WARD_MAX_BLOCKS = 48;

export interface WardWatch {
  since: number | null; // when the ward was first out of reach
  lost: boolean;
}

// `distance` is null when the ward is not in the body's loaded view
export function watchWard(since: number | null, now: number, distance: number | null): WardWatch {
  if (distance !== null && distance <= WARD_MAX_BLOCKS) return { since: null, lost: false };
  const from = since ?? now;
  return { since: from, lost: now - from >= WARD_LOST_MS };
}
