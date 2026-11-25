// Sets a torch on the wall beside the way a stair or tunnel has cut, through the one place door (the gate's verdict,
// the journal's `own`). The cell is put-plan's `wall` choice, which never takes the body's own column or the cell the
// next block of the way will be dug from. When to set one is torch-plan.ts.
import type { Bot } from "mineflayer";
import { blockLightAt } from "../lib/light";
import { logger } from "../lib/logger";
import { TaskError } from "./fail";
import type { MineCtx } from "./mine";
import { planPut } from "./put-plan";
import { setDown, viewOf, vetter } from "./put";
import type { TorchPacer } from "./torch-plan";

const log = logger("torches");

// A torch is due: set one down, or note that it carries none. A wall it cannot use, or a gate that says no, leaves it
// due for the next block; the server undoing it ends the run as `protected`, since the next dig would be undone too.
export async function torchIfDue(bot: Bot, ctx: MineCtx, pacer: TorchPacer | null, job: string): Promise<void> {
  if (!pacer?.due()) return;
  if (!bot.inventory.items().some((i) => i.name === "torch")) {
    pacer.outOfTorches();
    return;
  }
  const plan = planPut("torch", { kind: "wall" }, viewOf(bot), vetter(bot, "torch", job));
  if (!plan.ok) {
    log.debug("no torch spot", { reason: plan.reason });
    return;
  }
  ctx.checkStop();
  try {
    await setDown(bot, "torch", plan.spot, job);
    pacer.placed();
  } catch (err) {
    if (err instanceof TaskError && err.reason === "protected") throw err;
    log.warn("torch not set", { message: (err as Error).message, detail: (err as TaskError).detail });
  }
}

// block light at the head, for the pacer's start rule; null when the cell is not loaded
export const lightAtHead = (bot: Bot): number | null => blockLightAt(bot, bot.entity.position.floored().offset(0, 1, 0));
