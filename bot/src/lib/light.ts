// Block light as the server sent it. prismarine-chunk reads each 2048-byte light section into a BitArray that takes
// the words in the other byte order, so `section.get(i)` answers for another cell of the same row: a torch's 14 turns
// up four cells along in x. The row is put right here with the same swap (x ^ 14); test/strip.test.ts fails when a
// prismarine-chunk release stops needing it. Sky light is uniform enough that nothing reads it.
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

export const LIGHT_SWAP = 14;

interface LightSection {
  get(i: number): number;
}

// the light of the cell at p (whole numbers), 0 to 15; null when its chunk is not loaded
export function blockLightAt(bot: Bot, p: Vec3): number | null {
  const column = bot.world.getColumnAt(p) as unknown as { blockLightSections?: Array<LightSection | null> } | null;
  if (!column?.blockLightSections) return null;
  const minY = (bot.game as { minY?: number }).minY ?? -64;
  const section = column.blockLightSections[((p.y - minY) >> 4) + 1];
  if (!section) return 0;
  return section.get((((p.y - minY) & 15) << 8) | ((p.z & 15) << 4) | ((p.x & 15) ^ LIGHT_SWAP));
}
