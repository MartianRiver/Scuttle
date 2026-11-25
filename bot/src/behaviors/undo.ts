// `undo`: takes back what a job of the body's own did, newest cell first, through the same doors as the job did (the
// gate's verdict, the journal). What it set down it takes up; what it dug out it puts back, when it carries that block
// and the hands may set it down. The plan is undo-plan.ts; this walks it.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { nameAtOf } from "../lib/gate";
import { journal, undoJob } from "../lib/journal";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import { TaskError } from "./fail";
import type { MineCtx } from "./mine";
import { pickUpBlock, setDown } from "./put";
import type { Loot } from "./block-drop";
import { lastJob, planUndo, restoreSpot, undoWords, type Skip, type Todo, type UndoKind, type Why } from "./undo-plan";
import { walkWithin } from "./walk";

const log = logger("undo");
const LEG_MS = 30_000;
const REACH_BLOCKS = 3;

const vec = (p: { x: number; y: number; z: number }): Vec3 => new Vec3(p.x, p.y, p.z);
const WHY: Record<string, Why> = { not_empty: "chest", stood: "stood", protected: "refused", refused: "refused", not_yours: "not_set_down", no_tool: "refused", no_room: "stuck" };

function carriedCounts(bot: Bot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of bot.inventory.items()) out[i.name] = (out[i.name] ?? 0) + i.count;
  return out;
}

// the items a block drops dug by hand, from the registry's loot table
const lootOf =
  (bot: Bot): Loot =>
  (name) => {
    const table = (bot.registry as unknown as { blockLoot?: Record<string, { drops: { item: string; silkTouch?: boolean }[] }> }).blockLoot;
    return table?.[name]?.drops.filter((d) => !d.silkTouch).map((d) => d.item) ?? null;
  };

const solidAt = (bot: Bot) => (p: { x: number; y: number; z: number }): boolean => bot.blockAt(vec(p))?.boundingBox === "block";

async function nearCell(bot: Bot, at: Vec3): Promise<void> {
  if (bot.entity.position.distanceTo(at.offset(0.5, 0.5, 0.5)) <= REACH_BLOCKS + 1) return;
  await walkWithin(bot, new goals.GoalNear(at.x, at.y, at.z, REACH_BLOCKS), LEG_MS);
}

// the dug cell gets what its block drops back, set against a neighbour
async function putBack(bot: Bot, e: Todo, job: string): Promise<void> {
  const at = vec(e.pos);
  await nearCell(bot, at);
  const view = () => ({ eye: bot.entity.position.offset(0, 1.62, 0), feet: { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }, solid: solidAt(bot) });
  let spot = restoreSpot(e.pos, view());
  if (spot === "stood") {
    // it is in the way of its own undo: out to arm's length, not in the cell
    const goal = new goals.GoalCompositeAll([new goals.GoalNear(at.x, at.y, at.z, REACH_BLOCKS), new goals.GoalInvert(new goals.GoalNear(at.x, at.y, at.z, 1.6))]);
    await walkWithin(bot, goal, LEG_MS);
    spot = restoreSpot(e.pos, view());
  }
  if (spot === "stood") throw new TaskError("stood");
  if (!spot) throw new TaskError("stuck");
  await setDown(bot, e.item, { cell: e.pos, ref: spot.ref, face: spot.face }, job);
}

// Throws `nothing_to_undo`, or `nothing_undone` with the words for why when no cell could be taken back.
export async function undo(bot: Bot, ctx: MineCtx, kind?: UndoKind): Promise<{ detail: string }> {
  const history = journal.history();
  const job = lastJob(history, kind, nameAtOf(bot));
  if (!job) throw new TaskError("nothing_to_undo", kind ? "it has done nothing of that kind to take back" : "it has nothing of its own to take back");
  const plan = planUndo(history, job, nameAtOf(bot), carriedCounts(bot), lootOf(bot));
  const run = undoJob(job, Date.now());
  const skipped: Skip[] = [...plan.skipped];
  let taken = 0;
  let put = 0;

  await setStatus({ task: "taking back its last job" });
  for (const e of plan.todo) {
    ctx.checkStop();
    try {
      if (e.op === "place") {
        // a bed's second half goes with the first
        if (nameAtOf(bot)(e.pos) === e.after) {
          await pickUpBlock(bot, ctx, vec(e.pos), run);
          taken++;
        }
      } else {
        await putBack(bot, e, run);
        put++;
      }
    } catch (err) {
      if (!(err instanceof TaskError) && (err as Error).name !== "StuckError" && (err as Error).message !== "stuck") throw err;
      // rock or a block put there since the plan was made is a change like any other
      const why = /already there/.test((err as TaskError).detail ?? "") ? "changed" : (WHY[(err as Error).message] ?? "stuck");
      log.warn("not undone", { op: e.op, reason: (err as Error).message, detail: (err as TaskError).detail });
      skipped.push({ pos: e.pos, why });
    }
  }
  const detail = undoWords(taken, put, skipped, plan.more);
  if (taken + put === 0) throw new TaskError("nothing_undone", detail);
  return { detail };
}
