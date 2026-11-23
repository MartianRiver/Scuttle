import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Vec3 } from "vec3";
import { goals, type Movements } from "mineflayer-pathfinder";
import "mineflayer-tool"; // types for bot.tool
import { isPlainLogName } from "./movement";

// One log, every wait bounded. mineflayer-collectblock's collect() waits for the dropped item with
// no limit, and pathfinder's goto resolves on an empty path, so a drop out of reach (on a canopy,
// in a gap under leaves) hung it for good, and every later collect() queued behind it. Pickup here
// is best effort: a drop that can't be reached is left lying.

const WALK_MS = 15_000;
const DIG_MS = 12_000; // by hand a log takes about 3 s
const PICKUP_MS = 6_000; // for all drops of one log together
const DROP_RADIUS = 2.5; // from the broken block
const TRIES = 3; // walks to one drop

const REACH = 4.5; // survival block reach, from the eye to the nearest point of the block
const EYE = 1.62;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the server's rule, not the pathfinder's: GoalLookAtBlock measures from the feet to the block's
// bottom edge and refuses logs the bot can plainly hit from the ground
export function inReach(bot: Bot, pos: Vec3): boolean {
  const eye = bot.entity.position.offset(0, EYE, 0);
  const clamp = (v: number, lo: number) => Math.max(lo, Math.min(lo + 1, v));
  const dx = eye.x - clamp(eye.x, pos.x);
  const dy = eye.y - clamp(eye.y, pos.y);
  const dz = eye.z - clamp(eye.z, pos.z);
  return Math.hypot(dx, dy, dz) <= REACH;
}

// the goal is cleared when the time runs out, which is what rejects a goto still pending; one a
// reflex has replaced is left alone
async function walk(bot: Bot, goal: goals.Goal, ms: number): Promise<void> {
  const timer = setTimeout(() => {
    if (bot.pathfinder.goal === goal) bot.pathfinder.setGoal(null);
  }, ms);
  try {
    await bot.pathfinder.goto(goal);
  } finally {
    clearTimeout(timer);
    if (bot.pathfinder.goal === goal) bot.pathfinder.setGoal(null);
  }
}

// a stop that lands while dig() is still turning to face the block finds no dig to abort, so the
// dig watches for it itself
export async function dig(bot: Bot, block: Block, shouldStop: () => boolean): Promise<void> {
  const timer = setTimeout(() => {
    if (bot.targetDigBlock) bot.stopDigging();
  }, DIG_MS);
  const watch = setInterval(() => {
    if (shouldStop() && bot.targetDigBlock) bot.stopDigging();
  }, 100);
  try {
    await bot.dig(block);
  } finally {
    clearTimeout(timer);
    clearInterval(watch);
  }
}

function dropsNear(bot: Bot, spot: Vec3, tries: Map<number, number>, wanted: (name: string) => boolean): Entity[] {
  return Object.values(bot.entities)
    .filter((e) => {
      if (e.name !== "item" || !e.isValid || (tries.get(e.id) ?? 0) >= TRIES) return false;
      if (e.position.distanceTo(spot) > DROP_RADIUS) return false;
      const name = e.getDroppedItem()?.name;
      return !name || wanted(name);
    })
    .sort((a, b) => a.position.distanceTo(spot) - b.position.distanceTo(spot));
}

// each drop gets a few tries, by id, since one may still be sliding when first seen; items that
// merge come back under a new id and get theirs
export async function pickUp(
  bot: Bot,
  spot: Vec3,
  shouldStop: () => boolean,
  wanted: (name: string) => boolean = isPlainLogName
): Promise<void> {
  const end = Date.now() + PICKUP_MS;
  const tries = new Map<number, number>();
  await sleep(500); // the drop appears a moment after the break
  while (Date.now() < end && !shouldStop()) {
    const drop = dropsNear(bot, spot, tries, wanted)[0];
    if (!drop) return;
    tries.set(drop.id, (tries.get(drop.id) ?? 0) + 1);
    const { x, y, z } = drop.position;
    try {
      await walk(bot, new goals.GoalNear(x, y, z, 1), Math.min(4_000, end - Date.now()));
    } catch {
      // out of reach or a reflex took over; the next step looks at stop
    }
    // a drop can't be picked up for half a second after it spawns
    const until = Math.min(end, Date.now() + 1_500);
    while (drop.isValid && Date.now() < until && !shouldStop()) await sleep(100);
  }
}

// true when the block is gone at the end. `movements` is the safety gate: nothing it won't break is dug
export async function collectLog(bot: Bot, target: Block, movements: Movements, shouldStop: () => boolean): Promise<boolean> {
  const here = () => bot.blockAt(target.position);
  const live = here();
  if (!live || live.type !== target.type || !movements.safeToBreak(live as never)) return false;

  try {
    await walk(bot, new goals.GoalLookAtBlock(target.position, bot.world), WALK_MS);
  } catch {
    // no path, timeout or a reflex: whether it got in reach is checked below
  }
  if (shouldStop()) return false;
  // goto also resolves on an empty path while the bot is still out of reach; a dig from there
  // fails and would read as the server undoing it
  if (!inReach(bot, target.position)) return false;

  const again = here();
  if (!again || again.type !== target.type) return false;
  try {
    await bot.tool.equipForBlock(again, { requireHarvest: true });
  } catch {
    // dig with what is in hand
  }
  if (shouldStop()) return false;
  try {
    await dig(bot, again, shouldStop);
  } catch {
    return false;
  }
  if (here()?.type !== target.type && !shouldStop()) await pickUp(bot, target.position.offset(0.5, 0.5, 0.5), shouldStop);
  // read last: a dig the server undoes shows as air for a tick or two
  return here()?.type !== target.type;
}
