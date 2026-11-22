// Where a death happened, in words. Pure, so the bands are testable; no coordinates ever leave
// this module (the API has no coordinate field, and a place string with digits would be one).

export const AT_HOME = 16; // horizontal blocks from the bed counted as home
export const BANDS: Array<[maxBlocks: number, words: string]> = [
  [48, "a short walk"],
  [128, "a fair way"],
  [320, "a long way"],
  [Infinity, "far"],
];
export const UNDERGROUND_BELOW = 48; // overworld y; the surface sits around 63-100
export const DEEP_BELOW = 0; // deepslate
export const HIGH_ABOVE = 110; // mountain tops and the sky

export interface Point {
  x: number;
  y: number;
  z: number;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// +x is east and +z is south
export function direction(dx: number, dz: number): string {
  const turns = Math.atan2(dx, -dz) / (Math.PI / 4);
  return COMPASS[((Math.round(turns) % 8) + 8) % 8];
}

function height(y: number): string {
  if (y < DEEP_BELOW) return "deep underground";
  if (y < UNDERGROUND_BELOW) return "underground";
  if (y > HIGH_ABOVE) return "high up";
  return "on the surface";
}

function dimensionName(dimension: string | undefined): string | null {
  if (dimension === undefined || dimension === "overworld") return null;
  if (dimension === "the_nether") return "in the Nether";
  if (dimension === "the_end") return "in the End";
  return "in another world";
}

// `home` is where the distance and direction are measured from; the overworld is the only
// dimension they mean anything in, since the Nether's coordinates are scaled
export function describePlace(at: Point, home: Point, dimension?: string): string {
  const elsewhere = dimensionName(dimension);
  if (elsewhere) return elsewhere;
  const dx = at.x - home.x;
  const dz = at.z - home.z;
  const away = Math.hypot(dx, dz);
  const where =
    away < AT_HOME
      ? "at home"
      : `${BANDS.find(([max]) => away < max)![1]} to the ${direction(dx, dz)} of home`;
  return `${where}, ${height(at.y)}`;
}

export type Cause = "mob" | "fall" | "lava" | "fire" | "drowning" | "other";

// From the death message's translation key (death.attack.mob, death.fell.accident.generic, ...).
// A closed list: the mind gets a few words to say how it went, not the server's whole vocabulary.
export function deathCause(key: string | undefined): Cause {
  if (!key?.startsWith("death.")) return "other";
  const kind = key.split(".")[1];
  if (kind === "fell") return "fall";
  if (kind !== "attack") return "other";
  const what = key.split(".")[2];
  if (what === "lava") return "lava";
  if (what === "inFire" || what === "onFire" || what === "hotFloor") return "fire";
  if (what === "drown") return "drowning";
  if (what === "fall" || what === "flyIntoWall") return "fall";
  const byMob = ["mob", "player", "arrow", "explosion", "thorns", "sting", "trident", "fireball", "witherSkull", "thrown", "sonic_boom", "mace_smash"];
  return byMob.includes(what) ? "mob" : "other";
}
