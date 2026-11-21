import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { itemCount, craftItem } from "../lib/inventory";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";

const log = logger("task");

// First rung of the crafting ladder: wood is the only thing Scuttle can gather
// bare-handed, and a wooden pickaxe is the prerequisite for the next rung (stone). Everything
// after this is reactive code, same as survival.ts/guard.ts — no LLM call, no cost.
const LOG_TARGET = 16;
const SEARCH_RADIUS = 64;
const PLANKS_BUFFER = 12; // covers 2 sticks-crafts (2 planks each) + 2 tool heads (3 planks each) + slack
const STICKS_NEEDED = 4; // 2 for the pickaxe, 2 for the axe
const KEEP_LOGS = 4; // spare logs left in inventory (fuel, future crafting) instead of stashed

let running = false;
let stopRequested = false;

export function isTaskRunning(): boolean {
  return running;
}

// from the body API's stop: abandon the task at its next step and cancel any dig in flight
export function requestStop(bot: Bot): void {
  if (!running) return;
  stopRequested = true;
  bot.collectBlock.cancelTask().catch(() => {});
}

export type TaskResult = { ok: true } | { ok: false; reason: string };

export async function startTask(bot: Bot, name: string): Promise<TaskResult> {
  if (name !== "get wood") {
    bot.chat(`I don't know how to "${name}" yet`);
    return { ok: false, reason: "unknown task" };
  }
  if (running) {
    bot.chat("I'm already busy with something");
    return { ok: false, reason: "busy" };
  }

  running = true;
  stopRequested = false;
  try {
    await gatherLogs(bot);
    if (stopRequested) throw new Error("stopped");
    await craftBasics(bot);
    if (stopRequested) throw new Error("stopped");
    await depositSurplus(bot);
    bot.chat("Got some wood, made a pickaxe and an axe, stashed the rest.");
    return { ok: true };
  } catch (err) {
    if (stopRequested) return { ok: false, reason: "stopped" };
    log.error("get-wood task failed", { message: (err as Error).message });
    bot.chat(`I got stuck getting wood: ${(err as Error).message}`);
    return { ok: false, reason: (err as Error).message };
  } finally {
    running = false;
    stopRequested = false;
    await setStatus({ task: "idle" });
  }
}

function totalLogs(bot: Bot): number {
  return bot.inventory.items().reduce((sum, item) => (item.name.endsWith("_log") ? sum + item.count : sum), 0);
}

function pickLogVariant(bot: Bot): string | null {
  const logs = bot.inventory.items().filter((item) => item.name.endsWith("_log"));
  logs.sort((a, b) => b.count - a.count);
  return logs[0]?.name ?? null;
}

function hasTool(bot: Bot, name: string): boolean {
  return bot.inventory.items().some((item) => item.name === name);
}

async function gatherLogs(bot: Bot): Promise<void> {
  await setStatus({ task: "gathering wood" });
  while (totalLogs(bot) < LOG_TARGET) {
    if (stopRequested) throw new Error("stopped");
    const block = bot.findBlock({ matching: (b) => b.name.endsWith("_log"), maxDistance: SEARCH_RADIUS });
    if (!block) throw new Error("no trees within range — needs to walk further than this task does yet");
    log.info("collecting log", { name: block.name, position: block.position });
    await bot.collectBlock.collect(block);
  }
}

async function craftBasics(bot: Bot): Promise<void> {
  await setStatus({ task: "crafting tools" });
  await bot.pathfinder.goto(
    new goals.GoalNear(home.craftingTable.x, home.craftingTable.y, home.craftingTable.z, 2)
  );
  const table = bot.blockAt(home.craftingTable);
  if (!table) throw new Error("crafting table isn't where I expected it");

  const logName = pickLogVariant(bot);
  if (!logName) throw new Error("no logs in inventory after gathering — this shouldn't happen");
  const planksName = logName.replace("_log", "_planks");

  const planksNeeded = PLANKS_BUFFER - itemCount(bot, planksName);
  if (planksNeeded > 0) {
    const logsToUse = Math.min(Math.ceil(planksNeeded / 4), itemCount(bot, logName));
    if (logsToUse > 0 && !(await craftItem(bot, planksName, logsToUse))) {
      throw new Error(`don't know how to turn ${logName} into planks`);
    }
  }

  const sticksNeeded = STICKS_NEEDED - itemCount(bot, "stick");
  if (sticksNeeded > 0 && !(await craftItem(bot, "stick", Math.ceil(sticksNeeded / 4)))) {
    throw new Error("couldn't craft sticks");
  }

  if (!hasTool(bot, "wooden_pickaxe") && !(await craftItem(bot, "wooden_pickaxe", 1, table))) {
    throw new Error("couldn't craft a wooden pickaxe — probably short on planks or sticks");
  }
  if (!hasTool(bot, "wooden_axe") && !(await craftItem(bot, "wooden_axe", 1, table))) {
    throw new Error("couldn't craft a wooden axe");
  }
}

async function depositSurplus(bot: Bot): Promise<void> {
  await setStatus({ task: "stashing wood" });
  const chestPos = home.stashChests[0];
  await bot.pathfinder.goto(new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
  const block = bot.blockAt(chestPos);
  if (!block) throw new Error("stash chest isn't where I expected it");

  const logName = pickLogVariant(bot);
  const surplusLogs = logName ? itemCount(bot, logName) - KEEP_LOGS : 0;
  const planksName = logName?.replace("_log", "_planks");
  const surplusPlanks = planksName ? itemCount(bot, planksName) : 0;

  if (surplusLogs <= 0 && surplusPlanks <= 0) return;

  const chest = await bot.openChest(block);
  try {
    if (logName && surplusLogs > 0) {
      await chest.deposit(bot.registry.itemsByName[logName].id, null, surplusLogs);
    }
    if (planksName && surplusPlanks > 0) {
      await chest.deposit(bot.registry.itemsByName[planksName].id, null, surplusPlanks);
    }
  } finally {
    chest.close();
  }
}
