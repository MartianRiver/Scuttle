import type { Bot } from "mineflayer";
import type { goals } from "mineflayer-pathfinder";
import { logger } from "../lib/logger";
import { getStatus } from "../lib/status";
import { bodyStanding } from "../senses/standing";
import { findBank } from "./bank";
import { isFalling } from "./fall";
import { isFleeing } from "./defence";
import { inWater, swimTo } from "./swim";
import { cellAt, isInHazard } from "./survive";
import { judge, MAX_NUDGES, SAMPLE_MS, stuckWords, trim, type Sample, type StuckKind } from "./stuck";

const log = logger("unstuck");

// A walk that goes nowhere ends as `stuck` instead of hanging the action for good, and one the
// planner gives up on (no path) is never taken for an arrival. Used for come_to and the task's
// walks to the table and the chest; follow runs until stopped by design and stays out of it, and
// get_wood's log walks have their own time limits (lib/collect.ts).
export class StuckError extends Error {
  constructor(readonly detail?: string) {
    super("stuck");
  }
}

// words for the mind about why it is stuck and where it was (the status text still names the walk)
const stuckError = (bot: Bot, kind: StuckKind) => new StuckError(stuckWords(kind, getStatus().task, bodyStanding(bot) === "deep_water"));

const NUDGE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reflexActive = (): boolean => isInHazard() || isFalling() || isFleeing();

// something legitimate holds the body still, or has it
function busy(bot: Bot): boolean {
  return Boolean(bot.targetDigBlock || bot.currentWindow || bot.pathfinder.isMining() || bot.pathfinder.isBuilding()) || reflexActive();
}

type Control = "forward" | "back" | "left" | "right" | "jump";

// controls are ours while the goal is down; the pathfinder only drives with one set. `again` is
// asked between pulses so a stop or a reflex is not followed by more moving
async function nudge(bot: Bot, n: number, again: () => boolean): Promise<void> {
  const pulse = async (controls: Control[]) => {
    if (!again()) return;
    for (const c of controls) bot.setControlState(c, true);
    await sleep(NUDGE_MS);
    for (const c of controls) bot.setControlState(c, false);
  };
  try {
    if (n === 1) {
      await pulse(["jump", "forward"]); // off a corner it is wedged on
    } else {
      await pulse(["back"]);
      await pulse(["jump", Math.random() < 0.5 ? "left" : "right", "forward"]);
    }
  } finally {
    for (const c of ["forward", "back", "left", "right", "jump"] as const) bot.setControlState(c, false);
  }
}

// goto with the watchdog. Resolves on arrival; rejects with StuckError when the walk makes no
// progress after the nudges, or when goto resolves without the bot being there (an empty path is
// how the planner says "no way", and goto reports it as success). A goal changed by anyone else
// (stop, a reflex) ends it with goto's own error.
export async function walkTo(bot: Bot, goal: goals.Goal): Promise<void> {
  let samples: Sample[] = [];
  let nudges = 0;
  let verdict: "give_up" | "water" | null = null;
  let rescues = 0; // swims to a bank in this walk
  let nudging: Promise<void> | null = null;
  let ours = false; // goal_updated fired by this function
  let cancelled = false;
  let reached = false;

  const set = <T>(fn: () => T): T => {
    ours = true;
    try {
      return fn();
    } finally {
      ours = false;
    }
  };
  const onGoal = () => {
    if (!ours) cancelled = true;
  };
  const onReached = () => {
    reached = true;
  };
  const owned = () => !cancelled && !reflexActive();
  bot.on("goal_updated", onGoal);
  bot.on("goal_reached", onReached);

  const tick = () => {
    if (nudging || verdict || bot.pathfinder.goal !== goal) return;
    if (busy(bot)) {
      samples = [];
      return;
    }
    const now = Date.now();
    const p = bot.entity.position;
    samples = trim([...samples, { t: now, x: p.x, y: p.y, z: p.z }], now);
    const v = judge(samples, now, { goalSet: true, busy: false, nudges });
    if (v === "ok") return;
    samples = [];
    if (inWater(bot)) {
      // the pathfinder does not get out of water by itself: swim to a bank, then walk on
      log.warn("no progress in water", { position: p });
      verdict = "water";
      set(() => bot.pathfinder.setGoal(null));
      return;
    }
    if (v === "give_up") {
      log.warn("giving up, no progress", { position: p, nudges });
      verdict = "give_up";
      set(() => bot.pathfinder.setGoal(null));
      return;
    }
    nudges++;
    log.info("no progress, nudging", { position: p, n: nudges });
    set(() => bot.pathfinder.setGoal(null)); // rejects the goto below, which waits for the nudge
    nudging = nudge(bot, nudges, owned).catch(() => {});
  };
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error("unstuck tick failed", { message: (err as Error).message });
    }
  }, SAMPLE_MS);

  // out of the water by hand; the first time the walk resumes after it, the second time it ends stuck
  const swimOut = async (): Promise<void> => {
    if (!owned()) throw new Error("interrupted");
    const route = findBank(cellAt(bot), bot.entity.position);
    log.info("swimming to a bank", { found: route !== null, rescues: rescues + 1 });
    if (!route) throw stuckError(bot, "no_bank");
    const out = await swimTo(bot, route, owned);
    if (!owned()) throw new Error("interrupted");
    if (!out) throw stuckError(bot, "no_bank");
    if (++rescues > 1) throw stuckError(bot, "twice");
    samples = [];
  };

  try {
    for (;;) {
      try {
        await set(() => bot.pathfinder.goto(goal));
        if (reached || goal.isEnd(bot.entity.position.floored() as never)) return;
        // goto came back without arriving: nothing to wait on, so a nudge or two, then stuck
        if (!owned()) throw new Error("interrupted");
        if (inWater(bot)) {
          await swimOut();
          continue;
        }
        if (nudges >= MAX_NUDGES) {
          log.warn("no way to the goal", { position: bot.entity.position, nudges });
          throw stuckError(bot, "dry");
        }
        nudges++;
        log.info("goto ended short of the goal, nudging", { position: bot.entity.position, n: nudges });
        await nudge(bot, nudges, owned);
        if (!owned()) throw new Error("interrupted");
      } catch (err) {
        if (err instanceof StuckError || (err as Error).message === "interrupted") throw err;
        if (verdict === "water") {
          verdict = null;
          await swimOut();
          continue;
        }
        if (verdict) throw stuckError(bot, "dry");
        if (!nudging) throw err;
        await nudging;
        nudging = null;
        // a stop or a reflex that came in during the nudge owns the body now
        if (!owned()) throw new Error("interrupted");
      }
    }
  } finally {
    clearInterval(timer);
    bot.removeListener("goal_updated", onGoal);
    bot.removeListener("goal_reached", onReached);
    if (bot.pathfinder.goal === goal) bot.pathfinder.setGoal(null);
  }
}
