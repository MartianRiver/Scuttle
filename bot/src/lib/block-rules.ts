// What a block's name says about digging it, beside it or standing in it. Pure and name-only, so the policy
// and the planners share one set of words and it is tested on made-up grids.

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
// back is the commonest thing a kid builds with. Natural structures trip it too (mineshaft planks,
// rails and torches, dungeon cobble, stronghold bricks, badlands terracotta, village houses): the
// body keeps out of those, which is the cheap side to be wrong on.
const MADE = [
  /^(crafting_table|furnace|blast_furnace|smoker|chest|trapped_chest|ender_chest|barrel|ladder|campfire|soul_campfire|tnt|bookshelf|anvil|chipped_anvil|damaged_anvil)$/,
  /^(lectern|composter|cauldron|grindstone|stonecutter|smithing_table|loom|cartography_table|fletching_table|enchanting_table|brewing_stand|beacon|jukebox|note_block|farmland|hay_block|iron_bars|flower_pot)$/,
  // redstone parts; redstone_ore is natural, so no blanket redstone_ prefix
  /^(redstone_wire|redstone_torch|redstone_wall_torch|redstone_lamp|redstone_block|repeater|comparator|observer|piston|sticky_piston|piston_head|dispenser|dropper|hopper|lever|tripwire_hook|daylight_detector|target|slime_block|honey_block)$/,
  /(^|_)(planks|torch|lantern|glass|glass_pane|door|trapdoor|bed|fence|fence_gate|stairs|slab|wool|bricks|sign|hanging_sign|rail|carpet)$/,
  /_(wall|concrete|button|pressure_plate|terracotta|banner|wood)$/, // _concrete_powder falls and is not here
  /^(potted_|stripped_)/,
  /cobblestone/,
  /^(polished|smooth|cut)_/,
];
// geodes are natural and smooth_basalt is nothing else
export const isMade = (name: string): boolean => name !== "smooth_basalt" && MADE.some((re) => re.test(name));

export const MADE_RADIUS = 3;
// a shaft under a house, a roof or a bridge: a made block this far above, or beside that column
export const BUILD_HEIGHT = 12;

// hazards to stand in, as opposed to ones to dig beside
const STAND_HAZARD = /^(fire|soul_fire|cactus|sweet_berry_bush|cobweb|powder_snow|wither_rose|magma_block|campfire|soul_campfire)$/;
export const isStandHazard = (name: string): boolean => isLiquid(name) || STAND_HAZARD.test(name);

export const SIX: ReadonlyArray<readonly [number, number, number]> = [
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
