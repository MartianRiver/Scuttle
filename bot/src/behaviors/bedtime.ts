import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { goals } from "mineflayer-pathfinder";
import { home } from "../lib/home";
import { logger } from "../lib/logger";
import { getStatus, setStatus } from "../lib/status";
import { isFleeing } from "./defence";
import { isFalling } from "./fall";
import { isGuardFighting } from "./guard";
import { backoffFor, decide, isNight, PREEMPT_BACKOFF_MS, whyFailed, type CantSleep, type Why } from "./night";
import { isTaskRunning } from "./task";
import { walkTo } from "./unstuck";
import { isInHazard } from "./survive";

const log = logger("bedtime");

// The idle level of the arbiter: at night, with nothing else owning the body, walk home and sleep in
// its bed. It never starts over a running action, and any order or reflex ends it (yieldToOrder).
const TICK_MS = 500;
const WAKE_MS = 2_000; // how long an order waits for the body to be up
const HURT_MS = 1_500; // a wake this soon after losing health was damage
const GOING = "going home to sleep";
const SLEEPING = "sleeping";

export interface BedtimeDeps {
  emit(event: string, fields?: Record<string, unknown>): void;
  idle(): boolean; // the dispatcher has no action
}

let attempt: Promise<void> | null = null;
let cancelled = false;
let ourWake = false; // the next wake is one we asked for
let announced = false; // `sleeping` went out, so `woke` is owed

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reflexActive = (): boolean => isFleeing() || isInHazard() || isFalling() || isGuardFighting();

// Orders and reflexes call this before they start moving: the walk home ends, a sleeping body
// gets up, and it resolves once both are done (bounded, so a lost packet never holds an order).
// The synchronous part matters: a reflex sets its own goal right after calling interrupt().
let preempt: (bot: Bot) => Promise<void> = async () => {};
export const yieldToOrder = (bot: Bot): Promise<void> => preempt(bot);

async function wakeUp(bot: Bot): Promise<void> {
  if (!bot.isSleeping) return;
  ourWake = true;
  const up = new Promise<void>((res) => bot.once("wake", () => res()));
  try {
    await bot.wake();
  } catch {
    return;
  }
  await Promise.race([up, sleep(WAKE_MS)]);
}

function findBed(bot: Bot): Block | null | "missing" {
  const found = home.bed.map((p) => bot.blockAt(p));
  const bed = found.find((b): b is Block => Boolean(b) && bot.isABed(b as Block));
  if (bed) return bed;
  return found.every((b) => b === null) ? null : "missing"; // null: the chunk isn't loaded yet
}

// mineflayer has the parser but not the type
const occupied = (bot: Bot, bed: Block): boolean =>
  Boolean((bot as unknown as { parseBedMetadata(b: Block): { occupied: unknown } }).parseBedMetadata(bed).occupied);

const stillOurs = (): boolean => [GOING, SLEEPING].includes(getStatus().task);

export function startBedtime(bot: Bot, deps: BedtimeDeps): () => void {
  let idleSince: number | null = null;
  let retryAt = 0;
  let cut = false; // an order or a reflex ended an attempt; the retry waits for idle
  let sleptTonight = false;
  let lastHurt = 0;
  let lastHealth = bot.health;
  let wasNight = false;
  const reported = new Set<CantSleep>();

  const report = (reason: CantSleep): void => {
    if (reported.has(reason)) return;
    reported.add(reason);
    log.info("can't sleep", { reason });
    deps.emit("cant_sleep", { reason });
  };

  const facts = () => {
    const p = bot.entity.position;
    const bed = home.bed[0];
    return {
      timeOfDay: bot.time.timeOfDay as number | null,
      thunder: bot.isRaining && bot.thunderState > 0,
      dimension: (bot.game.dimension as string | undefined) ?? null,
      homeDistance: Math.hypot(p.x - bed.x, p.z - bed.z),
      bedDistance: p.distanceTo(bed),
    };
  };

  const cancelWalk = (): void => {
    if (!attempt) return;
    cancelled = true;
    bot.pathfinder.setGoal(null);
  };

  preempt = async (b) => {
    if (!attempt && !b.isSleeping) return;
    cut = true;
    retryAt = Date.now() + PREEMPT_BACKOFF_MS;
    cancelWalk();
    const pending = attempt;
    await wakeUp(b);
    if (pending) await Promise.race([pending, sleep(WAKE_MS)]);
  };

  async function run(from: "go_home" | "sleep"): Promise<void> {
    cancelled = false;
    cut = false;
    const bedAt = (): Block | null => {
      const bed = findBed(bot);
      if (bed === "missing") throw new Error("not a bed block");
      return bed;
    };
    const heard: string[] = [];
    const listen = (m: unknown) => void heard.push(String((m as { json?: unknown })?.json ? JSON.stringify((m as { json: unknown }).json) : m));
    try {
      const first = bedAt();
      if (first && occupied(bot, first)) throw new Error("the bed is occupied");
      if (from === "go_home" || !first) {
        void setStatus({ task: GOING });
        const foot = home.bed[0];
        await walkTo(bot, new goals.GoalNear(foot.x, foot.y, foot.z, 2));
      }
      if (cancelled) return;
      const bed = bedAt();
      if (!bed) throw new Error("not a bed block"); // still unloaded on arrival: nothing there to find
      bot.on("message", listen);
      bot.on("actionBar", listen);
      try {
        await bot.sleep(bed);
      } catch (err) {
        const e = err as Error;
        // the server refuses with a chat line and mineflayer only sees the silence
        if (e.message === "bot is not sleeping" && /not_safe|monsters/i.test(heard.join(" "))) throw new Error("there are monsters nearby");
        throw err;
      } finally {
        bot.removeListener("message", listen);
        bot.removeListener("actionBar", listen);
      }
      if (cancelled) await wakeUp(bot);
    } catch (err) {
      const why: Why = whyFailed(err as Error, { cancelled, reflex: reflexActive() });
      log.info("bedtime attempt ended", { why, message: (err as Error).message });
      if (why === "cut") {
        cut = true;
        retryAt = Date.now() + PREEMPT_BACKOFF_MS;
      } else if (why !== "not_night") {
        report(why);
        retryAt = Date.now() + backoffFor(why);
      }
    } finally {
      attempt = null;
      if (stillOurs() && !bot.isSleeping) void setStatus({ task: "idle" });
    }
  }

  const endNight = (): void => {
    if (!wasNight) return;
    wasNight = false;
    reported.clear();
    cut = false;
    retryAt = 0;
    sleptTonight = false;
    log.info("night is over");
  };

  const tick = (): void => {
    if (!bot.entity || bot.health <= 0 || bot.time.timeOfDay === null) return;
    const now = Date.now();
    const f = facts();
    const night = isNight(f.timeOfDay, f.thunder);
    if (night && !wasNight) {
      wasNight = true;
      log.info("night", { timeOfDay: f.timeOfDay, thunder: f.thunder, dimension: f.dimension });
    }
    if (!night) endNight();

    const reflex = reflexActive();
    if (bot.isSleeping && reflex && !ourWake) {
      cut = true;
      void wakeUp(bot);
    }
    const idle = deps.idle() && !isTaskRunning() && !reflex;
    if (!idle) {
      idleSince = null;
      if (cut) retryAt = now + PREEMPT_BACKOFF_MS; // wait out the order or the reflex, then a while more
    } else {
      idleSince ??= now;
    }

    const verdict = decide({
      ...f,
      idle,
      idleMs: idleSince === null ? 0 : now - idleSince,
      asleep: bot.isSleeping,
      walking: attempt !== null,
      now,
      retryAt,
      sleptTonight,
    });
    if (verdict === "stay") {
      cancelWalk();
      return;
    }
    if (verdict === "too_far") {
      report("too_far");
      return;
    }
    if (attempt) return;
    log.info("heading to bed", { verdict, ...f });
    attempt = run(verdict);
  };

  const onSleep = (): void => {
    announced = true;
    log.info("asleep");
    deps.emit("sleeping");
    void setStatus({ task: SLEEPING });
  };
  const onWake = (): void => {
    if (!announced) return;
    announced = false;
    deps.emit("woke");
    if (getStatus().task === SLEEPING) void setStatus({ task: "idle" });
    if (ourWake) {
      ourWake = false;
      return;
    }
    // not asked for: damage gets the usual back-off, anything else at night (the server sending
    // sleepers up) counts as the night's sleep, or it would climb back in every few seconds
    if (Date.now() - lastHurt < HURT_MS) {
      cut = true;
      retryAt = Date.now() + PREEMPT_BACKOFF_MS;
    } else if (wasNight) sleptTonight = true;
  };
  const onHealth = (): void => {
    if (bot.health < lastHealth) lastHurt = Date.now();
    lastHealth = bot.health;
  };
  const onDeath = (): void => {
    announced = false;
    ourWake = false;
    cancelWalk();
  };

  bot.on("sleep", onSleep);
  bot.on("wake", onWake);
  bot.on("health", onHealth);
  bot.on("death", onDeath);
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error("bedtime tick failed", { message: (err as Error).message });
    }
  }, TICK_MS);
  return () => {
    clearInterval(timer);
    bot.removeListener("sleep", onSleep);
    bot.removeListener("wake", onWake);
    bot.removeListener("health", onHealth);
    bot.removeListener("death", onDeath);
    preempt = async () => {};
  };
}
