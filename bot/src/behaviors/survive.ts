import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { logger } from "../lib/logger";
import { instinctDelay, pacing } from "../lib/pacing";
import { setStatus } from "../lib/status";
import { calm, step, type DangerState } from "./danger";
import { classify, findEscape, type Cell, type Hazard, type Pos, type Sense } from "./hazard";

const log = logger("survive");

// Lava, fire and running out of air come before everything else, mobs included. The body drops
// what it was doing (ends `interrupted`), turns toward the nearest better cell and moves by hand:
// the pathfinder does not plan from inside lava, and swimming up is just holding jump.
let state: DangerState = calm();
let active: Hazard | null = null;
let burningUntil = 0;
let held: { family: "swim" | "fire"; cell: Pos } | null = null; // the way out stays chosen until reached

export const isInHazard = (): boolean => active !== null;

// the server tells us nothing about being on fire, so a burn is assumed for a while after lava or fire
const BURN_MS = 9000;

// hay and honey only cut a fall to a fifth, still worth steering for
const SOFT = new Set(["cobweb", "ladder", "vine", "weeping_vines", "weeping_vines_plant", "twisting_vines", "twisting_vines_plant", "cave_vines", "cave_vines_plant", "scaffolding", "powder_snow", "slime_block", "hay_block", "honey_block"]);

export function cellAt(bot: Bot) {
  return (x: number, y: number, z: number): Cell => {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) return { solid: true, fluid: null, fire: false }; // unloaded counts as a wall
    const fluid = b.name === "lava" ? "lava" : b.name === "water" || b.name === "bubble_column" ? "water" : null;
    return { solid: b.boundingBox === "block", fluid, fire: b.name === "fire" || b.name === "soul_fire", soft: SOFT.has(b.name) };
  };
}

function sense(bot: Bot): Sense {
  const pos = bot.entity.position;
  const feet = bot.blockAt(pos.floored());
  const head = bot.blockAt(pos.offset(0, 1.6, 0));
  // mineflayer sets isInLava but leaves it out of the types
  const inLava = (bot.entity as { isInLava?: boolean }).isInLava === true || feet?.name === "lava";
  const inFire = [feet, head].some((b) => b?.name === "fire" || b?.name === "soul_fire");
  if (inLava || inFire) burningUntil = Date.now() + BURN_MS;
  if (feet?.name === "water") burningUntil = 0;
  return {
    inLava,
    inFire,
    headInWater: head?.name === "water" || head?.name === "bubble_column",
    feetInWater: feet?.name === "water" || feet?.name === "bubble_column",
    oxygen: bot.oxygenLevel ?? 20,
    burning: Date.now() < burningUntil,
  };
}

function release(bot: Bot): void {
  for (const c of ["forward", "sprint", "jump"] as const) bot.setControlState(c, false);
}

export function startSurvive(bot: Bot, interrupt: () => void): () => void {
  const tick = (): void => {
    if (!bot.entity || bot.health <= 0) return;
    const feel = sense(bot);
    const grid = cellAt(bot);
    let hazard = classify(feel, active);
    const family = hazard === "drowning" ? "swim" : "fire";
    const pos = bot.entity.position;

    if (hazard && (!held || held.family !== family || Math.hypot(held.cell.x + 0.5 - pos.x, held.cell.z + 0.5 - pos.z) < 0.8)) {
      const cell = findEscape(hazard, grid, pos);
      held = cell ? { family, cell } : null;
    }
    // a rescue from the water ends once the head is clear and there is no shore to reach
    if (hazard === "drowning" && !feel.headInWater && !held) hazard = null;

    const was = active;
    const next = step(state, hazard ? [hazard] : [], Date.now(), instinctDelay);
    state = next.state;

    if (!next.flee || !hazard) {
      held = null;
      if (was) {
        release(bot);
        active = null;
        void setStatus({ task: "idle" });
        log.info("clear of hazard", { was });
      }
      return;
    }

    if (!was) {
      log.warn("hazard", { hazard, health: bot.health });
      interrupt();
      bot.pathfinder.setGoal(null);
      void setStatus({ task: `getting out of ${hazard}` });
    }
    active = hazard;

    if (held) void bot.lookAt(new Vec3(held.cell.x + 0.5, pos.y + 1.6, held.cell.z + 0.5), true);
    bot.setControlState("forward", Boolean(held));
    bot.setControlState("sprint", hazard === "burning");
    // up out of water and over the lip of a pool or pit; walking to water to put a burn out needs no jumping
    bot.setControlState("jump", hazard !== "burning");
  };

  bot.on("death", () => {
    state = calm();
    active = null;
    held = null;
    burningUntil = 0;
  });
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error("survive tick failed", { message: (err as Error).message });
    }
  }, pacing.hazardTickMs);
  return () => {
    clearInterval(timer);
    release(bot);
  };
}
