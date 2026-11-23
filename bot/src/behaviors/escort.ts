import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { goals, type Movements } from "mineflayer-pathfinder";
import { logger } from "../lib/logger";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { CalloutLimiter } from "./callouts";
import { watchWard } from "./escort-policy";
import type { Ward } from "./stance";

const log = logger("escort");

// Guarding a player (the `guard` intent). Not a task: it is a mode the reflexes can interrupt and
// that comes back by itself. While nothing else has the body it keeps following the ward; defence.ts
// reads the ward from here to measure threats and its leash around the player; the ward being gone
// for 15 s ends it. `guard.ts` is the plugin's PvP ladder, a different thing.
interface Escort {
  player: string;
  lost: (err: Error) => void;
  goal: goals.GoalFollow | null;
  followed: Entity | null;
  gone: number | null;
  callouts: CalloutLimiter;
}

let escort: Escort | null = null;
let movements: Movements | null = null;

const TICK_MS = 250;
const FOLLOW_RANGE = 2;

export const isGuarding = (): boolean => escort !== null;

export function wardName(): string | null {
  return escort?.player ?? null;
}

// where the ward stands now, or null when not guarding or the player is out of view
export function wardPosition(bot: Bot): Ward | null {
  const e = escort && bot.players[escort.player]?.entity;
  return e ? { x: e.position.x, y: e.position.y, z: e.position.z } : null;
}

// starts guarding; the promise only ever rejects, with "lost_ward", and ends silently on every other
// way out (a stop or a newer order calls endEscort, death and disconnect clear it below)
export function beginEscort(player: string): Promise<void> {
  return new Promise<void>((_, reject) => {
    escort = { player, lost: reject, goal: null, followed: null, gone: null, callouts: new CalloutLimiter() };
    log.info("guarding", { player });
    void setStatus({ task: `guarding ${player}` });
  });
}

export function endEscort(): void {
  escort = null;
}

// Follow the ward unless that is already the goal. Safe to call every tick: it only touches the
// pathfinder when the goal was taken away (a reflex cleared it) or the ward's entity was replaced.
export function followWard(bot: Bot): void {
  const e = escort && bot.players[escort.player]?.entity;
  if (!escort || !e) return;
  if (escort.goal && escort.followed === e && bot.pathfinder.goal === escort.goal) return;
  escort.goal = new goals.GoalFollow(e, FOLLOW_RANGE);
  escort.followed = e;
  bot.pathfinder.setMovements((movements ??= safeMovements(bot)));
  bot.pathfinder.setGoal(escort.goal, true);
  void setStatus({ task: `guarding ${escort.player}` });
}

// one fixed line at most, from the table in callouts.ts; `near` are the hostile mobs by the ward
export function callout(bot: Bot, near: Array<{ id?: number; name: string }>): void {
  if (!escort) return;
  const line = escort.callouts.next(Date.now(), near, escort.player);
  if (!line) return;
  try {
    bot.chat(line);
  } catch (err) {
    log.warn("callout failed", { message: (err as Error).message });
  }
}

// `reflexActive` says something else has the body (fleeing or fighting mobs, a hazard, a fall, the
// plugin's fight): the guard waits and picks the follow up again when it lets go
export function startEscort(bot: Bot, reflexActive: () => boolean): () => void {
  const drop = () => endEscort();
  bot.on("death", drop);
  bot.on("end", drop);

  const tick = (): void => {
    if (!escort || !bot.entity || bot.health <= 0) return;
    const e = bot.players[escort.player]?.entity;
    const away = e ? bot.entity.position.distanceTo(e.position) : null;
    const watch = watchWard(escort.gone, Date.now(), away);
    escort.gone = watch.since;
    if (watch.lost) {
      const ended = escort;
      log.warn("lost the ward", { player: ended.player });
      endEscort();
      bot.pathfinder.setGoal(null);
      void setStatus({ task: "idle" });
      ended.lost(new Error("lost_ward"));
      return;
    }
    if (!reflexActive()) followWard(bot);
  };

  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error("escort tick failed", { message: (err as Error).message });
    }
  }, TICK_MS);
  return () => {
    clearInterval(timer);
    bot.removeListener("death", drop);
    bot.removeListener("end", drop);
    endEscort();
  };
}
