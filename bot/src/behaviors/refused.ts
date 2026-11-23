// Where the server undid the body's digs. It is the body's own guess (no reading of WorldGuard: it learns
// where it may not dig the way a player would, by a block coming back), kept for the bot's life and shared
// by get_wood, get_stone and get_iron, so a later task starts out knowing it. Reverted zones fade after
// FORGET_REFUSED_MS, which is also how a lifted protection is found out.
import { NoDigMap, type Zone } from "./no-dig";
import { direction, distanceBand } from "./place";

export const REFUSED_RADIUS = 12; // blocks around an undone dig
export const FORGET_REFUSED_MS = 30 * 60_000;
export const REFUSED_LISTED = 3; // the most an observation lists

export const reverted = new NoDigMap();

export function noteRefused(x: number, z: number, now?: number): void {
  reverted.add({ x, z, r: REFUSED_RADIUS, reason: "reverted" }, now);
}

export function refusedNow(now: number = Date.now()): readonly Zone[] {
  reverted.forget(FORGET_REFUSED_MS, now);
  return reverted.list();
}

type Spot = { x: number; z: number };
const flat = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

// the zones that matter most from `from`: by distance to their edge
export function nearestRefused(zones: readonly Zone[], from: Spot, n = REFUSED_LISTED): Zone[] {
  const edge = (z: Zone) => Math.max(0, flat(from, z) - z.r);
  return [...zones].sort((a, b) => edge(a) - edge(b)).slice(0, n);
}

const COUNT_WORDS = ["no", "one", "two", "three"];

// "three digs undone near the trees, a fair way south-west": words only, no number past a count
export function undoneWords(digs: number, what: string, from: Spot, zones: readonly Zone[]): string {
  const count = COUNT_WORDS[digs] ?? "several";
  const head = `${count} ${digs === 1 ? "dig" : "digs"} undone near the ${what}`;
  const z = nearestRefused(zones, from, 1)[0];
  if (!z) return head;
  const away = Math.max(0, flat(from, z) - z.r);
  const band = distanceBand(away);
  return band === "here" ? `${head}, right here` : `${head}, ${band} ${direction(z.x - from.x, z.z - from.z)}`;
}

// why a run found nothing to dig, when refusals are part of it
export const nothingToDig = (what: string, refused: boolean): string =>
  refused ? `the ${what} in range is all where its digs were undone` : `no ${what} it may dig in range`;
