import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { goals, Movements } from "mineflayer-pathfinder";
import { logger } from "../lib/logger";
import { pacing, reactionDelay } from "../lib/pacing";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { isGuardFighting } from "./guard";
import { callout, followWard, wardName, wardPosition } from "./escort";
import { mergeThreats, wardThreats } from "./escort-policy";
import { isFalling } from "./fall";
import { isInHazard } from "./survive";
import { mobsWords, noHooks, stanceWords, type ReflexHooks } from "./reflex-words";
import { calm, fleeTarget, LEASH, nearest, step, threatening, watchFlee, type DangerState, type FleeWatch, type Mob, type Self } from "./danger";
import { armourPoints, bestWeapon, chooseStance, cooldownMs, corneredStance, GUARD, isBystander, POLICY, weaponFor, type Stance, type Ward } from "./stance";

const log = logger("defence");

// Highest priority after `stop` and the hazards: when hostile mobs are close the body gives up
// whatever it was doing (ends typed `interrupted`) and either fights or runs, as stance.ts decides
// from its health, weapon and armour. While it guards a player (escort.ts) the ward counts as much as
// the body: mobs near the ward are threats too, the stance rules lean toward fighting (stance.ts GUARD)
// and the leash is measured from the ward. `stop` still wins, but the next sight of the same mob starts
// the reaction delay again. A fight with a player stays with guard.ts.
let state: DangerState = calm();
let mode: "fight" | "flee" | null = null;
let lastGoalAt = 0;
let lastTarget: { x: number; z: number } | null = null;
let anchor: { x: number; z: number } | null = null; // where the first of these runs began; leash and chase are measured from it
let anchorUntil = 0;
let chasing: number | null = null; // id of the mob the pathfinder follows
let nextSwing = 0;
let equipping = false;
let watch: FleeWatch | null = null; // the flee watchdog's view of this run
let cornered = false; // the watchdog tripped: the run is a forced fight, or ends, for the rest of the episode
let holdOffUntil = 0; // after giving up as cornered the reflex stays out of the way for a while
let clearance: number | null = null; // how far the nearest threat is while running, null when not

const HOLD_OFF_MS = 20_000;

// true while mobs have the body, fighting or running
export const isFleeing = (): boolean => state.fleeing;
// blocks to the nearest threat while running from it (not while fighting), else null
export const fleeClearance = (): number | null => (state.fleeing && mode === "flee" ? clearance : null);

let threatNames: string[] = []; // the kinds of the mobs that last counted as threats
export const mobsNearWords = (): string => mobsWords(threatNames);

// the anchor outlives the run: a mob that lost the body walks back, and a fresh anchor per run let
// flee, clear, flee again carry it off the leash a run at a time
const ANCHOR_MS = 60_000;

function reset(keepAnchor = false): void {
  state = calm();
  mode = null;
  lastTarget = null;
  chasing = null;
  watch = null;
  cornered = false;
  clearance = null;
  if (keepAnchor) anchorUntil = Date.now() + ANCHOR_MS;
  else anchor = null;
}

// the API's stop cancels a flee or a fight in progress; danger comes back after a fresh reaction delay
export function noteStop(): void {
  reset();
}

const SCAN_BLOCKS = 40;
const REPLAN_MS = 1000;
const REPLAN_MOVED = 4;
const ARMOUR_SLOTS = [5, 6, 7, 8];
const EYE = 1.62;

function fighter(bot: Bot) {
  const p = bot.entity.position;
  const worn = ARMOUR_SLOTS.map((s) => bot.inventory.slots[s]?.name).filter((n): n is string => Boolean(n));
  return { health: bot.health, weapon: bestWeapon(bot.inventory.items().map((i) => i.name)), armour: armourPoints(worn), x: p.x, y: p.y, z: p.z };
}

// from the eyes to the nearest point of the mob's box, as the server measures attack reach
function reachTo(bot: Bot, e: Entity): number {
  const eye = bot.entity.position.offset(0, EYE, 0);
  const half = (e.width ?? 0.6) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const dx = eye.x - clamp(eye.x, e.position.x - half, e.position.x + half);
  const dy = eye.y - clamp(eye.y, e.position.y, e.position.y + (e.height ?? 1.8));
  const dz = eye.z - clamp(eye.z, e.position.z - half, e.position.z + half);
  return Math.hypot(dx, dy, dz);
}

async function equip(bot: Bot, weapon: string | null): Promise<void> {
  if (!weapon || equipping || bot.heldItem?.name === weapon) return;
  const item = bot.inventory.items().find((i) => i.name === weapon);
  if (!item) return;
  equipping = true;
  try {
    await bot.equip(item, "hand");
  } catch (err) {
    log.warn("couldn't equip", { weapon, message: (err as Error).message });
  } finally {
    equipping = false;
  }
}

// `hooks` hear a run begin, change (running turns into a fight) and end because the mobs are gone or it gave up as
// cornered (not when `stop` cut it short)
export function startDefence(bot: Bot, interrupt: () => void, hooks: ReflexHooks = noHooks): () => void {
  let movements: Movements | null = null;

  const flee = (self: Self, threats: Mob[]): void => {
    chasing = null;
    const target = fleeTarget(self, threats, anchor ?? undefined);
    const moved = lastTarget ? Math.hypot(target.x - lastTarget.x, target.z - lastTarget.z) : Infinity;
    if (moved > REPLAN_MOVED || Date.now() - lastGoalAt > REPLAN_MS) {
      bot.pathfinder.setMovements((movements ??= safeMovements(bot)));
      bot.pathfinder.setGoal(new goals.GoalXZ(target.x, target.z));
      lastGoalAt = Date.now();
      lastTarget = target;
    }
  };

  // close in on the target if it is near and inside the leash, else wait for it; swing when the
  // weapon has charged
  const fight = (target: Mob, ward: Ward | null): void => {
    lastTarget = null;
    const e = target.id !== undefined ? bot.entities[target.id] : undefined;
    if (!e) return;
    const near = Object.values(bot.entities).some(
      (o) => o !== e && o !== bot.entity && isBystander(o.type, o.name ?? "", ward !== null) && o.position.distanceTo(e.position) <= POLICY.sweepClear
    );
    const choice = weaponFor(bot.inventory.items().map((i) => i.name), near);
    const weapon = choice === "wait" ? null : choice;
    if (choice !== "wait") void equip(bot, weapon);
    const far = Math.hypot(e.position.x - bot.entity.position.x, e.position.z - bot.entity.position.z);
    const fromAnchor = anchor ? Math.hypot(e.position.x - anchor.x, e.position.z - anchor.z) : 0;
    if (far <= (ward ? GUARD.chase : POLICY.chase) && fromAnchor <= (ward ? GUARD.leash : LEASH)) {
      if (chasing !== e.id) {
        bot.pathfinder.setMovements((movements ??= safeMovements(bot)));
        bot.pathfinder.setGoal(new goals.GoalFollow(e, 1), true);
        chasing = e.id;
      }
    } else if (ward) {
      // too far to chase: stay with the ward until it comes closer
      chasing = null;
      followWard(bot);
    } else if (chasing !== null) {
      bot.pathfinder.setGoal(null);
      chasing = null;
    }
    const held = bot.heldItem?.name ?? null;
    // bare hands (guarding only) swing whatever is in hand
    if (choice === "wait" || (weapon !== null && held !== weapon) || reachTo(bot, e) > POLICY.reach || Date.now() < nextSwing || equipping) return;
    void bot.lookAt(new Vec3(e.position.x, e.position.y + (e.height ?? 1.8) * 0.8, e.position.z), true).then(() => {
      // a stop, a turn to running or a weapon change during the look cancels the swing
      if (mode === "fight" && (bot.heldItem?.name ?? null) === held && bot.entities[e.id] && reachTo(bot, e) <= POLICY.reach) bot.attack(e);
    });
    nextSwing = Date.now() + cooldownMs(bot.heldItem?.name ?? null);
  };

  const giveUp = (): void => {
    bot.pathfinder.setGoal(null);
    log.warn("cornered and not able to fight, letting go", { health: bot.health });
    reset(true);
    holdOffUntil = Date.now() + HOLD_OFF_MS;
    void setStatus({ task: wardName() ? `guarding ${wardName()}` : "idle" });
    hooks.ended({ what: "mobs", ok: false, detail: "cornered, no way to get clear" });
  };

  // running that gets no further from a threat on top of the body ends in a fight or in letting go
  const checkCornered = (me: ReturnType<typeof fighter>, self: Self, threats: Mob[], stance: Stance): Stance | null => {
    if (stance.act === "fight") {
      watch = null;
      return stance;
    }
    if (!cornered) {
      const w = watchFlee(watch, nearest(self, threats), me.health, self, Date.now());
      watch = w.watch;
      if (!w.cornered) return stance;
      cornered = true;
    }
    return corneredStance(me, threats);
  };

  const tick = (): void => {
    if (!bot.entity || bot.health <= 0 || isGuardFighting() || isInHazard() || isFalling()) return;
    if (Date.now() < holdOffUntil) return;
    const self = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
    const ward = wardPosition(bot);
    const mobs: Mob[] = Object.values(bot.entities)
      .filter((e) => e.type === "hostile" && e.name && (e.position.distanceTo(bot.entity.position) < SCAN_BLOCKS || (ward && e.position.distanceTo(new Vec3(ward.x, ward.y, ward.z)) < SCAN_BLOCKS)))
      .map((e) => ({ id: e.id, name: e.name as string, x: e.position.x, y: e.position.y, z: e.position.z }));

    let threats = threatening(self, mobs, state.fleeing);
    if (ward) {
      threats = mergeThreats(threats, wardThreats(ward, mobs, state.fleeing));
      callout(bot, wardThreats(ward, mobs, false));
    }
    const was = state.fleeing;
    const next = step(state, threats, Date.now(), reactionDelay);
    state = next.state;

    if (!next.flee) {
      if (was) {
        bot.pathfinder.setGoal(null);
        log.info("clear of danger", { was: mode });
        reset(true);
        void setStatus({ task: wardName() ? `guarding ${wardName()}` : "idle" });
        hooks.ended({ what: "mobs", ok: true });
      }
      return;
    }
    if (threats.length > 0) threatNames = threats.map((t) => t.name);

    const me = fighter(bot);
    let stance = chooseStance(me, threats, mode === "fight", ward ?? undefined);
    if (ward) {
      // guarding: the leash is round the ward wherever it walks
      anchor = { x: ward.x, z: ward.z };
      anchorUntil = Date.now() + ANCHOR_MS;
    }
    if (!was) {
      // stale, or left far behind (a teleport, a long walk): start from here
      const away = anchor ? Math.hypot(self.x - anchor.x, self.z - anchor.z) : Infinity;
      if (!ward && (Date.now() > anchorUntil || away > LEASH)) anchor = { x: self.x, z: self.z };
      interrupt();
    }
    // no threat in view this tick (it lingers a moment after one drops out of sight) is not a clear run: Math.min() of nothing is Infinity
    clearance = threats.length > 0 ? nearest(self, threats) : null;
    if (!ward) {
      const forced = checkCornered(me, self, threats, stance);
      if (!forced) {
        giveUp();
        return;
      }
      stance = forced;
    }
    const now = stance.act;
    if (now !== mode) {
      log.warn(now === "fight" ? "fighting" : "fleeing", {
        from: threats.map((t) => t.name),
        health: me.health,
        weapon: me.weapon,
        ...(stance.act === "flee" ? { why: stance.why } : { target: stance.target.name }),
      });
      if (now === "fight") nextSwing = 0;
      const first = mode === null;
      mode = now;
      lastTarget = null;
      chasing = null;
      const fighting = stance.act === "fight" ? (ward ? `fighting for ${wardName()}` : `fighting ${stance.target.name}`) : "fleeing";
      void setStatus({ task: fighting });
      const words = stanceWords(now, threats.map((t) => t.name), stance.act === "flee" ? stance.why : undefined, ward ? "guarding" : cornered ? "cornered" : undefined);
      if (first) hooks.started({ what: "mobs", why: words });
      else hooks.changed({ what: "mobs", why: words });
    }
    if (stance.act === "fight") fight(stance.target, ward);
    else flee(self, threats);
  };

  bot.on("death", () => reset());
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error("defence tick failed", { message: (err as Error).message });
    }
  }, pacing.tickMs);
  return () => clearInterval(timer);
}
