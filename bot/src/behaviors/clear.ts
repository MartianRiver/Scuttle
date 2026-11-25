// `clear_trees`: fell every natural tree in a square around the base, nearest first, take what drops, break the small plants
// on the ground and leave everything outside the square standing. Each tree is `collect`'s (the dig rules, the gate and the
// journal are unchanged); this file is the loop around it, with every step bounded. The decisions are clear-plan.ts's.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { base } from "../lib/base";
import { dig, inReach, pickUp } from "../lib/collect";
import { nameAtOf } from "../lib/gate";
import { journal } from "../lib/journal";
import { logger } from "../lib/logger";
import { gatherMovements, isPlainLogName, safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { isOverworld } from "../senses/observe";
import { baseLog, isNaturalAt, pickTrees, type TreeProbe } from "../senses/trees";
import {
  clearRadius, EDGE, MAX_MS, endWords, inBox, isGroundPlant, LEAF_REACH_H, LEAF_ROUND_MS, LEAVES_PER_TREE, nearestTo, nextTree, packNearlyFull, PLANT_ROUND_MS, PLANTS_MAX, rankGot,
  stashPlan, stopWhy, STASH_WALK_MAX, SWEEP_END_MS, SWEEP_ROUND_MS, survey, sweepList, pickLeaves, wantedDrop, type Box, type Drop, type StopWhy, type Tally, type Tree,
} from "./clear-plan";
import { LEASH } from "./explore-plan";
import { TaskError } from "./fail";
import { collect, type Within } from "./harvest";
import type { MineCtx } from "./mine";
import { carried, gotNow } from "./run-report";
import { store } from "./stash";
import { trunkLogs } from "./harvest-plan";
import { StuckError } from "./unstuck";
import { walkWithin } from "./walk";

const log = logger("clear");

const SURVEY_LOGS = 1000;
const SURVEY_TESTS = 600; // trees looked at, each a few hundred block reads
const SITE_WALK_MS = 60_000;
const STEP_WALK_MS = 6_000; // one walk to a leaf or a plant

type Pos = { x: number; y: number; z: number };
const key3 = (p: Pos) => `${p.x},${p.y},${p.z}`;
const key2 = (p: Pos) => `${p.x},${p.z}`;
const vec = (p: Pos) => new Vec3(p.x, p.y, p.z);
const flat = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);

// what a run's end by a rule says, and as which failure if nothing was felled
const ENDED: Record<StopWhy, { words: string; reason: string }> = {
  time: { words: "ran out of time", reason: "stuck" },
  stuck: { words: "three trees in a row would not come down", reason: "stuck" },
  protected: { words: "the server keeps undoing its digs here", reason: "protected" },
};

// one count of what a run did, for the pieces to add to and the end to read
class Run {
  readonly started = Date.now();
  calls = 0; // walks, digs, pickups and stashings, for the log
  tally: Tally = { felled: 0, edge: 0, notNatural: 0, refused: 0, unreachable: 0, tall: 0, plants: 0, ms: 0 };
  stuck = 0;
  undone = 0;
  ended: { words: string; reason: string } | undefined;
  constructor(readonly bot: Bot, readonly ctx: MineCtx, readonly box: Box, readonly within: Within) {}
  get nameAt() {
    return nameAtOf(this.bot);
  }
}

// Throws its reason as the message: too_far, refused, no_trees, protected, stuck, inventory_full; a run that did some work ends well,
// with `detail` saying what was left and why.
export async function clearTrees(bot: Bot, ctx: MineCtx, radius?: number): Promise<{ detail: string; got?: Record<string, number> }> {
  if (!isOverworld(bot)) throw new TaskError("refused", "it only clears trees in the overworld");
  const t = base.craftingTable;
  if (flat(bot.entity.position, t) > LEASH) throw new TaskError("too_far", "it is too far from its base to clear around it");
  const box: Box = { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z), r: clearRadius(radius) };
  // logs only where the trunk is in the square, leaves a little past it: a path never takes a tree that stays
  const within: Within = (p, isLog) => inBox(box, p, isLog ? 0 : LEAF_REACH_H);
  const run = new Run(bot, ctx, box, within);

  await setStatus({ task: "clearing trees" });
  bot.pathfinder.setMovements(safeMovements(bot));
  if (flat(bot.entity.position, box) > box.r + 4) {
    try {
      await walkWithin(bot, new goals.GoalNear(box.x, box.y, box.z, 4), SITE_WALK_MS);
    } catch (err) {
      if (ctx.stopping() || !(err instanceof StuckError)) throw err;
      throw new TaskError("stuck", "it could not get to the base to start");
    }
  }
  ctx.checkStop();

  const found = surveyTrees(run);
  run.tally.edge = found.edge;
  run.tally.notNatural = found.notNatural;
  const todo = [...found.inside];
  log.info("clearing", { radius: box.r, trees: todo.length, edge: found.edge, notNatural: found.notNatural });

  await fellAll(run, todo);
  if (!run.ended) await sweep(run, SWEEP_END_MS);
  if (!run.ended || (run.ended.words !== ENDED.time.words && run.ended.reason !== "protected")) await clearGround(run);
  if (!run.ended) await sweep(run, SWEEP_ROUND_MS);

  run.tally.ms = Date.now() - run.started;
  const got = gotNow(bot, 40);
  log.info("cleared", { ...run.tally, calls: run.calls, got });
  return finish(run, found.inside.length, got && rankGot(got));
}

function finish(run: Run, trees: number, got: Record<string, number> | undefined): { detail: string; got?: Record<string, number> } {
  const { tally, ended } = run;
  const detail = endWords({ ...tally, ended: ended?.words });
  if (tally.felled > 0 || tally.plants > 0) return { detail, ...(got && { got }) };
  // nothing came down and nothing was cleared: say why
  if (trees === 0) throw new TaskError("no_trees", tally.notNatural > 0 ? "the only logs in the square are no tree" : tally.edge > 0 ? "no tree is wholly inside the square, only ones at its edge" : "no natural trees in the square");
  if (ended) throw new TaskError(ended.reason, ended.words);
  if (tally.unreachable > 0) throw new TaskError("stuck", "none of the trees came down");
  if (tally.refused > 0) throw new TaskError("refused", "something a player built is too close to every tree");
  throw new TaskError("no_trees", "the trees were gone by the time it got to them");
}

// ---- finding the trees ----

function surveyTrees(run: Run) {
  const { bot, box } = run;
  const ids = bot.registry.blocksArray.filter((b) => isPlainLogName(b.name)).map((b) => b.id);
  const reach = Math.ceil((box.r + EDGE) * 1.42) + 6;
  const logs = bot.findBlocks({ matching: ids, point: vec(box), maxDistance: reach, count: SURVEY_LOGS });
  const nameAt = run.nameAt;
  const at = (p: Pos) => bot.blockAt(vec(p));
  const probe: TreeProbe = {
    nameAt,
    naturalLeafAt: (p) => {
      const b = at(p);
      return Boolean(b?.name.endsWith("_leaves") && b.getProperties().persistent === false);
    },
    visible: () => true,
  };
  const picked = pickTrees(logs, probe, SURVEY_LOGS, SURVEY_TESTS);
  const columnsOf = (b: Pos) => trunkLogs(b, nameAt).filter((p) => p.y === b.y);
  return survey(box, picked, logs.map((p) => baseLog(p, nameAt)), columnsOf);
}

// ---- the trees ----

async function fellAll(run: Run, todo: Tree[]): Promise<void> {
  const { bot, ctx, tally } = run;
  let n = 0;
  while (todo.length > 0) {
    await ctx.pause();
    const why = stopWhy({ elapsedMs: Date.now() - run.started, stuckInARow: run.stuck, undone: run.undone });
    if (why) {
      run.ended = ENDED[why];
      return;
    }
    if (packNearlyFull(bot.inventory.emptySlotCount())) {
      const stopped = await stashStep(run);
      if (stopped) {
        run.ended = { words: stopped, reason: "inventory_full" };
        return;
      }
    }
    const tree = nextTree(todo, bot.entity.position);
    if (!tree) return;
    todo.splice(todo.indexOf(tree), 1);
    await setStatus({ task: "clearing trees" });
    const t0 = Date.now();
    const calls = run.calls;
    const outcome = await fellOne(run, tree);
    let leaves = 0;
    if (outcome === "felled") {
      leaves = await breakLeaves(run, tree);
      await sweep(run, SWEEP_ROUND_MS);
    }
    log.info("tree", { n: ++n, outcome, ms: Date.now() - t0, leaves, calls: run.calls - calls, left: todo.length, felled: tally.felled });
  }
}

type Outcome = "felled" | "refused" | "unreachable" | "gone" | "protected";

async function fellOne(run: Run, tree: Tree): Promise<Outcome> {
  const { bot, ctx, tally } = run;
  const live = bot.blockAt(vec(tree.base));
  if (!live || !isPlainLogName(live.name)) return "gone";
  const before = trunkLogs(tree.base, run.nameAt);
  let outcome: Outcome = "felled";
  run.calls++;
  try {
    await collect(bot, ctx, { pos: vec(tree.base), name: live.name }, 1, run.within);
  } catch (err) {
    if (ctx.stopping()) throw err; // a stop is not a failed tree
    const reason = (err as Error).message;
    outcome = reason === "refused" ? "refused" : reason === "protected" ? "protected" : reason === "stale_handle" ? "gone" : "unreachable";
    log.info("tree not felled", { reason, detail: (err as TaskError).detail });
  }
  const standing = bot.blockAt(vec(tree.base));
  if (outcome === "felled" && standing && isPlainLogName(standing.name)) outcome = "unreachable"; // it came back or never went
  if (outcome === "felled") {
    tally.felled++;
    run.stuck = 0;
    // logs above the body's reach stay: a trunk the ground cannot reach is told, not climbed
    const left = before.filter((p) => isPlainLogName(run.nameAt(p) ?? "")).length;
    if (left > 0) tally.tall++;
  } else if (outcome === "refused") tally.refused++;
  else if (outcome === "protected") {
    tally.refused++;
    run.undone++;
    run.stuck++;
  } else if (outcome === "unreachable") {
    tally.unreachable++;
    run.stuck++;
  }
  return outcome;
}

// ---- breaking small blocks by hand: a felled tree's leaves, the plants on the ground ----

interface Break {
  cells: Pos[];
  still(p: Pos): boolean; // the block there is still the kind to break
  max: number;
  ms: number;
  job: string;
  movements: ReturnType<typeof safeMovements>;
  goal(p: Vec3): goals.Goal; // where to stand to reach it
}

// nearest first, each walked to if out of reach, each through the dig door; a cell that will not go is let be
async function breakCells(run: Run, b: Break): Promise<number> {
  const { bot, ctx } = run;
  const end = Date.now() + b.ms;
  const skip = new Set<string>();
  let broken = 0;
  bot.pathfinder.setMovements(b.movements);
  try {
    while (broken < b.max && Date.now() < end) {
      await ctx.pause();
      const next = nearestTo(b.cells.filter((p) => !skip.has(key3(p)) && b.still(p)), bot.entity.position)[0];
      if (!next) break;
      skip.add(key3(next)); // one try each; a broken block is not looked at again
      if (!inReach(bot, vec(next))) {
        run.calls++;
        try {
          await walkWithin(bot, b.goal(vec(next)), Math.min(STEP_WALK_MS, end - Date.now()));
        } catch (err) {
          if (ctx.stopping()) throw err;
        }
        if (!inReach(bot, vec(next))) continue;
      }
      const block = bot.blockAt(vec(next));
      if (!block) continue;
      run.calls++;
      try {
        const verdict = await dig(bot, block, ctx.stopping, b.job, { physical: false });
        if (verdict.ok && !b.still(next)) broken++;
      } catch (err) {
        if (ctx.stopping()) throw err;
      }
    }
  } finally {
    bot.pathfinder.setMovements(safeMovements(bot));
  }
  return broken;
}

// the natural leaves of the felled tree that no standing log claims, as far as the hands reach from the ground
async function breakLeaves(run: Run, tree: Tree): Promise<number> {
  const { bot, within } = run;
  const own = new Set(tree.columns.map(key2));
  const at = (p: Pos) => bot.blockAt(vec(p));
  const leafAt = (p: Pos): boolean => {
    const b = at(p);
    return Boolean(b?.name.endsWith("_leaves") && b.getProperties().persistent === false);
  };
  const logAt = (p: Pos): boolean => {
    const n = run.nameAt(p);
    return n !== null && isPlainLogName(n) && !own.has(key2(p));
  };
  const cells = pickLeaves(tree.columns, leafAt, logAt).filter((p) => within(vec(p), false));
  if (cells.length === 0) return 0;
  await setStatus({ task: "taking down the leaves" });
  return breakCells(run, { cells, still: leafAt, max: LEAVES_PER_TREE, ms: LEAF_ROUND_MS, job: "clear", movements: gatherMovements(bot, within), goal: (p) => new goals.GoalLookAtBlock(p, bot.world) });
}

// every small plant in the square, so what is cleared is ready for a block to be set down on it
async function clearGround(run: Run): Promise<void> {
  const { bot, box } = run;
  const ids = bot.registry.blocksArray.filter((b) => isGroundPlant(b.name)).map((b) => b.id);
  if (ids.length === 0) return;
  // a sapling the body planted is its own: a clear does not undo a replant
  const planted = (p: Pos) => journal.ownAt(p, run.nameAt(p) ?? "");
  const cells = bot.findBlocks({ matching: ids, point: vec(box), maxDistance: Math.ceil(box.r * 1.42) + 8, count: 600 }).filter((p) => inBox(box, p) && !planted(p));
  if (cells.length === 0) return;
  await setStatus({ task: "clearing the ground" });
  const still = (p: Pos) => isGroundPlant(run.nameAt(p) ?? "");
  const ms = Math.min(PLANT_ROUND_MS, MAX_MS - (Date.now() - run.started)); // the clock covers the ground too
  if (ms <= 0) return;
  const spec = { still, job: "clear", movements: safeMovements(bot), goal: (p: Vec3) => new goals.GoalNear(p.x, p.y, p.z, 3) };
  const end = Date.now() + ms;
  let broken = 0;
  // a second pass for the cells the first one could not reach or dig
  for (let pass = 0; pass < 2; pass++) {
    const left = pass === 0 ? cells : cells.filter(still);
    if (left.length === 0 || Date.now() >= end || broken >= PLANTS_MAX) break;
    broken += await breakCells(run, { ...spec, cells: left, max: PLANTS_MAX - broken, ms: end - Date.now() });
  }
  run.tally.plants += broken;
  log.info("ground cleared", { plants: broken, found: cells.length });
}

// ---- what dropped ----

function dropsNow(bot: Bot): Drop[] {
  return Object.values(bot.entities)
    .filter((e) => e.name === "item" && e.isValid)
    .map((e) => ({ id: e.id, name: e.getDroppedItem()?.name, pos: { x: e.position.x, y: e.position.y, z: e.position.z } }));
}

// walks to the wanted drops in the square and its ring, nearest first, within the time given
async function sweep(run: Run, ms: number): Promise<void> {
  const { bot, ctx, box } = run;
  const end = Date.now() + ms;
  const tries = new Map<number, number>();
  bot.pathfinder.setMovements(safeMovements(bot));
  while (Date.now() < end) {
    await ctx.pause();
    const next = sweepList(dropsNow(bot), box, bot.entity.position, tries)[0];
    if (!next) return;
    tries.set(next.id, (tries.get(next.id) ?? 0) + 1);
    if (tries.size === 1 && (tries.get(next.id) ?? 0) === 1) await setStatus({ task: "picking up what dropped" });
    run.calls++;
    await pickUp(bot, vec(next.pos), ctx.stopping, wantedDrop);
  }
}

// ---- the pack ----

// walks to the base chests and stores the logs and sticks, saplings past a few, apples past a day's food. Returns words when the run
// has to end: the base is too far to walk back to, the stash has no room, or the pack is still full after it
async function stashStep(run: Run): Promise<string | undefined> {
  const { bot, ctx } = run;
  const here = bot.entity.position;
  const nearest = Math.min(...base.stashChests.map((c) => flat(here, c)));
  if (nearest > STASH_WALK_MAX) return "its pack is full and the base is too far to walk back to";
  const plan = stashPlan(carried(bot));
  if (plan.length === 0) return "its pack is full of things it does not stash";
  await setStatus({ task: "stashing items" });
  for (const { item, count } of plan) {
    run.calls++;
    try {
      await store(bot, ctx, item, count);
    } catch (err) {
      if (ctx.stopping()) throw err;
      const e = err as TaskError;
      log.info("stash step ended", { reason: e.message, detail: e.detail });
      return e.message === "stash_full" ? "the stash chests have no room" : (e.detail ?? "it could not reach the stash");
    }
  }
  return packNearlyFull(bot.inventory.emptySlotCount()) ? "its pack is still full after stashing" : undefined;
}
