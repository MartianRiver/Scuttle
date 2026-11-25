// The light at a cell: the brighter of sky light and block light, 0 to 15, for a sapling to be planted in.
// The numbers are the chunk's own, read with the byte swap prismarine-chunk needs (x ^ 14: both light arrays come
// out in the other byte order; the strip branch's lib/light.ts does the same for block light alone, fold the two
// into one when both are on next). They are a snapshot: the server sent no light update to the bot after a roof
// went up or came down (measured on the 26.3 test world, 0 packets), so sky light is judged from the blocks over
// the cell, which are live: open to the sky is 15, a solid roof over it is at most 8 whatever the data says, and
// only leaves over it leave the data's word. Raw sky light does not follow the clock: open sky reads 15 at night.
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Pos } from "./block-rules";

const SWAP = 14;
export const SCAN = 40; // blocks up from the cell that count as over it
const ROOFED_SKY = 8;

interface Section {
  get(i: number): number;
}
type Column = { skyLightSections?: Array<Section | null>; blockLightSections?: Array<Section | null> };

const read = (sections: Array<Section | null> | undefined, p: Pos, minY: number): number => {
  const section = sections?.[((p.y - minY) >> 4) + 1];
  if (!section) return 0;
  return section.get((((p.y - minY) & 15) << 8) | ((p.z & 15) << 4) | ((p.x & 15) ^ SWAP));
};

// what stands over the cell: nothing, only leaves, or something solid. `above(dy)` is the block dy over it, null where
// it is not loaded
export type Over = "open" | "leaves" | "roof";
export function overheadOf(above: (dy: number) => { name: string; solid: boolean } | null): Over {
  let leaves = false;
  for (let dy = 1; dy <= SCAN; dy++) {
    const b = above(dy);
    if (!b) break;
    if (/^(air|cave_air|void_air)$/.test(b.name)) continue;
    if (b.name.endsWith("_leaves")) leaves = true;
    else if (b.solid) return "roof";
  }
  return leaves ? "leaves" : "open";
}

// the sky light the cell has: the data's number, corrected by what is overhead now
export const skyNow = (over: Over, data: number): number => (over === "open" ? 15 : over === "roof" ? Math.min(data, ROOFED_SKY) : data);

// null when the cell's chunk is not loaded
export function cellLight(bot: Bot, p: Pos): number | null {
  const column = bot.world.getColumnAt(new Vec3(p.x, p.y, p.z)) as unknown as Column | null;
  if (!column) return null;
  const minY = (bot.game as { minY?: number }).minY ?? -64;
  const sky = read(column.skyLightSections, p, minY);
  const over = overheadOf((dy) => {
    const b = bot.blockAt(new Vec3(p.x, p.y + dy, p.z));
    return b && { name: b.name, solid: b.boundingBox === "block" };
  });
  return Math.max(skyNow(over, sky), read(column.blockLightSections, p, minY));
}
