import type { Bot } from "mineflayer";
import type { goals } from "mineflayer-pathfinder";
import { StuckError, walkTo } from "./unstuck";

export const WALK_CAP_MS = 90_000;

// walkTo that gives up on a walk that takes too long: the goal is cleared at the deadline, which is what
// ends the walk, and that is told as `stuck` rather than as the pathfinder's own error
export async function walkWithin(bot: Bot, goal: goals.Goal, ms: number = WALK_CAP_MS): Promise<void> {
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    if (bot.pathfinder.goal === goal) bot.pathfinder.setGoal(null);
  }, ms);
  try {
    await walkTo(bot, goal);
  } catch (err) {
    if (late && !(err instanceof StuckError) && (err as Error).message !== "interrupted") throw new StuckError("ran out of time on the way");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// One step that may not run forever: past `ms` its dig and its walk are cut, and past `ms` plus a grace period it is
// let go of whether or not it settled. Resolves true when it ran to its end, false when it was cut or threw.
export async function boundedAttempt(bot: Bot, ms: number, work: () => Promise<unknown>, onError?: (err: Error) => void): Promise<boolean> {
  const giveUp = setTimeout(() => {
    try {
      if (bot.targetDigBlock) bot.stopDigging();
    } catch {
      // nothing to stop
    }
    bot.pathfinder.setGoal(null);
  }, ms);
  let abandonTimer: ReturnType<typeof setTimeout> | undefined;
  const abandoned = new Promise<never>((_, reject) => {
    abandonTimer = setTimeout(() => reject(new Error("attempt abandoned, it did not settle")), ms + 5_000);
  });
  const run = work();
  run.catch(() => {}); // an attempt let go of may still fail later
  try {
    await Promise.race([run, abandoned]);
    return true;
  } catch (err) {
    onError?.(err as Error);
    return false;
  } finally {
    clearTimeout(giveUp);
    clearTimeout(abandonTimer);
  }
}
