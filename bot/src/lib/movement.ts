import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Movements } from "mineflayer-pathfinder";

// plain logs only: stripped ones are something a player made
export const isPlainLogName = (name: string): boolean => /^(?!stripped_)\w+_log$/.test(name);

// Leaves that grew with the tree are not persistent; player-placed ones are. A trunk can sit a few
// blocks under the lowest leaves, so the box reaches further up than sideways.
export function isNaturalLog(bot: Bot, block: Block): boolean {
  if (!isPlainLogName(block.name)) return false;
  for (let dy = -1; dy <= 6; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const near = bot.blockAt(block.position.offset(dx, dy, dz));
        if (near?.name.endsWith("_leaves") && near.getProperties().persistent === false) return true;
      }
    }
  }
  return false;
}

// Default for everything: walk and jump, never dig or build.
export function safeMovements(bot: Bot): Movements {
  const m = new Movements(bot);
  m.canDig = false;
  m.maxDropDown = 3; // a longer fall costs health
  m.allow1by1towers = false;
  m.scafoldingBlocks = []; // [sic] upstream spelling
  return m;
}

// For the wood gathering step only: it may break natural logs and the natural leaves around them,
// nothing else. A canopy is a wall to the pathfinder otherwise. mineBlock in collectblock asks the
// pathfinder's own safeToBreak before every dig, so this is also the gate for the dig itself. Made
// per task, so the memo never outlives the trees it describes.
export function gatherMovements(bot: Bot): Movements {
  const m = safeMovements(bot);
  m.canDig = true;
  const memo = new Map<string, boolean>();
  m.safeToBreak = (block) => {
    const b = block as Block;
    if (b.name.endsWith("_leaves")) return b.getProperties().persistent === false;
    if (!isPlainLogName(b.name)) return false;
    const key = b.position.toString();
    let ok = memo.get(key);
    if (ok === undefined) {
      ok = isNaturalLog(bot, b);
      memo.set(key, ok);
    }
    return ok;
  };
  return m;
}
