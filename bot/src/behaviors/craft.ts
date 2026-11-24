// `recipe` (what a craft takes, in words) and `craft` (do it, at a table when the recipe needs one). The
// choosing between the registry's one-per-wood recipes is craft-plan.ts.
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Recipe } from "prismarine-recipe";
import { goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import { base } from "../lib/base";
import { config } from "../lib/config";
import { craftItem, inventoryReply, itemCount } from "../lib/inventory";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import { isOverworld } from "../senses/observe";
import { MAX_CRAFT, craftsFor, describe, isPlanks, pickRecipe, type Counts, type RecipeLite } from "./craft-plan";
import { TaskError } from "./fail";
import { pickUpBlock, put } from "./put";
import type { MineCtx } from "./mine";
import { walkWithin } from "./walk";

const log = logger("craft");

const TABLE_SEARCH = 16; // blocks: a table this near is walked to
const TABLE_REACH = 4; // blocks from the eye, close enough to open it
const HOME_TABLE_MAX = 160; // blocks: a home table farther than this is no table to go to

interface Live {
  lite: RecipeLite;
  recipe: Recipe;
}

// every recipe for the item, tables included; a recipe's needs are the negative side of its delta
function recipesOf(bot: Bot, itemId: number): Live[] {
  return bot.recipesAll(itemId, null, true as never).map((recipe) => {
    const needs: Counts = {};
    for (const d of recipe.delta) if (d.count < 0) needs[bot.registry.items[d.id].name] = -d.count;
    return { lite: { table: recipe.requiresTable, makes: recipe.result.count, needs }, recipe };
  });
}

const heldBy = (bot: Bot) => (name: string) => itemCount(bot, name);

// the most of one kind of planks it holds: planks of different woods don't go into one recipe
function bestPlanks(bot: Bot): number {
  const by: Counts = {};
  for (const it of bot.inventory.items()) if (isPlanks(it.name)) by[it.name] = (by[it.name] ?? 0) + it.count;
  return Math.max(0, ...Object.values(by));
}

// null for an item the game does not have
export function recipeAnswer(bot: Bot, item: string) {
  const def = bot.registry.itemsByName[item];
  if (!def) return null;
  const all = recipesOf(bot, def.id);
  const pick = pickRecipe(all.map((r) => r.lite), heldBy(bot), 1);
  if (!pick) return { item, craftable: false as const };
  return describe(item, pick, heldBy(bot), bestPlanks(bot));
}

// the nearest crafting table in range, null when none is
function nearTable(bot: Bot): Block | null {
  const id = bot.registry.blocksByName.crafting_table?.id;
  if (id === undefined) return null;
  const me = bot.entity.position;
  const near = bot.findBlocks({ matching: id, maxDistance: TABLE_SEARCH, count: 8 }).sort((a, b) => a.distanceTo(me) - b.distanceTo(me))[0];
  return near ? bot.blockAt(near) : null;
}

// the base's table, when it is not farther than a table is worth walking to
function baseTable(bot: Bot): Block | null {
  const me = bot.entity.position;
  if (!isOverworld(bot) || Math.hypot(base.craftingTable.x - me.x, base.craftingTable.z - me.z) > HOME_TABLE_MAX) return null;
  const spot = bot.blockAt(base.craftingTable);
  return spot?.name === "crafting_table" ? spot : null;
}

const inReachOf = (bot: Bot, b: Block) => bot.entity.position.offset(0, 1.62, 0).distanceTo(b.position.offset(0.5, 0.5, 0.5)) <= TABLE_REACH;

const words = (c: Counts) => `short of ${Object.keys(c).join(" and ")}`;

// Throws its reason as the message: no_recipe, missing (with what is missing), no_table, craft_failed, stuck.
export async function craft(bot: Bot, ctx: MineCtx, item: string, count = 1): Promise<void> {
  const def = bot.registry.itemsByName[item];
  if (!def) throw new TaskError("unknown_item");
  const all = recipesOf(bot, def.id);
  if (all.length === 0) throw new TaskError("no_recipe", "nothing crafts that: it is mined, found or smelted");

  const wanted = Math.min(Math.max(1, count), MAX_CRAFT);
  const choose = () => {
    const times = craftsFor(wanted, all[0].lite.makes);
    const pick = pickRecipe(all.map((r) => r.lite), heldBy(bot), times)!;
    return { pick, times, live: all.find((r) => r.lite === pick.recipe)! };
  };
  const refuseIfShort = () => {
    const { pick, times } = choose();
    if (pick.fits) return;
    const missing = describe(item, pick, heldBy(bot), bestPlanks(bot), times).missing;
    throw new TaskError("missing", words(missing), missing);
  };
  refuseIfShort(); // before any walking

  let table: Block | null = null;
  let field: Vec3 | null = null; // a table it set down for this craft and takes back after
  if (choose().pick.recipe.table) {
    table = nearTable(bot);
    if (!table && config.placement && itemCount(bot, "crafting_table") > 0) {
      // carrying one beats a walk home: set it down here, craft, pick it up
      field = (await put(bot, ctx, "crafting_table", { word: "here" })).at;
      table = bot.blockAt(field);
    }
    table ??= baseTable(bot);
    if (!table) throw new TaskError("no_table", "no crafting table in reach, none in its pack to set down, and none at its base");
    if (!inReachOf(bot, table)) {
      await setStatus({ task: "walking to the crafting table" });
      const p = table.position;
      await walkWithin(bot, new goals.GoalNear(p.x, p.y, p.z, 2));
      ctx.checkStop();
      table = bot.blockAt(p);
      if (!table || table.name !== "crafting_table") throw new TaskError("no_table", "the crafting table is gone");
    }
    refuseIfShort(); // what it holds may have changed on the way
  }

  const { times, live } = choose();
  const before = itemCount(bot, item);
  await setStatus({ task: `crafting ${item}` });
  log.info("crafting", { item, times, table: Boolean(table) });
  try {
    if (!(await craftItem(bot, item, times, table, ctx.stopping, live.recipe))) throw new TaskError("craft_failed", "the recipe would not take");
    ctx.checkStop();
    await inventoryReply(bot);
    if (itemCount(bot, item) <= before) throw new TaskError("craft_failed", "nothing came out of the crafting");
  } finally {
    // the field table goes back in the pack, unless a stop is what ended the craft
    if (field && !ctx.stopping()) await pickUpBlock(bot, ctx, field).catch((err: Error) => log.warn("couldn't take the table back", { message: err.message }));
  }
}
