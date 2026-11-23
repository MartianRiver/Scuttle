import type { Bot } from "mineflayer";
import { logger } from "../lib/logger";
import { getStatus, setStatus } from "../lib/status";
import { isFleeing } from "./defence";
import { isFalling } from "./fall";
import { chooseFood, noFoodStep, shouldEat, type Carried, type FoodTable } from "./food";
import { isGuardFighting } from "./guard";
import { isInHazard } from "./survive";

const log = logger("survival");

const CHECK_INTERVAL_MS = 5000;
const CONSUME_MS = 5000; // a meal takes 1.6 s; a consume that never ends must not hang the caller

let eating = false;
let reported = false; // `no_food` already sent for this hunger episode

export function foodTable(bot: Bot): FoodTable {
  const table: FoodTable = {};
  for (const [name, f] of Object.entries(bot.registry.foodsByName)) table[name] = { points: f.foodPoints, saturation: f.saturation };
  return table;
}

export const carriedItems = (bot: Bot): Carried[] => bot.inventory.items().map((i) => ({ name: i.name, count: i.count }));

// no reflex has the body and nothing is mid-dig or in an open window
function calm(bot: Bot): boolean {
  return !isFleeing() && !isInHazard() && !isFalling() && !isGuardFighting() && !bot.targetDigBlock && !bot.currentWindow && !bot.isSleeping;
}

async function consumeBounded(bot: Bot): Promise<void> {
  const meal = bot.consume();
  meal.catch(() => {}); // a late rejection after the timeout
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("consume timed out")), CONSUME_MS);
  });
  try {
    await Promise.race([meal, late]);
  } catch (err) {
    bot.deactivateItem();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Eats if hungry, something fit to eat is carried and the body is calm; never throws. A task calls
// this between its steps, the timer below calls it when no task is running, so a meal never swaps
// the tool out of a step that is using it. The hand goes back to what it held.
export async function eatIfSafe(bot: Bot): Promise<void> {
  if (eating || !bot.entity || bot.health <= 0 || !calm(bot) || !shouldEat(bot.food, bot.health)) return;
  const name = chooseFood(carriedItems(bot), foodTable(bot), bot.food, bot.health);
  const item = name && bot.inventory.items().find((i) => i.name === name);
  if (!item) return;

  eating = true;
  const held = bot.heldItem?.type ?? null;
  const task = getStatus().task;
  try {
    log.info("eating", { item: item.name, food: bot.food, health: bot.health });
    await setStatus({ task: `eating ${item.name}` });
    await bot.equip(item, "hand");
    if (calm(bot)) {
      await consumeBounded(bot);
      reported = false;
    }
  } catch (err) {
    log.warn("couldn't eat", { item: item.name, message: (err as Error).message });
  } finally {
    eating = false;
    // a reflex that took the body mid-meal has already chosen what to hold and what the status says
    if (calm(bot)) {
      if (held !== null && bot.heldItem?.type !== held && bot.inventory.items().some((i) => i.type === held)) {
        await bot.equip(held, "hand").catch(() => {});
      }
      await setStatus({ task });
    }
  }
}

// Reactive, not LLM-driven: survival runs on plain code so it costs nothing and can't be talked out
// of eating by a jailbroken prompt. `busy` is true while a task runs: it eats at its own pauses.
// `onNoFood` hears about each hunger episode with nothing to eat, once.
export function startSurvival(bot: Bot, busy: () => boolean, onNoFood: (food: number) => void): () => void {
  const tick = async (): Promise<void> => {
    if (!bot.entity || bot.health <= 0) return;
    const canEat = chooseFood(carriedItems(bot), foodTable(bot), bot.food, bot.health) !== null;
    const step = noFoodStep(reported, bot.food, canEat);
    reported = step.next;
    if (step.emit) {
      log.warn("hungry with nothing to eat", { food: bot.food });
      onNoFood(bot.food);
    }
    if (!busy()) await eatIfSafe(bot);
  };
  const timer = setInterval(() => {
    tick().catch((err) => log.error("survival tick failed", { message: (err as Error).message }));
  }, CHECK_INTERVAL_MS);
  bot.on("death", () => {
    reported = false;
  });
  return () => clearInterval(timer);
}
