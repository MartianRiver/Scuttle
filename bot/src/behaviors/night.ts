// The decision half of going to bed: facts about the clock, the weather and the body in, one verdict
// out. No mineflayer here; bedtime.ts reads the body and acts on the answer.

// The game's own gate, as mineflayer's bot.sleep() applies it (12541 to 23458; the first tick is left out
// so an edge never turns into a refused sleep). A thunderstorm lets a player sleep by day.
export const NIGHT_FROM = 12542;
export const NIGHT_TO = 23458;

// Horizontal blocks from the bed. Under the distance of the test arena (nearest corner 64, fights
// run to about 88 out) so the danger, fight and hazard suites never see it walk off mid-scene.
export const HOME_RANGE = 48;
export const SLEEP_REACH = 3; // blocks to the bed from where bot.sleep() is tried instead of walking

export const START_IDLE_MS = 2_000; // idle this long before a first walk home
export const PREEMPT_BACKOFF_MS = 30_000; // idle this long again after an order, a reflex or damage cut the attempt short
export const FAIL_BACKOFF_MS = 120_000; // after an attempt that failed for a reason (stuck, monsters, bed gone)

export const CANT_SLEEP = ["monsters_nearby", "bed_missing", "bed_occupied", "too_far", "stuck", "other"] as const;
export type CantSleep = (typeof CANT_SLEEP)[number];

export function isNight(timeOfDay: number | null, thunder: boolean): boolean {
  if (thunder) return true;
  return typeof timeOfDay === "number" && timeOfDay >= NIGHT_FROM && timeOfDay <= NIGHT_TO;
}

export interface Facts {
  timeOfDay: number | null;
  thunder: boolean;
  dimension: string | null;
  homeDistance: number; // horizontal, to the bed
  bedDistance: number; // straight line
  idle: boolean; // no action, no task, no reflex has the body
  idleMs: number; // how long it has been idle without a break
  asleep: boolean;
  walking: boolean; // bedtime's own walk or sleep attempt is in flight
  now: number;
  retryAt: number; // no new attempt before this
  sleptTonight: boolean; // the server woke it, so it has had its sleep
}

export type Verdict = "stay" | "go_home" | "sleep" | "too_far";

export function decide(f: Facts): Verdict {
  const overworld = (f.dimension ?? "").replace("minecraft:", "") === "overworld";
  if (!overworld || !isNight(f.timeOfDay, f.thunder)) return "stay";
  if (f.asleep || !f.idle) return "stay";
  if (f.walking) return "go_home"; // keep going; the checks above are what cancel it
  if (f.sleptTonight) return "stay";
  if (f.idleMs < START_IDLE_MS || f.now < f.retryAt) return "stay";
  if (f.homeDistance > HOME_RANGE) return "too_far";
  return f.bedDistance <= SLEEP_REACH ? "sleep" : "go_home";
}

export type Why = CantSleep | "cut" | "not_night";

// What a failed attempt means. `cut` is an order, a reflex or a stop taking the body: no event, and
// the retry waits for the body to be idle again. Only a walk that really failed is `stuck`.
export function whyFailed(err: { name?: string; message: string }, took: { cancelled: boolean; reflex: boolean }): Why {
  if (took.cancelled || took.reflex) return "cut";
  const { name = "", message } = err;
  if (name === "GoalChanged" || name === "PathStopped" || message === "interrupted") return "cut";
  if (message === "stuck" || name === "NoPath" || name === "Timeout") return "stuck";
  if (/monsters nearby/.test(message)) return "monsters_nearby";
  if (/occupied/.test(message)) return "bed_occupied";
  if (/not a bed block|only half bed/.test(message)) return "bed_missing";
  if (/not night/.test(message)) return "not_night";
  return "other";
}

// the retry delay after a failure; a cut one is handled by the loop, which waits for idle
export const backoffFor = (why: Why): number => (why === "cut" || why === "not_night" ? 0 : FAIL_BACKOFF_MS);
