import type { Bot, Furnace } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import { base } from "../lib/base";
import { config } from "../lib/config";
import { inventoryReply, itemCount } from "../lib/inventory";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import type { MineCtx } from "./mine";
import { furnaceUsable, fuelFor, smeltWaitMs } from "./ore-plan";
import { pickUpBlock, put } from "./put";
import { walkTo } from "./unstuck";

const log = logger("smelt");

const FIELD_NEAR = 16; // blocks: a base furnace this near is walked to rather than setting one down
const OPEN_MS = 6_000;
const POLL_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// Smelts `count` raw iron at a home furnace with coal as fuel and returns the ingots it took out.
// Only a furnace that is empty (fuel slot aside, if that holds coal) is used, and only what the body
// put in or got out of its own run is ever taken back. Throws `smelt_failed` when no furnace will
// do or nothing came out. A stop closes the window and leaves whatever is in the furnace there.
export async function smeltIron(bot: Bot, ctx: MineCtx, count: number): Promise<number> {
  await setStatus({ task: "smelting" });
  // far from every base furnace with one in the pack: set it down here, use it, take it back
  if (config.placement && itemCount(bot, "furnace") > 0 && !base.furnaces.some((p) => p.distanceTo(bot.entity.position) <= FIELD_NEAR)) return smeltInField(bot, ctx, count);
  for (const pos of base.furnaces) {
    const taken = await tryFurnace(bot, ctx, pos, count);
    if (taken !== null) return taken;
  }
  throw new Error("smelt_failed");
}

async function smeltInField(bot: Bot, ctx: MineCtx, count: number): Promise<number> {
  const { at } = await put(bot, ctx, "furnace", { word: "here" });
  try {
    const taken = await tryFurnace(bot, ctx, at, count);
    if (taken === null) throw new Error("smelt_failed");
    return taken;
  } finally {
    if (!ctx.stopping()) await pickUpBlock(bot, ctx, at).catch((err: Error) => log.warn("couldn't take the furnace back", { message: err.message }));
  }
}

// null: nothing at that spot that can be used (not there, won't open, not empty)
async function tryFurnace(bot: Bot, ctx: MineCtx, pos: Vec3, count: number): Promise<number | null> {
  const block = bot.blockAt(pos);
  if (!block) return null;
  await walkTo(bot, new goals.GoalNear(pos.x, pos.y, pos.z, 2));
  ctx.checkStop();

  let furnace: Furnace;
  try {
    furnace = await within(bot.openFurnace(block), OPEN_MS, "opening the furnace");
  } catch (err) {
    log.warn("couldn't open a furnace", { position: pos, message: (err as Error).message });
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    return null;
  }
  try {
    const slots = {
      input: furnace.inputItem()?.name ?? null,
      fuel: furnace.fuelItem()?.name ?? null,
      output: furnace.outputItem()?.name ?? null,
    };
    if (!furnaceUsable(slots)) {
      log.info("furnace isn't empty, leaving it", { position: pos, slots });
      return null;
    }
    return await cook(bot, ctx, furnace, count, slots.fuel === null);
  } finally {
    if (bot.currentWindow === furnace) bot.closeWindow(furnace);
  }
}

async function cook(bot: Bot, ctx: MineCtx, furnace: Furnace, count: number, fuelWasEmpty: boolean): Promise<number> {
  const coal = fuelFor(count);
  if (itemCount(bot, "coal") < coal) throw new Error("no_fuel");
  await furnace.putFuel(bot.registry.itemsByName.coal.id, null, coal);
  await inventoryReply(bot);
  ctx.checkStop();
  await furnace.putInput(bot.registry.itemsByName.raw_iron.id, null, count);
  await inventoryReply(bot);

  // the output slot is the clock: the progress bar packets are not relied on
  const end = Date.now() + smeltWaitMs(count);
  while (Date.now() < end && !ctx.stopping() && bot.currentWindow === furnace) {
    if ((furnace.outputItem()?.count ?? 0) >= count) break;
    await sleep(POLL_MS);
  }
  ctx.checkStop();
  if (bot.currentWindow !== furnace) throw new Error("smelt_failed");

  const out = furnace.outputItem();
  const taken = out?.name === "iron_ingot" ? out.count : 0;
  if (taken > 0) await furnace.takeOutput();
  // whatever the run didn't use comes back: raw iron not cooked, coal not burnt (not a coal slot that was already stocked)
  if (furnace.inputItem()?.name === "raw_iron") await furnace.takeInput();
  if (fuelWasEmpty && furnace.fuelItem()?.name === "coal") await furnace.takeFuel();
  await inventoryReply(bot);
  log.info("smelted", { wanted: count, taken });
  if (taken === 0) throw new Error("smelt_failed");
  return taken;
}
