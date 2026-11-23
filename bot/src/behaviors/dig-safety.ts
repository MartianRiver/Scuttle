// The look-before-you-dig rule every mining step shares. Pure: it only sees block names, so it is
// tested on made-up grids. A block is dug only when digging it can't let lava or water loose, bring
// sand or gravel down on the body, or take apart something a player made.

export type Pos = { x: number; y: number; z: number };
// the block name at a position, or null where the world isn't loaded
export type NameAt = (p: Pos) => string | null;

export const NATURAL_STONE = ["stone", "andesite", "diorite", "granite"] as const;
export const isNaturalStone = (name: string): boolean => (NATURAL_STONE as readonly string[]).includes(name);

// kelp and seagrass are always in water, which a name-only view can't otherwise see
export const isLiquid = (name: string): boolean =>
  /^(flowing_)?(lava|water)$/.test(name) || /^(bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(name);

const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|dragon_egg|\w+_concrete_powder|(chipped_|damaged_)?anvil)$/;
export const isFalling = (name: string): boolean => FALLING.test(name);

// Nothing marks a block as player-placed, so this is a list of what players make and the world
// doesn't. Logs aren't on it (trees stand next to stone); cobblestone is, since mined stone put
// back is the commonest thing a kid builds with.
const MADE = [
  /^(crafting_table|furnace|blast_furnace|smoker|chest|trapped_chest|barrel|ladder|campfire|soul_campfire|tnt|bookshelf|anvil)$/,
  /(^|_)(planks|torch|lantern|glass|glass_pane|door|trapdoor|bed|fence|fence_gate|stairs|slab|wool|bricks|sign|hanging_sign|rail|carpet)$/,
  /cobblestone/,
  /^(polished|smooth|cut)_/,
];
export const isMade = (name: string): boolean => MADE.some((re) => re.test(name));

export const MADE_RADIUS = 3;

// hazards to stand in, as opposed to ones to dig beside
const STAND_HAZARD = /^(fire|soul_fire|cactus|sweet_berry_bush|cobweb|powder_snow|wither_rose|magma_block|campfire|soul_campfire)$/;
export const isStandHazard = (name: string): boolean => isLiquid(name) || STAND_HAZARD.test(name);

const SIX: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Where the feet may be to dig `target`: beside it, never in its column (no digging down at the
// floor, none up at a roof), and at its level or one below, so the target is at the feet or the
// head and never the floor or the ceiling.
export function standOk(target: Pos, stand: Pos): boolean {
  const dx = Math.abs(stand.x - target.x);
  const dz = Math.abs(stand.z - target.z);
  if (dx === 0 && dz === 0) return false;
  if (dx > 2 || dz > 2) return false;
  return stand.y === target.y || stand.y === target.y - 1;
}

export function safeToDig(target: Pos, nameAt: NameAt, stand?: Pos): boolean {
  if (stand && !standOk(target, stand)) return false;

  for (const [dx, dy, dz] of SIX) {
    const name = nameAt({ x: target.x + dx, y: target.y + dy, z: target.z + dz });
    if (name === null || isLiquid(name)) return false; // unloaded counts as not known to be safe
  }
  // what stands over the target comes down once it is gone, and what is two over follows
  for (const dy of [1, 2]) {
    const name = nameAt({ x: target.x, y: target.y + dy, z: target.z });
    if (name === null || isFalling(name)) return false;
  }
  for (let dx = -MADE_RADIUS; dx <= MADE_RADIUS; dx++) {
    for (let dy = -MADE_RADIUS; dy <= MADE_RADIUS; dy++) {
      for (let dz = -MADE_RADIUS; dz <= MADE_RADIUS; dz++) {
        const name = nameAt({ x: target.x + dx, y: target.y + dy, z: target.z + dz });
        if (name !== null && isMade(name)) return false;
      }
    }
  }
  return true;
}
