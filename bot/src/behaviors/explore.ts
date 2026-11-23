// `explore`: walk in a compass direction for a band, a leg at a time, looking around at each stop. The legs are
// short walkTo's toward a point on the line, turned aside when one gets stuck; what it saw comes back as words.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import type { CompassPoint, ExploreBand } from "../api/protocol";
import { home } from "../lib/home";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import type { Observation } from "../senses/compose";
import { isOverworld } from "../senses/observe";
import {
  aimPoint, arrived, blockedWords, budgetMs, DEFAULT_BAND, DETOURS, kindsIn, legTo, mergeKinds, sawWords, tooFar,
  type Ahead, type Spot,
} from "./explore-plan";
import { TaskError } from "./fail";
import type { MineCtx } from "./mine";
import { StuckError } from "./unstuck";
import { walkWithin } from "./walk";

const log = logger("explore");

const LEG_MS = 25_000;
const NO_GAIN_LEGS = 6; // legs in a row that bring it no nearer
const GAIN = 2; // blocks nearer that count as a gain

const sight = (look: Observation) => kindsIn({ blocks: look.blocks as Array<{ what: string }>, near: look.near as Array<{ k?: string }>, stone: look.stone });

// whether an order from here would stay inside the leash
export function canExplore(bot: Bot, dir: CompassPoint, far: ExploreBand = DEFAULT_BAND): boolean {
  if (!isOverworld(bot)) return false;
  const p = bot.entity.position;
  return !tooFar(aimPoint(p, dir, far), home.bed[0]);
}

const dir4 = (dir: CompassPoint): Spot => {
  const to = aimPoint({ x: 0, z: 0 }, dir, "near");
  const len = Math.hypot(to.x, to.z);
  return { x: to.x / len, z: to.z / len };
};

// what is in the cells ahead of the body, nearest first, so a stop can say why
function lookAhead(bot: Bot, dir: CompassPoint): Ahead[] {
  const u = dir4(dir);
  const p = bot.entity.position;
  const out: Ahead[] = [];
  for (let i = 1; i <= 4; i++) {
    const at = new Vec3(Math.floor(p.x + u.x * i), Math.floor(p.y), Math.floor(p.z + u.z * i));
    const feet = bot.blockAt(at);
    const head = bot.blockAt(at.offset(0, 1, 0));
    const floors = [1, 2, 3, 4].map((d) => bot.blockAt(at.offset(0, -d, 0)));
    if (feet?.name === "lava" || floors[0]?.name === "lava") out.push("lava");
    else if (feet?.name === "water" || floors[0]?.name === "water") out.push("water");
    else if (feet?.boundingBox === "block" && head?.boundingBox === "block") out.push("wall");
    else if (floors.every((b) => b && b.boundingBox === "empty" && b.name !== "water")) out.push("drop");
    else out.push("open");
  }
  return out;
}

// Throws `blocked` (with what is in the way) or `stuck`; otherwise returns what it saw on the way.
export async function explore(bot: Bot, ctx: MineCtx, dir: CompassPoint, far: ExploreBand | undefined, look: () => Observation): Promise<{ saw?: string }> {
  const band = far ?? DEFAULT_BAND;
  const start = bot.entity.position;
  const goal = aimPoint(start, dir, band);
  if (!isOverworld(bot) || tooFar(goal, home.bed[0])) throw new TaskError("too_far", "that is past how far from home it goes");

  const first = sight(look());
  let seen = first;
  const deadline = Date.now() + budgetMs(band);
  const dist = (p: Spot) => Math.hypot(goal.x - p.x, goal.z - p.z);
  let best = dist(start);
  let noGain = 0;
  let detour = -1; // index into DETOURS of the turn being tried, -1 for straight on

  await setStatus({ task: `exploring ${dir}` });
  for (;;) {
    ctx.checkStop();
    await ctx.pause();
    const here = bot.entity.position;
    if (arrived(here, goal)) break;
    if (Date.now() > deadline) throw new TaskError("stuck", "ran out of time on the way");
    if (noGain >= NO_GAIN_LEGS || detour >= DETOURS.length) throw blocked(bot, dir);

    const to = legTo(here, goal, detour < 0 ? 0 : DETOURS[detour]);
    if (tooFar(to, home.bed[0])) break; // the leash ends the walk where it is
    try {
      await walkWithin(bot, new goals.GoalNearXZ(to.x, to.z, 2), LEG_MS);
    } catch (err) {
      if (!(err instanceof StuckError)) throw err; // a stop or a reflex owns the body now
      detour++;
      noGain++;
      log.info("leg stuck, turning aside", { detour, detail: err.detail });
      continue;
    }
    seen = mergeKinds(seen, sight(look()));
    const gained = best - dist(bot.entity.position);
    if (gained >= GAIN) {
      best -= gained;
      noGain = 0;
      detour = -1;
    } else {
      noGain++;
      detour++;
    }
  }
  const saw = sawWords(first, seen);
  return saw ? { saw } : {};
}

function blocked(bot: Bot, dir: CompassPoint): TaskError {
  const ahead = lookAhead(bot, dir);
  const why = blockedWords(dir, ahead);
  return new TaskError(ahead.some((a) => a !== "open") ? "blocked" : "stuck", why);
}
