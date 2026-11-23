import type { Bot, Furnace } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { inventoryReply, itemCount } from "../lib/inventory";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import type { MineCtx } from "./mine";
import { furnaceUsable, fuelFor, smeltWaitMs } from "./ore-plan";
import { walkTo } from "./unstuck";

const log = logger("smelt");

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
  for (const pos of home.furnaces) {
    const block = bot.blockAt(pos);
    if (!block) continue;
    await walkTo(bot, new goals.GoalNear(pos.x, pos.y, pos.z, 2));
    ctx.checkStop();

    let furnace: Furnace;
    try {
      furnace = await within(bot.openFurnace(block), OPEN_MS, "opening the furnace");
    } catch (err) {
      log.warn("couldn't open a furnace", { position: pos, message: (err as Error).message });
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
      continue;
    }
    try {
      const slots = {
        input: furnace.inputItem()?.name ?? null,
        fuel: furnace.fuelItem()?.name ?? null,
        output: furnace.outputItem()?.name ?? null,
      };
      if (!furnaceUsable(slots)) {
        log.info("furnace isn't empty, leaving it", { position: pos, slots });
        continue;
      }
      return await cook(bot, ctx, furnace, count, slots.fuel === null);
    } finally {
      if (bot.currentWindow === furnace) bot.closeWindow(furnace);
    }
  }
  throw new Error("smelt_failed");
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
