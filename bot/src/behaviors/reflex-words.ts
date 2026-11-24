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

// "a zombie", "a zombie and a skeleton", "several mobs"
export function mobList(names: readonly string[]): string {
  const kinds = [...new Set(names.map((n) => n.replace(/_/g, " ")))];
  if (kinds.length === 0) return "mobs";
  if (kinds.length === 1) return `${article(kinds[0])} ${kinds[0]}`;
  if (kinds.length === 2) return `${article(kinds[0])} ${kinds[0]} and ${article(kinds[1])} ${kinds[1]}`;
  return "several mobs";
}

// "a zombie is close", "a zombie and a skeleton are close", "several mobs are close"
export function mobsWords(names: readonly string[]): string {
  const list = mobList(names);
  if (list === "mobs") return "mobs are close";
  return `${list} ${list.includes(" and ") || list === "several mobs" ? "are" : "is"} close`;
}

// what an episode of a reflex is called in its events: running from or fighting mobs, a hazard, a fall
// being steered, a meal while threatened, the plugin's fight against a player
export type ReflexKind = "mobs" | Hazard | "fall" | "eating" | "fight";

export interface ReflexEnd {
  what: ReflexKind;
  ok: boolean; // false: it gave up
  detail?: string;
}

// a reflex starting, or changing what it does (running turning into a fight); `why` is words
export interface ReflexStart {
  what: ReflexKind;
  why: string;
}

export interface ReflexHooks {
  started(e: ReflexStart): void;
  changed(e: ReflexStart): void;
  ended(e: ReflexEnd): void;
}

export const noHooks: ReflexHooks = { started() {}, changed() {}, ended() {} };

// what the body does about mobs, for reflex_started / reflex_changed; `lead` opens the line ("guarding", "cornered")
export function stanceWords(act: "fight" | "flee", mobs: readonly string[], why?: string, lead?: string): string {
  const list = mobList(mobs);
  if (act === "fight") return `${lead ? `${lead}, ` : ""}fighting ${list}`;
  return `running from ${list}${why ? `, ${why}` : ""}`;
}

// how a fall ended, from what it landed on and what it cost; no number
export function fallWords(onto: "water" | "soft" | "hard", lost: number): string {
  const cost = lost <= 0 ? "unhurt" : lost <= 2 ? "a little hurt" : lost <= 7 ? "hurt" : "badly hurt";
  return `landed ${onto === "water" ? "in water" : onto === "soft" ? "softly" : "hard"}, ${cost}`;
}
