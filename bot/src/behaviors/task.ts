import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { itemCount, craftItem } from "../lib/inventory";
import { collectLog } from "../lib/collect";
import { gatherMovements, isNaturalLog, isPlainLogName, safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";
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
const ZONE_RADIUS = 12; // blocks around a reverted dig the gather step stays out of
const ZONE_CAP = 3; // protected zones found before the task gives up as protected
const STUCK_CAP = 3; // attempts in a row that gained nothing
const ABANDON_MS = 5_000; // how long a cancelled attempt gets to wind down before the task moves on
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

export type TaskResult = { ok: true } | { ok: false; reason: string };

// reasons the API reports as they are; anything else is the error's message
class TaskFailure extends Error {
  constructor(readonly code: "protected" | "no_trees" | "stuck", message: string) {
    super(message);
  }
}

export async function startTask(bot: Bot, name: string): Promise<TaskResult> {
  if (name !== "get wood") {
    log.warn("unknown task", { name });
    return { ok: false, reason: "unknown task" };
  }
  if (running) {
    log.warn("task refused, one already running", { name });
    return { ok: false, reason: "busy" };
  }

  running = true;
  stopRequested = false;
  try {
    await gatherLogs(bot);
    checkStop();
    await craftBasics(bot);
    checkStop();
    await depositSurplus(bot);
    log.info("get-wood task finished");
    return { ok: true };
  } catch (err) {
    if (stopRequested) return { ok: false, reason: "stopped" };
    log.error("get-wood task failed", { message: (err as Error).message });
    return { ok: false, reason: err instanceof TaskFailure ? err.code : (err as Error).message };
  } finally {
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

type Zone = { x: number; z: number };

const inZone = (zones: Zone[], p: { x: number; z: number }) =>
  zones.some((zn) => Math.hypot(zn.x - p.x, zn.z - p.z) <= ZONE_RADIUS);

function nearestNaturalLog(bot: Bot, skipped: Set<string>, zones: Zone[]) {
  const ids = Object.values(bot.registry.blocksByName)
    .filter((b) => isPlainLogName(b.name))
    .map((b) => b.id);
  // a log cabin next to the bot can fill the nearest few, so look at plenty
  const positions = bot.findBlocks({ matching: ids, maxDistance: SEARCH_RADIUS, count: 256 });
  for (const pos of positions) {
    if (skipped.has(keyOf(pos)) || inZone(zones, pos)) continue;
    const block = bot.blockAt(pos);
    if (block && isNaturalLog(bot, block)) return block;
  }
  return null;
}

async function gatherLogs(bot: Bot): Promise<void> {
  await setStatus({ task: "gathering wood" });
  const movements = gatherMovements(bot);
  bot.pathfinder.setMovements(movements);
  try {
    const skipped = new Set<string>();
    const zones: Zone[] = [];
    let stuck = 0;
    while (totalLogs(bot) < LOG_TARGET) {
      checkStop();
      const block = nearestNaturalLog(bot, skipped, zones);
      if (!block) {
        throw new TaskFailure("no_trees", "no natural trees within range, needs to walk further than this task does yet");
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
        zones.push({ x: block.position.x, z: block.position.z });
        log.warn("protected zone", { position: block.position, radius: ZONE_RADIUS, zones: zones.length });
        if (zones.length >= ZONE_CAP) throw new TaskFailure("protected", "the server keeps undoing my digs, I can't tell where I'm allowed");
        stuck = 0;
        continue;
      }
      if (++stuck >= STUCK_CAP) throw new TaskFailure("stuck", "couldn't get any wood after several tries");
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

  if (surplusLogs <= 0 && surplusPlanks <= 0) return;

  checkStop();
  const chest = await bot.openChest(block);
  try {
    checkStop();
    if (logName && surplusLogs > 0) {
      await chest.deposit(bot.registry.itemsByName[logName].id, null, surplusLogs);
    }
    checkStop();
    if (planksName && surplusPlanks > 0) {
      await chest.deposit(bot.registry.itemsByName[planksName].id, null, surplusPlanks);
    }
  } finally {
    chest.close();
  }
}
