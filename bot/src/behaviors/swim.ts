import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { bodyStanding } from "../senses/standing";
import { waypoint, type Route } from "./bank";

const TICK_MS = 100;
const SWIM_MS = 25_000;
const SWIM_CELL_MS = 700; // a cell of surface swimming takes about half of this
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const inWater = (bot: Bot): boolean => {
  const s = bodyStanding(bot);
  return s === "water" || s === "deep_water";
};

// Swims along a route to its bank by hand (the pathfinder does not plan from inside water): look at
// the next cell, hold forward and jump, which is up out of the water and over the lip. `again` is asked
// every tick, so a stop or a reflex takes the controls back. True when it ends on the bank, out of the water.
export async function swimTo(bot: Bot, route: Route, again: () => boolean, ms = SWIM_MS): Promise<boolean> {
  const end = Date.now() + Math.max(ms, route.path.length * SWIM_CELL_MS); // a long way takes longer
  try {
    while (Date.now() < end && again()) {
      const pos = bot.entity.position;
      const { bank } = route;
      if (!inWater(bot) && Math.hypot(bank.x + 0.5 - pos.x, bank.z + 0.5 - pos.z) < 1.2) return true;
      const to = waypoint(route, pos);
      void bot.lookAt(new Vec3(to.x + 0.5, pos.y + 1.6, to.z + 0.5), true);
      bot.setControlState("forward", true);
      bot.setControlState("jump", true);
      await sleep(TICK_MS);
    }
    return false;
  } finally {
    bot.setControlState("forward", false);
    bot.setControlState("jump", false);
  }
}
