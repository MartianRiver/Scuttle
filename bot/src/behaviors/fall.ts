import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { logger } from "../lib/logger";
import { pacing } from "../lib/pacing";
import { setStatus } from "../lib/status";
import { findLanding, type Pos } from "./hazard";
import { cellAt, isInHazard } from "./survive";

const log = logger("fall");

// A fall that will hurt, with water or something soft close enough to drift over: the body steers
// for it in the air. Every tick, since a fall is over in a second or two; the first look comes after
// the instinct delay, like the other hazards. With nothing soft in reach it does nothing, and the
// action it was doing goes on.
let steering: Pos | null = null;

export const isFalling = (): boolean => steering !== null;

const LOOK_MS = 100; // between searches for a landing while none is in reach

export function startFall(bot: Bot, interrupt: () => void): () => void {
  let top: number | null = null; // the highest point of this time off the ground
  let topAt = 0;
  let lookedAt = 0;

  const land = (): void => {
    top = null;
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
