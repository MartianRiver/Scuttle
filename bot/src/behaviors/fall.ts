import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { logger } from "../lib/logger";
import { pacing } from "../lib/pacing";
import { setStatus } from "../lib/status";
import { findLanding, SAFE_DROP, type Pos } from "./hazard";
import { fallWords, noHooks, type ReflexHooks } from "./reflex-words";
import { cellAt, isInHazard } from "./survive";

const log = logger("fall");

// A fall that will hurt, with water or something soft close enough to drift over: the body steers
// for it in the air. Every tick, since a fall is over in a second or two; the first look comes after
// the instinct delay, like the other hazards. With nothing soft in reach it does nothing, and the
// action it was doing goes on.
let steering: Pos | null = null;

export const isFalling = (): boolean => steering !== null;

const LOOK_MS = 100; // between searches for a landing while none is in reach
const DAMAGE_LAG_MS = 500; // the health update comes a moment after the landing

// `hooks` hear a steered fall begin, and every fall of more than SAFE_DROP blocks end, in words
export function startFall(bot: Bot, interrupt: () => void, hooks: ReflexHooks = noHooks): () => void {
  let top: number | null = null; // the highest point of this time off the ground
  let topAt = 0;
  let topHealth = 20; // health when the fall began
  let lookedAt = 0;

  const report = (fell: number): void => {
    if (fell <= SAFE_DROP || bot.health <= 0 || isInHazard()) return;
    const grid = cellAt(bot);
    const p = bot.entity.position;
    const wet = (bot.entity as { isInWater?: boolean }).isInWater === true;
    const kind = grid(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)).fall;
    const onto = wet ? "water" : kind === "soft" || kind === "cushion" ? "soft" : "hard";
    const before = topHealth; // the next time off the ground starts over from the hurt body
    setTimeout(() => hooks.ended({ what: "fall", ok: true, detail: fallWords(onto, before - bot.health) }), DAMAGE_LAG_MS);
  };

  const land = (): void => {
    const fell = top === null ? 0 : top - bot.entity.position.y;
    top = null;
    report(fell);
    if (!steering) return;
    steering = null;
    bot.setControlState("forward", false);
    log.info("landed", { health: bot.health });
    void setStatus({ task: "idle" });
  };

  const tick = (): void => {
    const e = bot.entity;
    if (!e || bot.health <= 0) return;
    if (e.onGround || (e as { isInWater?: boolean }).isInWater || isInHazard()) return land();
    const pos = e.position;
    if (top === null || pos.y >= top) {
      if (top === null) topHealth = bot.health;
      top = pos.y;
      topAt = Date.now();
      return;
    }
    if (Date.now() - topAt < pacing.instinctMs) return;

    if (!steering) {
      if (Date.now() - lookedAt < LOOK_MS) return;
      lookedAt = Date.now();
      const cell = findLanding(cellAt(bot), pos, top - pos.y, e.velocity.y);
      if (!cell) return;
      steering = cell;
      log.warn("falling, steering for a soft landing", { from: top, at: pos.y, to: cell });
      interrupt();
      hooks.started({ what: "fall", why: "falling, steering for a soft landing" });
      bot.pathfinder.setGoal(null);
      void setStatus({ task: "falling" });
    }
    const cx = steering.x + 0.5;
    const cz = steering.z + 0.5;
    void bot.lookAt(new Vec3(cx, pos.y, cz), true);
    // let go over the middle so momentum doesn't carry it past
    bot.setControlState("forward", Math.hypot(cx - pos.x, cz - pos.z) > 0.25);
  };

  const onTick = (): void => {
    try {
      tick();
    } catch (err) {
      log.error("fall tick failed", { message: (err as Error).message });
    }
  };
  bot.on("physicsTick", onTick);
  bot.on("death", land);
  return () => {
    bot.removeListener("physicsTick", onTick);
    bot.removeListener("death", land);
    if (steering) bot.setControlState("forward", false);
    steering = null;
  };
}
