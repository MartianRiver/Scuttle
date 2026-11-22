import type { Bot } from "mineflayer";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";

const log = logger("survival");

const HUNGRY_BELOW = 15;
const CHECK_INTERVAL_MS = 5000;

// Reactive, not LLM-driven: survival runs on plain
// code so it costs nothing and can't be talked out of eating by a jailbroken prompt.
export function startSurvival(bot: Bot): () => void {
  const timer = setInterval(() => {
    tick(bot).catch((err) => log.error("survival tick failed", { message: (err as Error).message }));
  }, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function tick(bot: Bot): Promise<void> {
  if (bot.food >= HUNGRY_BELOW) return;

  const food = bot.inventory.items().find((item) => bot.registry.foodsByName[item.name]);
  if (!food) return;

  log.info("eating", { item: food.name, food: bot.food });
  await setStatus({ task: `eating ${food.name}` });
  await bot.equip(food.type, "hand");
  await bot.consume();
  await setStatus({ task: "idle" });
}
