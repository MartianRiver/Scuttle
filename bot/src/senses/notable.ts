// Which blocks are worth listing in an observation, and under what kind. Pure.

export const SIGHT_BLOCKS = 16; // blocks
export const SIGHT_ENTITIES = 32;

// nearest few of each kind are listed
export const PER_KIND = 3;
export const PER_LIQUID = 2;

export function blockKind(name: string): string | null {
  if (name === "water" || name === "lava") return name;
  if (name === "chest" || name === "trapped_chest" || name === "barrel" || name === "ender_chest") return "chest";
  if (name === "crafting_table") return name;
  if (name === "furnace" || name === "blast_furnace" || name === "smoker") return "furnace";
  if (name.endsWith("_bed")) return "bed";
  if (name.endsWith("_door") && !name.includes("trapdoor")) return "door";
  if (name === "spawner" || name === "ancient_debris" || name === "nether_portal") return name;
  if (name.endsWith("_ore")) return name; // each ore is its own kind
  return null;
}
