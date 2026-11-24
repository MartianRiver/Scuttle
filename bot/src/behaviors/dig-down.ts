// `dig_down`: a staircase cut down toward stone, one step at a time, and `climb_up`, the way back out. The planning is
// dig-down-plan.ts; this walks it: each block checked by dig-safety just before it is dug, every wait bounded.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import "mineflayer-tool"; // types for bot.tool
import { dig } from "../lib/collect";
import { GateRefusal, taskErrorOf } from "../lib/gate";
import { PLACEABLE } from "../lib/policy";
import { placeBlock } from "../lib/place-block";
import { logger } from "../lib/logger";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { madeBlocksNear, type Pos } from "./dig-safety";
import { chooseFacing, depthWords, digStatus, facingsFrom, MAX_STEPS, numberWords, planStep, type Facing, type Grid } from "./dig-down-plan";
import { TaskError } from "./fail";
import { nameAtOf, type MineCtx } from "./mine";
import { noteRefused, refusedNow, reverted, undoneWords } from "./refused";
import { addStep, beginStair, stairBottom, stairFacing, stairTop } from "./stair";
import { inWater } from "./swim";
import { walkWithin } from "./walk";

const log = logger("dig-down");

const STEP_WALK_MS = 25_000;
const CLIMB_MS = 60_000;
const RUN_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const grid = (bot: Bot): Grid => ({
  name: nameAtOf(bot),
  solid: (p) => bot.blockAt(new Vec3(p.x, p.y, p.z))?.boundingBox === "block",
});

// the game's own word on whether a block can be broken at all (bedrock, barriers and the like cannot)
export const canBreak = (bot: Bot) => (name: string) => bot.registry.blocksByName[name]?.diggable !== false;

export const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
export const cellOf = (bot: Bot): Pos => {
  const p = bot.entity.position.floored();
  return { x: p.x, y: p.y, z: p.z };
};

// breaks one block, twice at most: a block that is back after the dig is a place the server protects
export async function breakBlock(bot: Bot, ctx: MineCtx, p: Pos, requireHarvest = false, job = "dig_down"): Promise<void> {
  const at = new Vec3(p.x, p.y, p.z);
  let completed = false;
  const mark = (b: { position: { equals(o: unknown): boolean } }) => {
    if (b.position.equals(at)) completed = true;
  };
  bot.on("diggingCompleted", mark);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const block = bot.blockAt(at);
      if (!block || block.boundingBox !== "block") return;
      try {
        await bot.tool.equipForBlock(block, { requireHarvest });
      } catch {
        // bare hands then
      }
      ctx.checkStop();
      const verdict = await dig(bot, block, ctx.stopping, job).catch((err: Error) => {
        log.warn("dig failed", { message: err.message });
        return undefined;
      });
      if (verdict && !verdict.ok) {
        // the plan said yes a moment ago: a kept-out zone reads as the server's undo does, the rest as the plan's words
        if (verdict.reason === "protected") throw new TaskError("protected", undoneWords(1, "ground", bot.entity.position, refusedNow()));
        throw taskErrorOf(verdict);
      }
      ctx.checkStop();
      await sleep(250); // a dig the server undoes shows as the block again a tick or two later
      if (bot.blockAt(at)?.boundingBox !== "block") return;
    }
  } finally {
    bot.removeListener("diggingCompleted", mark);
  }
  if (completed) {
    noteRefused(p.x, p.z);
    throw new TaskError("protected", undoneWords(1, "ground", bot.entity.position, refusedNow()));
  }
  throw new TaskError("stuck", "it could not break the ground in front");
}

// Throws `refused`, `blocked`, `protected` or `stuck`; returns where it ended up in words.
export async function digDown(bot: Bot, ctx: MineCtx): Promise<{ detail: string }> {
  const g = grid(bot);
  const breakable = canBreak(bot);
  if (inWater(bot) || !bot.entity.onGround) throw new TaskError("stuck", "it is not standing on firm ground");

  let cur = cellOf(bot);
  if (reverted.covers(cur)) throw new TaskError("refused", "that spot is where its digs were undone");
  if (madeBlocksNear(cur, g.name).length > 0) throw new TaskError("refused", "something a player built is too close to start here");
  // a stair it is at the foot of goes on in the same direction
  const foot = stairBottom();
  const goingOn = foot !== null && same(cur, foot);
  let facing: Facing;
  if (goingOn) facing = stairFacing() as Facing;
  else {
    const chosen = chooseFacing(g, cur, facingsFrom(bot.entity.yaw), breakable);
    facing = chosen.facing;
    if (chosen.steps === 0 && (chosen.first.kind === "blocked" || chosen.first.kind === "refused")) {
      throw new TaskError(chosen.first.kind, chosen.first.detail);
    }
  }

  bot.pathfinder.setMovements(safeMovements(bot));
  const deadline = Date.now() + RUN_MS;
  const topY = goingOn ? (stairTop() as Pos).y : cur.y; // how far down it is counts from the top of the stair
  let steps = 0;
  for (;;) {
    await ctx.pause();
    if (Date.now() > deadline) throw new TaskError("stuck", "ran out of time on the way");
    const plan = planStep(g, cur, facing, breakable);
    if (plan.kind === "stop") return { detail: `stone ahead, ${depthWords(topY - cur.y)}` };
    if (plan.kind !== "step") throw new TaskError(plan.kind, plan.detail);
    if (steps >= MAX_STEPS) throw new TaskError("stuck", `no stone within ${numberWords(MAX_STEPS)} steps`);

    await setStatus({ task: digStatus(steps) });
    for (const p of plan.dig) if (g.solid(p)) await breakBlock(bot, ctx, p);
    if (steps === 0 && !goingOn) beginStair(cur, facing);

    await walkWithin(bot, new goals.GoalBlock(plan.to.x, plan.to.y, plan.to.z), STEP_WALK_MS);
    ctx.checkStop();
    if (!same(cellOf(bot), plan.to)) throw new TaskError("stuck", "it could not step down into the hole");
    addStep(plan.to);
    cur = plan.to;
    steps++;
  }
}

// A hole one under the foot of the stair (a floor taken for stone) is a rise of two to the first step: jump and
// set a block under itself, as a player does, until it stands in the foot again. The look down is made on the ground,
// and the block is placed on the first physics tick the feet are clear of the pit's top: a look turned in the air, or a
// poll that lands a tick late, put the packet in after the body had started to fall back into the cell, and the server
// refused it ("the block is still air").
async function fillPit(bot: Bot, ctx: MineCtx, foot: Pos): Promise<void> {
  const items = bot.inventory.items();
  // natural blocks first (PLACEABLE is in that order): cobblestone is on the made list, so a fill of it makes the foot of
  // its own stair look like a build and the next dig there is refused (until the journal, 0.10.0, knows its own blocks)
  const item = PLACEABLE.map((name) => items.find((i) => i.name === name)).find((i) => i !== undefined);
  if (!item) throw new TaskError("stuck", "it is in a hole with nothing to fill it");
  await bot.equip(item, "hand");
  const below = new Vec3(foot.x, foot.y - 2, foot.z); // the pit floor
  const job = `climb_up@${Date.now()}`;
  const tick = () => new Promise<void>((r) => bot.once("physicsTick", () => r()));
  for (let attempt = 0; attempt < 4 && cellOf(bot).y < foot.y; attempt++) {
    ctx.checkStop();
    const floor = bot.blockAt(below);
    if (!floor) return;
    await bot.lookAt(floor.position.offset(0.5, 1, 0.5), true);
    bot.setControlState("jump", true);
    const start = Date.now();
    while (Date.now() - start < 1200 && bot.entity.position.y < foot.y + 0.05) await tick();
    bot.setControlState("jump", false);
    const y = bot.entity.position.y;
    const placed = await placeBlock(bot, floor, new Vec3(0, 1, 0), item.name, job, { swingArm: "right", forceLook: "ignore" }).then(() => true, (err: Error) => {
      if (err instanceof GateRefusal) throw new TaskError("stuck", err.verdict.detail);
      log.warn("place failed", { message: err.message, feetY: y, footY: foot.y, attempt });
      return false;
    });
    if (placed) log.info("pit filled", { attempt, feetY: y, footY: foot.y });
    await sleep(400);
  }
}

// Back up the stair to the cell it started from. Throws `no_stair` or `stuck`.
export async function climbUp(bot: Bot, ctx: MineCtx): Promise<void> {
  const top = stairTop();
  if (!top) throw new TaskError("no_stair", "it has not dug a stair");
  const me = cellOf(bot);
  const out = () => Math.abs(cellOf(bot).y - top.y) <= 1 && Math.hypot(cellOf(bot).x - top.x, cellOf(bot).z - top.z) <= 2;
  if (out()) return;

  await setStatus({ task: "climbing the stair" });
  bot.pathfinder.setMovements(safeMovements(bot));
  ctx.checkStop();
  const foot = stairBottom();
  if (foot && me.x === foot.x && me.z === foot.z && me.y === foot.y - 1) await fillPit(bot, ctx, foot);
  await walkWithin(bot, new goals.GoalBlock(top.x, top.y, top.z), CLIMB_MS);
  ctx.checkStop();
  if (!out()) throw new TaskError("stuck", "it could not get back up the stair");
  log.info("climbed out", { from: me.y - top.y });
}
