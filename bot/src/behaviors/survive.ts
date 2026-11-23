import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { logger } from "../lib/logger";
import { instinctDelay, pacing } from "../lib/pacing";
import { setStatus } from "../lib/status";
import { waypoint, wayOut, type Route } from "./bank";
import { calm, step, type DangerState } from "./danger";
import { forgetFooting, lastFooting, noteFooting } from "./footing";
import { classify, findEscape, type Cell, type Hazard, type Pos, type Sense } from "./hazard";
import { GAVE_UP_WORDS, HAZARD_WORDS, type ReflexEnd } from "./reflex-words";

const log = logger("survive");

// Lava, fire and running out of air come before everything else, mobs included. The body drops
// what it was doing (ends `interrupted`), turns toward the nearest better cell and moves by hand:
// the pathfinder does not plan from inside lava, and swimming up is just holding jump.
let state: DangerState = calm();
let active: Hazard | null = null;
let episode: Hazard | null = null; // the first hazard of this run of the reflex, what its ending event calls it
let burningUntil = 0;
let held: { family: "swim" | "fire"; cell: Pos; route?: Route } | null = null; // the way out stays chosen until reached
// With no shore and no known ground to swim to, the reflex gives up: it lets go of the body (so the mind may try
// something) and stays out of it until the body is dry or the air is nearly gone.
let quit = false;
let noWaySince: number | null = null;
let searchedAt = 0;

const GIVE_UP_MS = 1500;
const CRITICAL_AIR = 3;
const SEARCH_GAP_MS = 1000; // between searches for a way out while none is known

export const isInHazard = (): boolean => active !== null;
export const hazardWords = (): string | undefined => (active ? HAZARD_WORDS[active] : undefined);

// the server tells us nothing about being on fire, so a burn is assumed for a while after lava or fire
const BURN_MS = 9000;

// minecraft.wiki Fall_damage (2026-11-23). Scaffolding is left out: it only saves a falling player who sneaks
const RESET = new Set(["cobweb", "vine", "weeping_vines", "weeping_vines_plant", "twisting_vines", "twisting_vines_plant", "cave_vines", "cave_vines_plant"]);
const fallKind = (name: string): Cell["fall"] =>
  name === "slime_block" || name === "powder_snow" ? "soft" : name === "hay_block" || name === "honey_block" ? "cushion" : RESET.has(name) ? "reset" : undefined;

export function cellAt(bot: Bot) {
  return (x: number, y: number, z: number): Cell => {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) return { solid: true, fluid: null, fire: false }; // unloaded counts as a wall
    const fluid = b.name === "lava" ? "lava" : b.name === "water" || b.name === "bubble_column" ? "water" : null;
    return { solid: b.boundingBox === "block", fluid, fire: b.name === "fire" || b.name === "soul_fire", fall: fallKind(b.name) };
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
    // a jump at the surface lifts the feet clear for a moment; that is not out of the water
    feetInWater: feet?.name === "water" || feet?.name === "bubble_column" || (!bot.entity.onGround && bot.blockAt(pos.offset(0, -0.6, 0))?.name === "water"),
    oxygen: bot.oxygenLevel ?? 20,
    burning: Date.now() < burningUntil,
  };
}

function release(bot: Bot): void {
  for (const c of ["forward", "sprint", "jump"] as const) bot.setControlState(c, false);
}

// `ended` hears how each run of the reflex ends: clear of the hazard, or given up
export function startSurvive(bot: Bot, interrupt: (detail?: string) => void, ended: (e: ReflexEnd) => void = () => {}): () => void {
  const finish = (ok: boolean, detail?: string): void => {
    const was = active;
    held = null;
    if (!was) return;
    release(bot);
    active = null;
    void setStatus({ task: "idle" });
    ended({ what: episode ?? was, ok, ...(detail && { detail }) });
    episode = null;
  };

  const tick = (): void => {
    if (!bot.entity || bot.health <= 0) return;
    const feel = sense(bot);
    const grid = cellAt(bot);
    const pos = bot.entity.position;
    if (!feel.feetInWater && !feel.headInWater && !feel.inLava && !feel.inFire && bot.entity.onGround) {
      noteFooting(pos);
      quit = false;
    }
    let hazard = classify(feel, active);
    if (quit && hazard === "drowning") {
      if (feel.oxygen > CRITICAL_AIR) hazard = null;
      else quit = false;
    }
    const family = hazard === "drowning" ? "swim" : "fire";

    const reached = held ? Math.hypot(held.cell.x + 0.5 - pos.x, held.cell.z + 0.5 - pos.z) < 0.8 : false;
    if (hazard && (!held || held.family !== family || reached) && (held || Date.now() - searchedAt >= SEARCH_GAP_MS)) {
      const cell = findEscape(hazard, grid, pos);
      // the quick look found no shore in 8 blocks: search through the water itself, then toward ground it stood on
      const route = !cell && hazard === "drowning" ? wayOut(grid, pos, lastFooting()) : null;
      held = cell ? { family, cell } : route ? { family, cell: route.bank, route } : null;
      searchedAt = held ? 0 : Date.now(); // a search that found nothing is not repeated every tick
    }
    // a rescue from the water ends once the head is clear and there is no shore to reach
    if (hazard === "drowning" && !feel.headInWater && !held) hazard = null;

    if (hazard === "drowning" && !held) {
      const now = Date.now();
      noWaySince ??= now;
      if (now - noWaySince > GIVE_UP_MS) {
        log.warn("no way out of the water, letting go", { health: bot.health });
        quit = true;
        noWaySince = null;
        state = calm();
        finish(false, GAVE_UP_WORDS);
        return;
      }
    } else noWaySince = null;

    const was = active;
    const next = step(state, hazard ? [hazard] : [], Date.now(), instinctDelay);
    state = next.state;

    if (!next.flee || !hazard) {
      if (was) log.info("clear of hazard", { was });
      finish(true);
      return;
    }

    if (!was) {
      log.warn("hazard", { hazard, health: bot.health });
      episode = hazard;
      interrupt(HAZARD_WORDS[hazard]);
      bot.pathfinder.setGoal(null);
      void setStatus({ task: `getting out of ${hazard}` });
    }
    active = hazard;

    if (held) {
      const to = held.route ? waypoint(held.route, pos) : held.cell;
      void bot.lookAt(new Vec3(to.x + 0.5, pos.y + 1.6, to.z + 0.5), true);
    }
    bot.setControlState("forward", Boolean(held));
    bot.setControlState("sprint", hazard === "burning");
    // up out of water and over the lip of a pool or pit; walking to water to put a burn out needs no jumping
    bot.setControlState("jump", hazard !== "burning");
  };

  bot.on("death", () => {
    state = calm();
    active = null;
    episode = null;
    held = null;
    quit = false;
    noWaySince = null;
    burningUntil = 0;
    forgetFooting();
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
