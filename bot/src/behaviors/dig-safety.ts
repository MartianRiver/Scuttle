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

// A player asking for help with something lifts the made-block rules for that request: `true` for
// all of it, or a test for the positions they pointed at. It never touches liquid, falling or
// standing checks.
export type DigOpts = { allowMade?: boolean | ((p: Pos) => boolean) };

// the made blocks that make safeToDig refuse a target: within the radius, or above it in its column
export function madeBlocksNear(target: Pos, nameAt: NameAt): Pos[] {
  const found: Pos[] = [];
  const look = (dx: number, dy: number, dz: number) => {
    const p = { x: target.x + dx, y: target.y + dy, z: target.z + dz };
    const name = nameAt(p);
    if (name !== null && isMade(name)) found.push(p);
  };
  for (let dx = -MADE_RADIUS; dx <= MADE_RADIUS; dx++)
    for (let dy = -MADE_RADIUS; dy <= MADE_RADIUS; dy++) for (let dz = -MADE_RADIUS; dz <= MADE_RADIUS; dz++) look(dx, dy, dz);
  for (let dy = MADE_RADIUS + 1; dy <= BUILD_HEIGHT; dy++)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) look(dx, dy, dz);
  return found;
}

export function safeToDig(target: Pos, nameAt: NameAt, stand?: Pos, opts: DigOpts = {}): boolean {
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

  const { allowMade } = opts;
  const madeAt = (p: Pos): boolean => {
    const name = nameAt(p);
    if (name === null || !isMade(name)) return false;
    if (allowMade === true) return false;
    return !(typeof allowMade === "function" && allowMade(p));
  };
  for (let dx = -MADE_RADIUS; dx <= MADE_RADIUS; dx++) {
    for (let dy = -MADE_RADIUS; dy <= MADE_RADIUS; dy++) {
      for (let dz = -MADE_RADIUS; dz <= MADE_RADIUS; dz++) {
        if (madeAt({ x: target.x + dx, y: target.y + dy, z: target.z + dz })) return false;
      }
    }
  }
  for (let dy = 1; dy <= BUILD_HEIGHT; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (madeAt({ x: target.x + dx, y: target.y + dy, z: target.z + dz })) return false;
      }
    }
  }
  return true;
}
