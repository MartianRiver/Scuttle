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

// sand or gravel one or two cells over a cell: what comes down once it is dug
export const fallsOver = (nameAt: NameAt, p: Pos): boolean =>
  [1, 2].some((dy) => {
    const n = nameAt({ x: p.x, y: p.y + dy, z: p.z });
    return n !== null && isFalling(n);
  });

export const FALL_SCAN = 8; // the tallest column of sand or gravel it brings down
// what a name alone says is no roof: air, plants and the small things fixed to a wall
const NO_ROOF = /^(air|cave_air|void_air|short_grass|grass|tall_grass|fern|large_fern|dead_bush|snow|cobweb|fire|soul_fire)$|(lichen|vine|vines|carpet|sculk_vein|roots|sapling|flower|tulip|dandelion|poppy|orchid|allium|bluet|mushroom|torch|rail|sign|fungus|sprout|bush|azalea|dripleaf|candle|cluster|bud|button|lever|plate|wire)$/;

// Whether the column of sand or gravel standing right over `target` may be brought down by digging the target, and if
// not, why in words. It must start at the cell over the target, be capped by something that is not going to move within
// FALL_SCAN cells, and have no liquid in it or beside it and no open space in it (water, lava or a cave would come down
// the hole with it). null: it is safe to bring down. `settling`: the column was vetted before its first block came down, so
// the cells it vacated are air under the same cap and are not open space; the cap and the liquid checks still hold.
export function fallingWhy(target: Pos, nameAt: NameAt, settling = false): string | null {
  const first = nameAt({ x: target.x, y: target.y + 1, z: target.z });
  if (first === null) return "it cannot see far enough ahead";
  if (!isFalling(first)) return "sand or gravel overhead";
  for (let dy = 1; dy <= FALL_SCAN; dy++) {
    const at = { x: target.x, y: target.y + dy, z: target.z };
    const n = nameAt(at);
    if (n === null) return "it cannot see far enough ahead";
    if (isLiquid(n)) return `${n === "lava" ? "lava" : "water"} above the sand or gravel`;
    if (!isFalling(n)) {
      if (!NO_ROOF.test(n)) return null;
      if (!settling) return "an open space above the sand or gravel";
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const side = nameAt({ x: at.x + dx, y: at.y, z: at.z + dz });
      if (side === null) return "it cannot see far enough ahead";
      if (isLiquid(side)) return `${side === "lava" ? "lava" : "water"} beside the sand or gravel`;
    }
  }
  return "too much sand or gravel overhead to bring down";
}

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
// head. Right next to it the floor and the ceiling of the cell beside are fine too: an ore under
// the next step of a 1x2 tunnel, or over it, leaves a hole beside the body, never under it.
export function standOk(target: Pos, stand: Pos): boolean {
  const dx = Math.abs(stand.x - target.x);
  const dz = Math.abs(stand.z - target.z);
  if (dx === 0 && dz === 0) return false;
  if (dx > 2 || dz > 2) return false;
  if (stand.y === target.y || stand.y === target.y - 1) return true;
  return dx + dz === 1 && (stand.y === target.y + 1 || stand.y === target.y - 2);
}
