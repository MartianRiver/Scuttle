// `store`, `take` and what the body remembers of its own stash. Only the home stash chests (lib/home.ts)
// are ever opened here; every open, by these or by a task, leaves a look in the memory.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { inventoryReply, itemCount } from "../lib/inventory";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import { isOverworld } from "../senses/observe";
import { TaskError } from "./fail";
import type { MineCtx } from "./mine";
import { noteStashed } from "./run-report";
import { distinctChests, StashMemory, storeAll, storeOne, type Carried, type Counts } from "./stash-plan";
import { carriedItems, foodTable } from "./survival";
import { walkWithin } from "./walk";

const log = logger("stash");

export const stashMemory = new StashMemory();
// the stash chests that are places of their own (the two halves of a double chest are one)
export const stashPlaces: number[] = distinctChests(home.stashChests);

type Chest = Awaited<ReturnType<Bot["openChest"]>>;

// what the open chest itself holds of an item: the inventory the bot reads stays as it was until the window closes,
// so what moved is measured on this side
const inChest = (chest: Chest, name: string) => chest.containerItems().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

// what is in the chest now, as the body's last look at it
export function noteLook(index: number, chest: Chest): void {
  try {
    const items: Counts = {};
    for (const it of chest.containerItems()) items[it.name] = (items[it.name] ?? 0) + it.count;
    stashMemory.note(index, items);
  } catch (err) {
    log.warn("couldn't read the chest", { message: (err as Error).message });
  }
}

export function carriedWithKinds(bot: Bot): Carried[] {
  const foods = foodTable(bot);
  return carriedItems(bot).map((c) => {
    const def = bot.registry.itemsByName[c.name];
    return { ...c, durable: Boolean(def?.maxDurability), food: foods[c.name]?.points ?? 0 };
  });
}

function stashAvailable(bot: Bot): void {
  if (!isOverworld(bot)) throw new TaskError("no_stash", "the stash is not in this world");
}

// walks to chest `index` and opens it; the caller closes it
async function openStash(bot: Bot, ctx: MineCtx, index: number): Promise<Chest> {
  const at = home.stashChests[index];
  await walkWithin(bot, new goals.GoalNear(at.x, at.y, at.z, 2));
  ctx.checkStop();
  const block = bot.blockAt(at);
  if (!block || !block.name.endsWith("chest")) throw new TaskError("no_stash", "no stash chest where it expects one");
  return bot.openChest(block);
}

export async function store(bot: Bot, ctx: MineCtx, item?: string, count?: number): Promise<{ stored: Counts }> {
  stashAvailable(bot);
  const items = carriedWithKinds(bot);
  const plan = item ? storeOne(items, item, count) : storeAll(items);
  const wanted = { ...plan };
  if (Object.keys(wanted).length === 0) throw new TaskError("none_held", item ? "it holds none of that" : "nothing it can spare");

  const stored: Counts = {};
  for (const i of stashPlaces) {
    if (Object.keys(wanted).length === 0) break;
    await setStatus({ task: i === 0 ? "stashing items" : "stashing items in the next chest" });
    const chest = await openStash(bot, ctx, i);
    try {
      for (const [name, n] of Object.entries(wanted)) {
        ctx.checkStop();
        const before = inChest(chest, name);
        await chest.deposit(bot.registry.itemsByName[name].id, null, n).catch((err: Error) => {
          if (!ctx.stopping() && err.message !== "destination full") log.warn("couldn't stash", { name, message: err.message });
        });
        await inventoryReply(bot);
        const put = inChest(chest, name) - before;
        if (put > 0) {
          stored[name] = (stored[name] ?? 0) + put;
          noteStashed(name, put);
        }
        if (put >= n) delete wanted[name];
        else wanted[name] = n - Math.max(put, 0);
      }
    } finally {
      noteLook(i, chest);
      chest.close();
    }
  }
  if (Object.keys(stored).length === 0) throw new TaskError("stash_full", "the stash chests have no room");
  return { stored };
}

// takes up to `count` (a stack by default) from the stash chests, the first that has it first
export async function take(bot: Bot, ctx: MineCtx, item: string, count?: number): Promise<void> {
  stashAvailable(bot);
  const def = bot.registry.itemsByName[item];
  let want = count ?? def.stackSize;
  const start = itemCount(bot, item);
  let full = false;
  for (const i of stashPlaces) {
    if (want <= 0) break;
    if (stashMemory.chestHas(i, item) === 0) continue; // seen lately with none of it
    await setStatus({ task: "taking from the stash" });
    const chest = await openStash(bot, ctx, i);
    try {
      const have = inChest(chest, item);
      if (have === 0) continue;
      await chest.withdraw(def.id, null, Math.min(want, have)).catch((err: Error) => {
        if (/full/i.test(err.message)) full = true;
        else if (!ctx.stopping()) log.warn("couldn't take", { item, message: err.message });
      });
      await inventoryReply(bot);
      want -= Math.max(0, have - inChest(chest, item));
    } finally {
      noteLook(i, chest);
      chest.close();
    }
    ctx.checkStop();
  }
  if (itemCount(bot, item) <= start) {
    if (full) throw new TaskError("inventory_full", "no room in its inventory");
    throw new TaskError("none_stashed", "none of that in its stash chests");
  }
}
