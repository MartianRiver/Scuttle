// `store`, `take` and what the body remembers of its own stash. Only the base's stash chests (lib/base.ts) and
// chests the journal says the body placed are ever opened here; every open, by these or by a task, leaves a look
// in the memory, kept by where the chest is.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { base } from "../lib/base";
import { inventoryReply, itemCount } from "../lib/inventory";
import { journal } from "../lib/journal";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import { isOverworld } from "../senses/observe";
import { TaskError } from "./fail";
import type { MineCtx } from "./mine";
import { noteStashed } from "./run-report";
import { distinctChests, spotKey, stashMemory, storeAll, storeOne, storeSpots, takeSpots, type Carried, type Counts } from "./stash-plan";
import { carriedItems, foodTable } from "./survival";
import { walkWithin } from "./walk";

const log = logger("stash");

export { stashMemory };
// the base's stash chests that are places of their own (the two halves of a double chest are one)
const baseSpots = (): Vec3[] => distinctChests(base.stashChests).map((i) => base.stashChests[i]);

// the chests the body placed that are still there; only a loaded one can be told, and only a loaded one can be opened
export const ownChests = (bot: Bot): Vec3[] =>
  journal.ownCells((n) => n === "chest").map((p) => new Vec3(p.x, p.y, p.z)).filter((p) => journal.ownAt(p, bot.blockAt(p)?.name ?? ""));

// every chest the `stash` read counts: the base's and the ones it placed
export const stashCount = (): number => {
  const known = new Set(baseSpots().map(spotKey));
  for (const p of journal.ownCells((n) => n === "chest")) known.add(spotKey(p));
  return known.size;
};

// a chest the body may open: the base's or one it placed
export const isStashChest = (bot: Bot, p: Vec3): boolean => baseSpots().some((b) => b.equals(p)) || ownChests(bot).some((c) => c.equals(p));

type Chest = Awaited<ReturnType<Bot["openChest"]>>;

// what the open chest itself holds of an item: the inventory the bot reads stays as it was until the window closes,
// so what moved is measured on this side
const inChest = (chest: Chest, name: string) => chest.containerItems().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

// what is in the chest now, as the body's last look at it
export function noteLook(at: Vec3, chest: Chest): void {
  try {
    const items: Counts = {};
    for (const it of chest.containerItems()) items[it.name] = (items[it.name] ?? 0) + it.count;
    stashMemory.note(spotKey(at), items);
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

// walks to the chest and opens it; the caller closes it
async function openStash(bot: Bot, ctx: MineCtx, at: Vec3): Promise<Chest> {
  await walkWithin(bot, new goals.GoalNear(at.x, at.y, at.z, 2));
  ctx.checkStop();
  const block = bot.blockAt(at);
  if (!block || !block.name.endsWith("chest")) throw new TaskError("no_stash", "no stash chest where it expects one");
  return bot.openChest(block);
}

// the chests an order is about: the one it names (the base's or its own, nothing else), else `fallback`
function chestsFor(bot: Bot, named: Vec3 | undefined, fallback: () => Vec3[]): Vec3[] {
  if (!named) return fallback();
  if (!isStashChest(bot, named)) throw new TaskError("not_yours", "that chest is not one of its own");
  return [named];
}

// `chest` names one chest; without it the own chests near the body (else the base's stash), nearest first
export async function store(bot: Bot, ctx: MineCtx, item?: string, count?: number, chest?: Vec3): Promise<{ stored: Counts }> {
  stashAvailable(bot);
  const items = carriedWithKinds(bot);
  const plan = item ? storeOne(items, item, count) : storeAll(items);
  const wanted = { ...plan };
  if (Object.keys(wanted).length === 0) throw new TaskError("none_held", item ? "it holds none of that" : "nothing it can spare");

  const stored: Counts = {};
  const spots = chestsFor(bot, chest, () => storeSpots(ownChests(bot), baseSpots(), bot.entity.position));
  for (const [i, at] of spots.entries()) {
    if (Object.keys(wanted).length === 0) break;
    await setStatus({ task: i === 0 ? "stashing items" : "stashing items in the next chest" });
    const open = await openStash(bot, ctx, at);
    try {
      for (const [name, n] of Object.entries(wanted)) {
        ctx.checkStop();
        const before = inChest(open, name);
        await open.deposit(bot.registry.itemsByName[name].id, null, n).catch((err: Error) => {
          if (!ctx.stopping() && err.message !== "destination full") log.warn("couldn't stash", { name, message: err.message });
        });
        await inventoryReply(bot);
        const put = inChest(open, name) - before;
        if (put > 0) {
          stored[name] = (stored[name] ?? 0) + put;
          noteStashed(name, put);
        }
        if (put >= n) delete wanted[name];
        else wanted[name] = n - Math.max(put, 0);
      }
    } finally {
      noteLook(at, open);
      open.close();
    }
  }
  if (Object.keys(stored).length === 0) throw new TaskError("stash_full", "the stash chests have no room");
  return { stored };
}

// takes up to `count` (a stack by default) from the stash chests, the first that has it first
export async function take(bot: Bot, ctx: MineCtx, item: string, count?: number, chest?: Vec3): Promise<void> {
  stashAvailable(bot);
  const def = bot.registry.itemsByName[item];
  let want = count ?? def.stackSize;
  const start = itemCount(bot, item);
  let full = false;
  for (const at of chestsFor(bot, chest, () => takeSpots(ownChests(bot), baseSpots(), bot.entity.position))) {
    if (want <= 0) break;
    if (stashMemory.chestHas(spotKey(at), item) === 0) continue; // seen lately with none of it
    await setStatus({ task: "taking from the stash" });
    const open = await openStash(bot, ctx, at);
    try {
      const have = inChest(open, item);
      if (have === 0) continue;
      await open.withdraw(def.id, null, Math.min(want, have)).catch((err: Error) => {
        if (/full/i.test(err.message)) full = true;
        else if (!ctx.stopping()) log.warn("couldn't take", { item, message: err.message });
      });
      await inventoryReply(bot);
      want -= Math.max(0, have - inChest(open, item));
    } finally {
      noteLook(at, open);
      open.close();
    }
    ctx.checkStop();
  }
  if (itemCount(bot, item) <= start) {
    if (full) throw new TaskError("inventory_full", "no room in its inventory");
    throw new TaskError("none_stashed", "none of that in its stash chests");
  }
}
