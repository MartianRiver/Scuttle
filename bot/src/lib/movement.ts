import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Movements } from "mineflayer-pathfinder";
import { breakGate } from "./gate";

// plain logs only: stripped ones are something a player made
export const isPlainLogName = (name: string): boolean => /^(?!stripped_)\w+_log$/.test(name);

// Natural leaves (non-persistent, grown with the tree; player-placed ones are persistent) close to a
// log say it is part of a tree. A trunk can sit a few blocks under the lowest leaves, so the box reaches
// further up than sideways. `naturalLeaf` is asked about offsets from the log.
export function nearNaturalLeaves(naturalLeaf: (dx: number, dy: number, dz: number) => boolean): boolean {
  for (let dy = -1; dy <= 6; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (naturalLeaf(dx, dy, dz)) return true;
      }
    }
  }
  return false;
}

export function isNaturalLog(bot: Bot, block: Block): boolean {
  if (!isPlainLogName(block.name)) return false;
  return nearNaturalLeaves((dx, dy, dz) => {
    const near = bot.blockAt(block.position.offset(dx, dy, dz));
    return Boolean(near?.name.endsWith("_leaves") && near.getProperties().persistent === false);
  });
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

// For `explore`: water is a wall, to wade as much as to swim, so a route goes round a pond. By default the planner
// only charges for moving *out of* water, so a straight line over a lake or the sea costs about two land blocks a
// block and wins against any detour; kelp and seagrass read as open air to it, so they are listed too.
const WET = ["water", "bubble_column", "kelp", "kelp_plant", "seagrass", "tall_seagrass"];
export function dryMovements(bot: Bot): Movements {
  const m = safeMovements(bot);
  for (const name of WET) {
    const id = bot.registry.blocksByName[name]?.id;
    if (id !== undefined) m.blocksToAvoid.add(id);
  }
  return m;
}

// For the wood gathering step only: it may break natural logs and the natural leaves around them,
// nothing else, and nothing the policy refuses (a tree beside a build stays). A canopy is a wall to the
// pathfinder otherwise. collectLog asks safeToBreak before every dig and dig() asks the gate again, so this is
// also the gate for the dig itself. Made per task, so the memos never outlive the trees they describe.
export function gatherMovements(bot: Bot): Movements {
  const m = safeMovements(bot);
  m.canDig = true;
  const gate = breakGate(bot, "gather");
  const memo = new Map<string, boolean>();
  m.safeToBreak = (block) => {
    const b = block as Block;
    if (b.name.endsWith("_leaves")) return b.getProperties().persistent === false && gate(b);
    if (!isPlainLogName(b.name)) return false;
    const key = b.position.toString();
    let ok = memo.get(key);
    if (ok === undefined) {
      ok = isNaturalLog(bot, b) && gate(b);
      memo.set(key, ok);
    }
    return ok;
  };
  return m;
}
