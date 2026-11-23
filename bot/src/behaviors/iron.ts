import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { craftItem, inventoryReply, itemCount } from "../lib/inventory";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";
import { ensureSticks, stashItems } from "./chores";
import { mineBlocks, type MineCtx, type MineSpec } from "./mine";
import {
  canMineIron, COAL_ORES, coalToMine, fuelFor, IRON_ORES, ironPlan, PICKAXE_INGOTS, rawToMine, stashCoalAmount, SWORD_INGOTS, toSmelt,
  xrayMode, type IronPlan,
} from "./ore-plan";
import { smeltIron } from "./smelt";
import { walkTo } from "./unstuck";

const log = logger("iron");

// The iron rung: coal and iron from ore that has a face in the open near home, the iron smelted at a
// home furnace on that coal, an iron pickaxe and sword at the table. The digging is mine.ts.
const RANGE = 64; // from the home table
const MIN_Y = 8; // below this the ore is deepslate and mostly inside caves it can't walk to

const xray = (() => {
  const mode = xrayMode(process.argv, process.env);
  if (mode === "ignored") log.warn("SCUTTLE_XRAY is set but this is not a --testworld run, ignoring it");
  if (mode === "on") log.warn("xray is on: buried ore counts as a candidate (test world only)");
  return mode === "on";
})();

const spec = (names: readonly string[], drop: string, target: number): MineSpec => ({
  names,
  drop,
  target,
  range: RANGE,
  minY: MIN_Y,
  looking: "looking for ore",
  mining: "mining ore",
  xray,
});

const held = (bot: Bot) => (name: string) => itemCount(bot, name);

// `protected` always ends the task; a `stuck` only does when nothing at all was gained
async function mine(bot: Bot, ctx: MineCtx, s: MineSpec, have: () => number): Promise<void> {
  try {
    await mineBlocks(bot, ctx, s);
  } catch (err) {
    if ((err as Error).message !== "stuck" || have() === 0) throw err;
    log.warn("stuck while mining, carrying on with what it has", { drop: s.drop });
  }
}

async function craftIronTools(bot: Bot, ctx: MineCtx, plan: IronPlan, ingots: number): Promise<void> {
  const makePick = plan.pickaxe && ingots >= PICKAXE_INGOTS;
  const makeSword = plan.sword && ingots - (makePick ? PICKAXE_INGOTS : 0) >= SWORD_INGOTS;
  if (!makePick && !makeSword) {
    log.info("not enough iron for a tool", { ingots });
    return;
  }
  await setStatus({ task: "crafting iron tools" });
  await walkTo(bot, new goals.GoalNear(home.craftingTable.x, home.craftingTable.y, home.craftingTable.z, 2));
  ctx.checkStop();
  const table = bot.blockAt(home.craftingTable);
  if (!table) throw new Error("crafting table isn't where I expected it");

  if (!(await ensureSticks(bot, (makePick ? 2 : 0) + (makeSword ? 1 : 0), ctx.stopping))) {
    ctx.checkStop();
    log.info("no sticks and nothing to make them from, skipping the iron tools");
    return;
  }
  ctx.checkStop();
  if (makePick && !(await craftItem(bot, "iron_pickaxe", 1, table, ctx.stopping))) log.warn("couldn't craft an iron pickaxe");
  ctx.checkStop();
  if (makeSword && !(await craftItem(bot, "iron_sword", 1, table, ctx.stopping))) log.warn("couldn't craft an iron sword");
  ctx.checkStop();
}

// Throws the reason as the message: no_pickaxe, no_fuel, no_ore, smelt_failed, protected, stuck.
export async function getIron(bot: Bot, ctx: MineCtx): Promise<void> {
  const count = held(bot);
  if (!canMineIron(count)) throw new Error("no_pickaxe");
  const plan = ironPlan(count);
  if (plan.ingots === 0) {
    log.info("already holds iron tools");
    return;
  }

  try {
    // coal first: with none there is nothing to smelt on, so no iron is mined for nothing
    const coalWanted = coalToMine(count("coal"));
    if (coalWanted > 0) await mine(bot, ctx, spec(COAL_ORES, "coal", coalWanted), () => count("coal"));
    if (count("coal") < fuelFor(plan.ingots)) throw new Error("no_fuel");
    await ctx.pause();

    const rawWanted = rawToMine(plan, count("iron_ingot"), count("raw_iron"));
    if (rawWanted > 0) await mine(bot, ctx, spec(IRON_ORES, "raw_iron", rawWanted), () => count("raw_iron") + count("iron_ingot"));
    if (count("raw_iron") + count("iron_ingot") === 0) throw new Error("no_ore");
  } finally {
    bot.pathfinder.setMovements(safeMovements(bot));
  }

  await ctx.pause();
  let ingots = count("iron_ingot");
  const cook = toSmelt(plan, ingots, count("raw_iron"));
  if (cook > 0) ingots += await smeltIron(bot, ctx, cook);
  await ctx.pause();
  await craftIronTools(bot, ctx, plan, ingots);

  await ctx.pause();
  await inventoryReply(bot);
  await stashItems(bot, ctx, "stashing ore", [
    { item: "coal", count: stashCoalAmount(count("coal")) },
    { item: "raw_iron", count: count("raw_iron") },
  ]);
}
