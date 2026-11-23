// What a reflex says about itself, in words with no number: why an order was refused while it had the body, and how
// an episode of it ended. Pure.
import type { Hazard } from "./hazard";

export const HAZARD_WORDS: Record<Hazard, string> = {
  lava: "in lava",
  fire: "in fire",
  burning: "on fire",
  drowning: "in deep water, swimming out",
};

export const GAVE_UP_WORDS = "no way out of the water found";

const article = (name: string) => (/^[aeiou]/.test(name) ? "an" : "a");

// "a zombie is close", "a zombie and a skeleton are close", "several mobs are close"
export function mobsWords(names: readonly string[]): string {
  const kinds = [...new Set(names.map((n) => n.replace(/_/g, " ")))];
  if (kinds.length === 0) return "mobs are close";
  if (kinds.length === 1) return `${article(kinds[0])} ${kinds[0]} is close`;
  if (kinds.length === 2) return `${article(kinds[0])} ${kinds[0]} and ${article(kinds[1])} ${kinds[1]} are close`;
  return "several mobs are close";
}

// what an episode of a reflex is called in its ending event
export type ReflexKind = "mobs" | Hazard;

export interface ReflexEnd {
  what: ReflexKind;
  ok: boolean; // false: it gave up
  detail?: string;
}
