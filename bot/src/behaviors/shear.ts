// `shear {handle}`: walk to a sheep, take shears in hand and use them on it, then pick up the wool. One sheep a call;
// a sheep grows its wool back by eating grass and this never waits for that.
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { goals } from "mineflayer-pathfinder";
import { pickUp } from "../lib/collect";
import { setStatus } from "../lib/status";
import { TaskError } from "./fail";
import type { MineCtx } from "./mine";
import { isWool, readSheep, shearRefusal, type ShearRefusal } from "./shear-plan";
import { walkWithin } from "./walk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the server lets a player use an item on an entity from 3 blocks, eye to its box
const USE_REACH = 3;
const SETTLE_MS = 2_500; // for the sheep's sheared flag to turn over after the use
const TRIES = 2;
const WALK_MS = 20_000;

const woolHeld = (bot: Bot): number => bot.inventory.items().reduce((n, i) => (isWool(i.name) ? n + i.count : n), 0);

const refusalOf = (bot: Bot, e: Entity): ShearRefusal | null => shearRefusal(e.name, readSheep(e.metadata as unknown[] | undefined, bot.registry.entitiesByName.sheep?.metadataKeys));

// eye to the nearest point of the sheep's box
function reachTo(bot: Bot, e: Entity): number {
  const eye = bot.entity.position.offset(0, 1.62, 0);
  const half = (e.width ?? 0.9) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const dx = eye.x - clamp(eye.x, e.position.x - half, e.position.x + half);
  const dy = eye.y - clamp(eye.y, e.position.y, e.position.y + (e.height ?? 1.3));
  const dz = eye.z - clamp(eye.z, e.position.z - half, e.position.z + half);
  return Math.hypot(dx, dy, dz);
}

// Throws its reason as the message: none_held, stale_handle, not_allowed, refused, no_wool, stuck. `approach` is the
// go_to walk to the sheep's handle (it re-walks as the sheep moves).
export async function shear(bot: Bot, ctx: MineCtx, id: number, approach: () => Promise<void>): Promise<{ detail: string }> {
  const shears = bot.inventory.items().find((i) => i.name === "shears");
  if (!shears) throw new TaskError("none_held", "it holds no shears, craft them from two iron ingots");
  const live = (): Entity => {
    const e = bot.entities[id];
    if (!e) throw new TaskError("stale_handle", "that sheep has gone");
    const no = refusalOf(bot, e);
    if (no) throw new TaskError(no.reason, no.detail);
    return e;
  };
  live();

  await setStatus({ task: "shearing a sheep" });
  const woolBefore = woolHeld(bot);
  for (let attempt = 0; attempt < TRIES; attempt++) {
    await approach();
    ctx.checkStop();
    let sheep = live();
    if (reachTo(bot, sheep) > USE_REACH) {
      await walkWithin(bot, new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 1), WALK_MS);
      ctx.checkStop();
      sheep = live();
    }
    await bot.equip(shears, "hand");
    ctx.checkStop();
    sheep = live();
    await bot.activateEntity(sheep);
    for (const until = Date.now() + SETTLE_MS; Date.now() < until && !ctx.stopping(); await sleep(100)) {
      const e = bot.entities[id];
      if (e && refusalOf(bot, e)?.reason === "no_wool") break;
    }
    if (refusalOf(bot, sheep)?.reason === "no_wool") {
      await pickUp(bot, sheep.position, ctx.stopping, isWool);
      if (woolHeld(bot) <= woolBefore) throw new TaskError("stuck", "it shore the sheep but could not pick the wool up");
      return { detail: "shore a sheep and took its wool" };
    }
  }
  throw new TaskError("refused", "the sheep kept its wool, so the server would not let it shear here");
}
