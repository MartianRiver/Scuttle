import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { itemCount, craftItem } from "../lib/inventory";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";
import { ensureSticks, stashItems } from "./chores";
import { mineBlocks, type MineCtx, type MineSpec } from "./mine";
import { TaskError } from "./fail";
import { nothingToDig, refusedNow } from "./refused";
import { canMineStone, COBBLE_TARGET, STONE_MIN_Y, STONE_RANGE, stashAmount, toolPlan } from "./stone-plan";
import { walkTo } from "./unstuck";

const log = logger("stone");

// The stone rung: cobblestone from natural stone near home with whatever pickaxe the body holds,
// then stone tools at the home table. The digging is mine.ts, shared with get_iron.
const SPEC: MineSpec = {
  names: ["stone"],
  drop: "cobblestone",
  target: COBBLE_TARGET,
  range: STONE_RANGE, // from the home table, or from where the order was aimed
  minY: STONE_MIN_Y,
  looking: "looking for stone",
  mining: "mining stone",
  what: "stone",
};

export type StoneCtx = MineCtx;

const cobble = (bot: Bot) => itemCount(bot, "cobblestone");

// returns the cobblestone still owed to a tool that wasn't made
async function craftStoneTools(bot: Bot, ctx: StoneCtx): Promise<number> {
  const count = (name: string) => itemCount(bot, name);
  const plan = toolPlan(count);
  if (!plan.pickaxe && !plan.sword) return 0;

  await setStatus({ task: "crafting stone tools" });
  await walkTo(bot, new goals.GoalNear(home.craftingTable.x, home.craftingTable.y, home.craftingTable.z, 2));
  ctx.checkStop();
  const table = bot.blockAt(home.craftingTable);
  if (!table) throw new Error("crafting table isn't where I expected it");

  if (!(await ensureSticks(bot, plan.sticks, ctx.stopping))) {
    ctx.checkStop();
    log.info("no sticks and nothing to make them from, skipping the stone tools");
    return plan.cobble;
  }
  // owed comes from what the crafts returned: the inventory can still show the old state right after a craft
  let owed = 0;
  ctx.checkStop();
  if (plan.pickaxe && !(cobble(bot) >= 3 && (await craftItem(bot, "stone_pickaxe", 1, table, ctx.stopping)))) {
    log.warn("couldn't craft a stone pickaxe");
    owed += 3;
  }
  ctx.checkStop();
  if (plan.sword && !(cobble(bot) >= 2 && (await craftItem(bot, "stone_sword", 1, table, ctx.stopping)))) {
    log.warn("couldn't craft a stone sword");
    owed += 2;
  }
  ctx.checkStop();
  return owed;
}

async function stashCobble(bot: Bot, ctx: StoneCtx, reserved: number): Promise<void> {
  await stashItems(bot, ctx, "stashing stone", [{ item: "cobblestone", count: stashAmount(cobble(bot), reserved) }]);
}

// Throws the reason as the message: no_pickaxe, no_stone, protected, stuck; anything else is an error's own text.
export async function getStone(bot: Bot, ctx: StoneCtx): Promise<void> {
  if (!canMineStone((name) => itemCount(bot, name))) throw new TaskError("no_pickaxe");
  try {
    if ((await mineBlocks(bot, ctx, SPEC)) <= 0) throw new TaskError("no_stone", nothingToDig("natural stone", refusedNow().length > 0));
  } finally {
    // digging was never switched on for the pathfinder; this puts the movements back to the default regardless
    bot.pathfinder.setMovements(safeMovements(bot));
  }
  await ctx.pause();
  const reserved = await craftStoneTools(bot, ctx);
  await ctx.pause();
  await stashCobble(bot, ctx, reserved);
}
