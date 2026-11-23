import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { setStatus } from "../lib/status";
import { keptSlot, planToss, type Throw } from "./give-plan";
import { walkTo } from "./unstuck";

const plan = (bot: Bot, item: string, count: number | undefined) =>
  planToss(
    bot.inventory.items().map((i) => ({ name: i.name, count: i.count, slot: i.slot })),
    item,
    count,
    keptSlot(bot.heldItem)
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REACH = 4; // blocks, from where the items leave to the player
const WALKS = 3;

async function throwStack(bot: Bot, t: Throw): Promise<void> {
  const stack = bot.inventory.slots[t.slot];
  if (!stack) return;
  if (t.count >= stack.count) {
    await bot.tossStack(stack);
    return;
  }
  // a part of a stack: a transfer over this one slot only, so a kept stack is never in reach
  await bot.transfer({ window: bot.inventory, itemType: stack.type, metadata: null, count: t.count, sourceStart: t.slot, sourceEnd: t.slot + 1, destStart: -999, destEnd: -998 });
}

// Walk to the player and throw what planToss says. Fails `none_held` before walking when there is
// nothing to give, and again on arrival if the inventory changed on the way (eaten, a weapon
// swapped into the hand, a death). Resolves once everything is thrown.
export async function giveItem(bot: Bot, player: string, item: string, count: number | undefined): Promise<void> {
  const target = () => bot.players[player]?.entity;
  if (plan(bot, item, count).length === 0) throw new Error("none_held");
  await setStatus({ task: `bringing ${item} to ${player}` });
  try {
    // they may walk off meanwhile: look again after each walk, a few times at most
    for (let walks = 0; ; walks++) {
      const t = target();
      if (!t) throw new Error("lost sight of them");
      if (bot.entity.position.distanceTo(t.position) <= REACH) break;
      if (walks === WALKS) throw new Error("stuck");
      await walkTo(bot, new goals.GoalNear(t.position.x, t.position.y, t.position.z, 2));
    }
    const throws = plan(bot, item, count);
    if (throws.length === 0) throw new Error("none_held");
    const t = target();
    if (!t) throw new Error("lost sight of them");
    await bot.lookAt(t.position.offset(0, 1, 0), true);
    await sleep(150);
    for (const th of throws) await throwStack(bot, th);
  } catch (err) {
    // a stop or a reflex owns the status after any other failure
    const m = (err as Error).message;
    if (m === "none_held" || m === "stuck" || m === "lost sight of them") await setStatus({ task: "idle" });
    throw err;
  }
  await setStatus({ task: "idle" });
}
