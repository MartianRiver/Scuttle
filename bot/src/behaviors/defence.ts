import type { Bot } from "mineflayer";
import { goals, Movements } from "mineflayer-pathfinder";
import { logger } from "../lib/logger";
import { pacing, reactionDelay } from "../lib/pacing";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { isGuardFighting } from "./guard";
import { calm, fleeTarget, step, threatening, type DangerState, type Mob } from "./danger";

const log = logger("defence");

// Highest priority after `stop`: when hostile mobs are close the body runs from them and gives
// up whatever it was doing (ends typed `interrupted`). `stop` still wins, but the next sight of
// the same mob starts the reaction delay again. A fight with a player stays with guard.ts.
let state: DangerState = calm();
let lastGoalAt = 0;
let lastTarget: { x: number; z: number } | null = null;

export const isFleeing = (): boolean => state.fleeing;

// the API's stop cancels a flee in progress; danger comes back after a fresh reaction delay
export function noteStop(): void {
  state = calm();
}

const SCAN_BLOCKS = 40;
const REPLAN_MS = 1000;
const REPLAN_MOVED = 4;

export function startDefence(bot: Bot, interrupt: () => void): () => void {
  let movements: Movements | null = null;

  const tick = (): void => {
    if (!bot.entity || bot.health <= 0 || isGuardFighting()) return;
    const self = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
    const mobs: Mob[] = Object.values(bot.entities)
      .filter((e) => e.type === "hostile" && e.name && e.position.distanceTo(bot.entity.position) < SCAN_BLOCKS)
      .map((e) => ({ name: e.name as string, x: e.position.x, y: e.position.y, z: e.position.z }));

    const threats = threatening(self, mobs, state.fleeing);
    const was = state.fleeing;
    const next = step(state, threats, Date.now(), reactionDelay);
    state = next.state;

    if (!next.flee) {
      if (was) {
        bot.pathfinder.setGoal(null);
        lastTarget = null;
        void setStatus({ task: "idle" });
        log.info("clear of danger");
      }
      return;
    }

    if (!was) {
      log.warn("fleeing", { from: threats.map((t) => t.name), health: bot.health });
      interrupt();
      void setStatus({ task: "fleeing" });
    }
    movements ??= safeMovements(bot);
    const target = fleeTarget(self, threats);
    const moved = lastTarget ? Math.hypot(target.x - lastTarget.x, target.z - lastTarget.z) : Infinity;
    if (!was || moved > REPLAN_MOVED || Date.now() - lastGoalAt > REPLAN_MS) {
      bot.pathfinder.setMovements(movements);
      bot.pathfinder.setGoal(new goals.GoalXZ(target.x, target.z));
      lastGoalAt = Date.now();
      lastTarget = target;
    }
  };

  bot.on("death", () => {
    state = calm();
    lastTarget = null;
  });
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error("defence tick failed", { message: (err as Error).message });
    }
  }, pacing.tickMs);
  return () => clearInterval(timer);
}
