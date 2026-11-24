import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { craftItem, itemCount } from "../lib/inventory";
import { isPlainLogName } from "../lib/movement";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";
import type { MineCtx } from "./mine";
import { noteStashed } from "./run-report";
import { noteLook } from "./stash";
import { walkTo } from "./unstuck";

const log = logger("chores");

// What the mining tasks do at home after the digging: sticks, then the stash chest.

// sticks from planks, planks from a log, if that is what it holds; false when it can't
export async function ensureSticks(bot: Bot, need: number, stopping: () => boolean): Promise<boolean> {
  const missing = need - itemCount(bot, "stick");
  if (missing <= 0) return true;
  const crafts = Math.ceil(missing / 4);
  const planks = bot.inventory.items().filter((i) => i.name.endsWith("_planks")).reduce((n, i) => n + i.count, 0);
  if (planks < crafts * 2) {
    const logItem = bot.inventory.items().find((i) => isPlainLogName(i.name));
    if (!logItem) return false;
    if (!(await craftItem(bot, logItem.name.replace("_log", "_planks"), 1, null, stopping))) return false;
    if (stopping()) return false;
  }
  return craftItem(bot, "stick", crafts, null, stopping);
}

// Puts the amounts in the first stash chest. A full chest leaves the item in the inventory: what was
// mined is kept either way.
export async function stashItems(bot: Bot, ctx: MineCtx, status: string, amounts: Array<{ item: string; count: number }>): Promise<void> {
  const todo = amounts.filter((a) => a.count > 0);
  if (!todo.length) return;
  await setStatus({ task: status });
  const chestPos = home.stashChests[0];
  await walkTo(bot, new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
  ctx.checkStop();
  const block = bot.blockAt(chestPos);
  if (!block) throw new Error("stash chest isn't where I expected it");
  const chest = await bot.openChest(block);
  try {
    for (const { item, count } of todo) {
      ctx.checkStop();
      await chest
        .deposit(bot.registry.itemsByName[item].id, null, count)
        .then(() => noteStashed(item, count))
        .catch((err: Error) => {
          if (!ctx.stopping()) log.warn("couldn't stash", { item, message: err.message });
        });
    }
  } finally {
    noteLook(0, chest);
    chest.close();
  }
}
