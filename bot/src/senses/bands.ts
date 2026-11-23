// Numbers into words for the observation. Pure. The mind never gets a coordinate or an exact
// distance: a band, a compass point and up or down.
import { direction } from "../behaviors/place";

// upper edge in blocks, inclusive
const DISTANCE: Array<[number, string]> = [
  [3, "here"],
  [8, "close"],
  [16, "near"],
  [32, "far"],
  [48, "a short walk"],
  [128, "a fair way"],
  [320, "a long way"],
  [Infinity, "very far"],
];

export const distanceBand = (blocks: number): string => DISTANCE.find(([max]) => blocks <= max)![1];

const LEVEL = 2.5; // vertical offset that counts as above or below

// compass point of the horizontal offset (+x east, +z south) plus up or down; straight above or
// below says only that
export function directionWords(dx: number, dy: number, dz: number): string {
  const vertical = dy >= LEVEL ? "above" : dy <= -LEVEL ? "below" : "";
  if (Math.hypot(dx, dz) < 1.5) return vertical || "here";
  const flat = direction(dx, dz);
  return vertical ? `${flat} ${vertical}` : flat;
}

export function healthBand(health: number, max: number): "full" | "hurt" | "low" {
  const f = health / max;
  return f >= 0.9 ? "full" : f >= 0.5 ? "hurt" : "low";
}

// overworld ticks of the day: 0 is sunrise-ish morning, 12000 sunset, 13000 dark
export function timeWords(ticks: number): "day" | "dusk" | "night" | "dawn" {
  const t = ((ticks % 24000) + 24000) % 24000;
  if (t < 12000) return t >= 23000 ? "dawn" : "day";
  if (t < 13500) return "dusk";
  return t < 23000 ? "night" : "dawn";
}

// the server fades the rain and thunder levels (0 to 1) in and out over a few seconds
export const weatherWords = (rain: number, thunder: number): "clear" | "rain" | "thunder" =>
  rain < 0.2 ? "clear" : thunder >= 0.2 ? "thunder" : "rain";

// share of a tool's durability still there, 0 to 100
export const durabilityLeft = (used: number, max: number): number =>
  Math.max(0, Math.min(100, Math.round((100 * (max - used)) / max)));

// full health of the mobs a kid meets most; others get no health band rather than a wrong one
const MAX_HEALTH: Record<string, number> = {
  zombie: 20, husk: 20, drowned: 20, skeleton: 20, stray: 20, creeper: 20, spider: 16, cave_spider: 12, enderman: 40,
  witch: 26, slime: 16, villager: 20, iron_golem: 100, cow: 10, mooshroom: 10, pig: 10, sheep: 8, chicken: 4, rabbit: 3,
  cat: 10, fox: 10, bee: 10, squid: 10, bat: 6,
};

export function mobHealthBand(name: string, health: unknown): ReturnType<typeof healthBand> | undefined {
  const max = MAX_HEALTH[name];
  return max && typeof health === "number" && health >= 0 ? healthBand(health, max) : undefined;
}
