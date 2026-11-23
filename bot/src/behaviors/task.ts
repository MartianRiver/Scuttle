import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import { home } from "../lib/home";
import { itemCount, craftItem } from "../lib/inventory";
import { collectLog } from "../lib/collect";
import { gatherMovements, isNaturalLog, isPlainLogName, safeMovements } from "../lib/movement";
import { getStatus, setStatus } from "../lib/status";
import { logger } from "../lib/logger";
import { TaskError, type FailInfo } from "./fail";
import { planRestock, wantsRestock } from "./food";
import { getIron } from "./iron";
import { ProgressGate } from "./progress";
import { noteRefused, refusedNow, reverted, undoneWords } from "./refused";
import { beginRun, endRun, gotNow, noteStashed, type Counts } from "./run-report";
import { noteLook } from "./stash";
import { getStone } from "./stone";
import { carriedItems, eatIfSafe, foodTable } from "./survival";
import { walkTo } from "./unstuck";

const log = logger("task");

// First rung of the crafting ladder: wood is the only thing Scuttle can gather
// bare-handed, and a wooden pickaxe is the prerequisite for the next rung (stone). Everything
// after this is reactive code, same as survival.ts/guard.ts — no LLM call, no cost.
const LOG_TARGET = 16;
const SEARCH_RADIUS = 64;
const PLANKS_BUFFER = 12; // covers 2 sticks-crafts (2 planks each) + 2 tool heads (3 planks each) + slack
const STICKS_NEEDED = 4; // 2 for the pickaxe, 2 for the axe
const KEEP_LOGS = 4; // spare logs left in inventory (fuel, future crafting) instead of stashed
const ZONE_CAP = 3; // undone digs in one run before the task gives up as protected
const STUCK_CAP = 3; // attempts in a row that gained nothing (the detail says "three")
const ABANDON_MS = 5_000; // how long a cancelled attempt gets to wind down before the task moves on
const PROGRESS_POLL_MS = 1_000;
const ATTEMPT_MS = 40_000; // one log, walking included; a path that never resolves would otherwise hang the task

let running = false;
let stopRequested = false;

export function isTaskRunning(): boolean {
  return running;
}

// each step is guarded: a stop must never throw, whatever state the body is in
function quietly(fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(() => {});
  } catch {
    // nothing left to cancel
  }
}

// from the body API's stop: abandon the task at its next step, abort a dig in flight and put
// any open window (chest, crafting table) away so what it holds goes back to the inventory.
// The pathing goal is cleared by the caller, which is what rejects a goto in flight.
export function requestStop(bot: Bot): void {
  if (!running) return;
  stopRequested = true;
  quietly(() => bot.targetDigBlock && bot.stopDigging());
  quietly(() => bot.currentWindow && bot.closeWindow(bot.currentWindow));
}

function checkStop(): void {
  if (stopRequested) throw new Error("stopped");
}

// between steps, with nothing in hand and no window open: the one place a task lets the body eat
async function pause(bot: Bot): Promise<void> {
  checkStop();
  await eatIfSafe(bot);
  checkStop();
}

// what an action hands back besides `got`: a `store` says what went in, an `explore` what it saw
export interface ActionDone {
  stored?: Counts;
  saw?: string;
}

export type TaskResult = ({ ok: true } & ActionDone | ({ ok: false; reason: string } & FailInfo)) & { got?: Counts };

export interface TaskOptions {
  aim?: Vec3; // the search is centred here instead of at home (or at the body, for wood)
  onProgress?(p: { step: string; got?: Counts }): void;
}

// what a long step needs from the runner: where to look, when to stop, when to eat
export const actionCtx = (bot: Bot, aim?: Vec3) => ({ centre: aim, checkStop, pause: () => pause(bot), stopping: () => stopRequested });
const mineCtx = actionCtx;

const PIPELINES: Record<string, (bot: Bot, aim?: Vec3) => Promise<void>> = {
  "get wood": async (bot, aim) => {
    await gatherLogs(bot, aim);
    await pause(bot);
    await craftBasics(bot);
    await pause(bot);
    await depositSurplus(bot);
  },
  "get stone": (bot, aim) => getStone(bot, mineCtx(bot, aim)),
  "get iron": (bot, aim) => getIron(bot, mineCtx(bot, aim)),
};

export async function startTask(bot: Bot, name: string, opts: TaskOptions = {}): Promise<TaskResult> {
  const pipeline = PIPELINES[name];
  if (!pipeline) {
    log.warn("unknown task", { name });
    return { ok: false, reason: "unknown task" };
  }
  return runAction(bot, name, () => pipeline(bot, opts.aim), opts);
}

// One long step at a time, whatever it is: busy while it runs, stoppable, a progress line on each change of step,
// and what the run gained at the end. `work` throws its reason as the message (a TaskError also carries words).
export async function runAction(bot: Bot, name: string, work: () => Promise<ActionDone | void>, opts: TaskOptions = {}): Promise<TaskResult> {
  if (running) {
    log.warn("task refused, one already running", { name });
    return { ok: false, reason: "busy" };
  }

  running = true;
  stopRequested = false;
  beginRun(bot);
  const gate = new ProgressGate();
  const ticker = opts.onProgress
    ? setInterval(() => {
        const step = getStatus().task;
        if (step !== "idle" && gate.offer(step, Date.now())) opts.onProgress?.({ step, got: gotNow(bot) });
      }, PROGRESS_POLL_MS)
    : null;
  try {
    const done = await work();
    log.info("task finished", { name });
    return { ok: true, got: gotNow(bot), ...(done ?? {}) };
  } catch (err) {
    const got = gotNow(bot);
    if (stopRequested) return { ok: false, reason: "stopped", got };
    log.error("task failed", { name, message: (err as Error).message });
    // the rungs throw their reasons (no_stone, no_ore, no_pickaxe, no_fuel, smelt_failed, protected) as the message
    const info = err as FailInfo;
    return { ok: false, reason: (err as Error).message, detail: info.detail, missing: info.missing, got };
  } finally {
    if (ticker) clearInterval(ticker);
    endRun();
    running = false;
    stopRequested = false;
    await setStatus({ task: "idle" });
  }
}

function totalLogs(bot: Bot): number {
  return bot.inventory.items().reduce((sum, item) => (isPlainLogName(item.name) ? sum + item.count : sum), 0);
}

function pickLogVariant(bot: Bot): string | null {
  const logs = bot.inventory.items().filter((item) => isPlainLogName(item.name));
  logs.sort((a, b) => b.count - a.count);
  return logs[0]?.name ?? null;
}

function hasTool(bot: Bot, name: string): boolean {
  return bot.inventory.items().some((item) => item.name === name);
}

const keyOf = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;

// the nearest natural log to `centre` that is not skipped, and not in a place the server refused
function nearestNaturalLog(bot: Bot, skipped: Set<string>, centre: Vec3): { block: ReturnType<Bot["blockAt"]>; refused: number } {
  const ids = Object.values(bot.registry.blocksByName)
    .filter((b) => isPlainLogName(b.name))
    .map((b) => b.id);
  // a log cabin next to the bot can fill the nearest few, so look at plenty
  const positions = bot.findBlocks({ matching: ids, point: centre, maxDistance: SEARCH_RADIUS, count: 256 });
  let refused = 0;
  for (const pos of positions) {
    if (skipped.has(keyOf(pos))) continue;
    if (reverted.covers(pos)) {
      refused++;
      continue;
    }
    const block = bot.blockAt(pos);
    if (block && isNaturalLog(bot, block)) return { block, refused };
  }
  return { block: null, refused };
}

async function gatherLogs(bot: Bot, aim?: Vec3): Promise<void> {
  await setStatus({ task: "gathering wood" });
  const movements = gatherMovements(bot);
  bot.pathfinder.setMovements(movements);
  try {
    const skipped = new Set<string>();
    let reverts = 0; // undone digs in this run; the places themselves are remembered for the bot's life (refused.ts)
    let stuck = 0;
    while (totalLogs(bot) < LOG_TARGET) {
      await pause(bot);
      const { block, refused } = nearestNaturalLog(bot, skipped, aim ?? bot.entity.position);
      if (!block) {
        // trees left only where digs were undone: nothing else is cuttable, which is `protected` to anyone watching
        if (reverts > 0) throw new TaskError("protected", undoneWords(reverts, "trees", bot.entity.position, refusedNow()));
        throw new TaskError("no_trees", refused > 0 ? "every tree in range is where its digs were undone" : "no natural trees it may cut in range");
      }
      log.info("collecting log", { name: block.name, position: block.position });

      const before = totalLogs(bot);
      let dug = false;
      // leaves get dug on the way too; only a dig of the target itself says anything about the region
      const markDug = (b: { position: { equals(o: unknown): boolean } }) => {
        if (b.position.equals(block.position)) dug = true;
      };
      bot.on("diggingCompleted", markDug);
      bot.on("diggingAborted", markDug);
      // every wait in collectLog is bounded; this only catches what slips through
      const giveUp = setTimeout(() => {
        log.warn("attempt timed out", { position: block.position });
        try {
          if (bot.targetDigBlock) bot.stopDigging();
        } catch {
          // nothing to stop
        }
        bot.pathfinder.setGoal(null);
      }, ATTEMPT_MS);
      let abandonTimer: ReturnType<typeof setTimeout> | undefined;
      const abandoned = new Promise<void>((_, reject) => {
        abandonTimer = setTimeout(() => reject(new Error("attempt abandoned, it did not settle")), ATTEMPT_MS + ABANDON_MS);
      });
      try {
        await Promise.race([collectLog(bot, block, movements, () => stopRequested), abandoned]);
      } catch (err) {
        log.warn("collect failed", { message: (err as Error).message });
      } finally {
        clearTimeout(giveUp);
        clearTimeout(abandonTimer);
        bot.removeListener("diggingCompleted", markDug);
        bot.removeListener("diggingAborted", markDug);
      }
      checkStop();

      // a broken log is progress even when its drop lay out of reach; the loop ends on no_trees
      if (totalLogs(bot) > before || bot.blockAt(block.position)?.name !== block.name) {
        stuck = 0;
        continue;
      }
      skipped.add(keyOf(block.position));
      // a dig happened and the log is back: the server undid it
      if (dug && bot.blockAt(block.position)?.name === block.name) {
        noteRefused(block.position.x, block.position.z);
        reverts++;
        log.warn("protected zone", { position: block.position, reverts });
        if (reverts >= ZONE_CAP) throw new TaskError("protected", undoneWords(reverts, "trees", bot.entity.position, refusedNow()));
        stuck = 0;
        continue;
      }
      if (++stuck >= STUCK_CAP) throw new TaskError("stuck", "three tries in a row got no wood");
    }
  } finally {
    bot.pathfinder.setMovements(safeMovements(bot));
  }
}

async function craftBasics(bot: Bot): Promise<void> {
  await setStatus({ task: "crafting tools" });
  await walkTo(bot, new goals.GoalNear(home.craftingTable.x, home.craftingTable.y, home.craftingTable.z, 2));
  checkStop();
  const table = bot.blockAt(home.craftingTable);
  if (!table) throw new Error("crafting table isn't where I expected it");

  const logName = pickLogVariant(bot);
  if (!logName) throw new Error("no logs in inventory after gathering — this shouldn't happen");
  const planksName = logName.replace("_log", "_planks");

  const stopping = () => stopRequested;
  const planksNeeded = PLANKS_BUFFER - itemCount(bot, planksName);
  if (planksNeeded > 0) {
    const logsToUse = Math.min(Math.ceil(planksNeeded / 4), itemCount(bot, logName));
    if (logsToUse > 0 && !(await craftItem(bot, planksName, logsToUse, null, stopping))) {
      throw new Error(`don't know how to turn ${logName} into planks`);
    }
    checkStop();
  }

  const sticksNeeded = STICKS_NEEDED - itemCount(bot, "stick");
  if (sticksNeeded > 0 && !(await craftItem(bot, "stick", Math.ceil(sticksNeeded / 4), null, stopping))) {
    throw new Error("couldn't craft sticks");
  }
  checkStop();

  if (!hasTool(bot, "wooden_pickaxe") && !(await craftItem(bot, "wooden_pickaxe", 1, table, stopping))) {
    throw new Error("couldn't craft a wooden pickaxe — probably short on planks or sticks");
  }
  checkStop();
  if (!hasTool(bot, "wooden_axe") && !(await craftItem(bot, "wooden_axe", 1, table, stopping))) {
    throw new Error("couldn't craft a wooden axe");
  }
  checkStop();
}

async function depositSurplus(bot: Bot): Promise<void> {
  await setStatus({ task: "stashing wood" });
  const chestPos = home.stashChests[0];
  await walkTo(bot, new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
  checkStop();
  const block = bot.blockAt(chestPos);
  if (!block) throw new Error("stash chest isn't where I expected it");

  const logName = pickLogVariant(bot);
  const surplusLogs = logName ? itemCount(bot, logName) - KEEP_LOGS : 0;
  const planksName = logName?.replace("_log", "_planks");
  const surplusPlanks = planksName ? itemCount(bot, planksName) : 0;

  const table = foodTable(bot);
  const wantFood = wantsRestock(carriedItems(bot), table);
  if (surplusLogs <= 0 && surplusPlanks <= 0 && !wantFood) return;

  checkStop();
  const chest = await bot.openChest(block);
  try {
    checkStop();
    if (logName && surplusLogs > 0) {
      await chest.deposit(bot.registry.itemsByName[logName].id, null, surplusLogs);
      noteStashed(logName, surplusLogs);
    }
    checkStop();
    if (planksName && surplusPlanks > 0) {
      await chest.deposit(bot.registry.itemsByName[planksName].id, null, surplusPlanks);
      noteStashed(planksName, surplusPlanks);
    }
    if (wantFood) {
      // after the deposits, which free slots; the body never walks here for this, it only takes what is on offer
      const inChest = chest.containerItems().map((i) => ({ name: i.name, count: i.count }));
      for (const { name, count } of planRestock(carriedItems(bot), inChest, table)) {
        checkStop();
        log.info("taking food from the stash", { name, count });
        await chest.withdraw(bot.registry.itemsByName[name].id, null, count);
      }
    }
  } finally {
    noteLook(0, chest);
    chest.close();
  }
}
