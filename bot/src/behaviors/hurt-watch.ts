// Reads the body for hurt.ts: what is close, what it stands in, whether it just landed.
import type { Bot } from "mineflayer";
import { logger } from "../lib/logger";
import { HurtGate, hurtCause, type HurtContext } from "./hurt";
import { activeHazard, onFire } from "./survive";

const log = logger("hurt");

const RANGED = new Set(["skeleton", "stray", "bogged", "blaze", "ghast", "pillager"]);
const NEAR = 7;
const NEAR_RANGED = 24;
const MEMORY_MS = 1500; // a creeper that blew up is gone from the entity list by the time the health arrives
const FALL_VY = -0.6;
const AIR_MS = 600;

// `emit` is the API's emit; the events are `hurt` { cause, health }
export function watchHurt(bot: Bot, emit: (event: string, fields: Record<string, unknown>) => void): () => void {
  const gate = new HurtGate();
  let last = bot.health ?? 20;
  let seen: { name: string; at: number } | null = null;
  let airAt = 0;
  let fastest = 0;

  const look = (): void => {
    if (!bot.entity) return;
    let best: { name: string; d: number } | null = null;
    for (const e of Object.values(bot.entities)) {
      if (e.type !== "hostile" || !e.name) continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d <= (RANGED.has(e.name) ? NEAR_RANGED : NEAR) && (!best || d < best.d)) best = { name: e.name, d };
    }
    if (best) seen = { name: best.name, at: Date.now() };
  };

  const physics = (): void => {
    if (!bot.entity) return;
    if (!bot.entity.onGround) {
      airAt = Date.now();
      fastest = Math.min(fastest, bot.entity.velocity.y);
    } else if (Date.now() - airAt > AIR_MS) fastest = 0;
  };

  const context = (): HurtContext => {
    const now = Date.now();
    const head = bot.entity ? bot.blockAt(bot.entity.position.offset(0, 1.6, 0)) : null;
    return {
      hazard: activeHazard(),
      burning: onFire(bot),
      drowning: head?.name === "water" && (bot.oxygenLevel ?? 20) <= 1,
      falling: now - airAt < AIR_MS && fastest < FALL_VY,
      mobs: seen && now - seen.at < MEMORY_MS ? [seen.name] : [],
      food: bot.food ?? 20,
    };
  };

  const onHealth = (): void => {
    const health = bot.health;
    const lost = health < last && health > 0;
    last = health;
    if (!lost) return;
    look();
    const cause = hurtCause(context());
    if (gate.offer(cause, health, Date.now())) {
      log.info("hurt", { cause, health });
      emit("hurt", { cause, health });
    }
  };

  const timer = setInterval(look, 250);
  bot.on("health", onHealth);
  bot.on("physicsTick", physics);
  bot.on("death", () => {
    last = 20;
    gate.reset();
  });
  return () => {
    clearInterval(timer);
    bot.removeListener("health", onHealth);
    bot.removeListener("physicsTick", physics);
  };
}
