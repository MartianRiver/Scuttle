// `explore`: walk in a compass direction for a band, a leg at a time, looking around at each stop. The legs are
// short walkTo's toward a point on the line, turned aside when one gets stuck; what it saw comes back as words.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import type { CompassPoint, ExploreBand } from "../api/protocol";
import { home } from "../lib/home";
import { logger } from "../lib/logger";
import { dryMovements, safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import type { Observation } from "../senses/compose";
import { isOverworld } from "../senses/observe";
import { wayOut } from "./bank";
import {
  aimPoint, arrived, blockedWords, budgetMs, DEFAULT_BAND, DETOURS, firstHazard, kindsIn, legTo, lineCells, LOOK_PAST, mergeKinds,
  sawWords, SCAN, tooFar, wetWords, type Ahead, type Column, type Spot,
} from "./explore-plan";
import { TaskError } from "./fail";
import { lastFooting, noteFooting } from "./footing";
import type { MineCtx } from "./mine";
import { isFleeing } from "./defence";
import { isFalling } from "./fall";
import { cellAt, isInHazard } from "./survive";
import { inWater, swimTo } from "./swim";
import { StuckError } from "./unstuck";
import { walkWithin } from "./walk";

const log = logger("explore");

const LEG_MS = 25_000;
const NO_GAIN_LEGS = 6; // legs in a row that bring it no nearer
const GAIN = 2; // blocks nearer that count as a gain
const NEAR_WET = 24; // water or lava this many columns ahead or nearer is what stopped it (a leg and a look past it, and some)

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

const WET = new Set(["water", "bubble_column", "kelp", "kelp_plant", "seagrass", "tall_seagrass"]);

// What one column is to a walker: found from the top of a few blocks over its feet down to the first thing it would
// stand on (or swim in). Deep water is more than one block of it, over the walker's knees.
function columnAt(bot: Bot, x: number, z: number, feetY: number): Column {
  let wet = 0;
  for (let y = feetY + 3; y >= feetY - 8; y--) {
    const b = bot.blockAt(new Vec3(x, y, z), false);
    if (!b) return wet > 0 ? "deep" : "unknown";
    if (b.name === "lava") return "lava";
    if (WET.has(b.name)) {
      wet++;
      if (wet >= 2) return "deep";
      continue;
    }
    if (b.boundingBox === "block") return wet > 0 ? "shallow" : "dry";
  }
  return wet > 0 ? "deep" : "dry"; // a long drop is the pathfinder's to refuse
}

const columnsAlong = (bot: Bot, from: Spot, to: Spot, past: number): Column[] => {
  const y = Math.floor(bot.entity.position.y);
  return lineCells(from, to, past).map((c) => columnAt(bot, c.x, c.z, y));
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
  if (!inWater(bot) && bot.entity.onGround) noteFooting(start);
  bot.pathfinder.setMovements(dryMovements(bot));
  try {
    await walk();
  } finally {
    bot.pathfinder.setMovements(safeMovements(bot));
  }
  const saw = sawWords(first, seen);
  return saw ? { saw } : {};

  async function walk(): Promise<void> {
    for (;;) {
      ctx.checkStop();
      await ctx.pause();
      const here = bot.entity.position;
      if (arrived(here, goal)) break;
      if (Date.now() > deadline) throw new TaskError("stuck", "ran out of time on the way");
      if (noGain >= NO_GAIN_LEGS || detour >= DETOURS.length) throw blocked(bot, dir);
  
      // a leg whose line (and a few columns past its end) crosses deep water or lava is not walked: the next turn is
      const angle = detour < 0 ? 0 : DETOURS[detour];
      const to = legTo(here, goal, angle);
      if (tooFar(to, home.bed[0])) break; // the leash ends the walk where it is
      if (firstHazard(columnsAlong(bot, here, to, LOOK_PAST))) {
        detour++;
        noGain++;
        log.info("leg would cross water, turning aside", { detour });
        continue;
      }
      try {
        await walkWithin(bot, new goals.GoalNearXZ(to.x, to.z, 2), LEG_MS);
      } catch (err) {
        if (!(err instanceof StuckError)) throw err; // a stop or a reflex owns the body now
        detour++;
        noGain++;
        log.info("leg stuck, turning aside", { detour, detail: err.detail });
        if (inWater(bot)) await swimBack();
        continue;
      }
      if (inWater(bot)) await swimBack();
      else if (bot.entity.onGround) noteFooting(bot.entity.position);
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
  }

  // a leg that ended in the water: back to the ground it last stood on, by hand, then on
  async function swimBack(): Promise<void> {
    const route = wayOut(cellAt(bot), bot.entity.position, lastFooting(), "footing");
    log.info("in the water, swimming back", { found: route !== null });
    if (!route) throw new TaskError("stuck", "it ended up in the water and found no way out");
    const out = await swimTo(bot, route, () => !ctx.stopping() && !isFleeing() && !isInHazard() && !isFalling());
    ctx.checkStop();
    if (!out) throw new TaskError("stuck", "it could not swim back to dry ground");
    noteFooting(bot.entity.position);
  }
}

// How far water or lava is along the compass line from here, as the words for a stop; null when the line is clear
// for a good way or the stop is for another reason
function wetAhead(bot: Bot, dir: CompassPoint): string | null {
  const u = dir4(dir);
  const p = bot.entity.position;
  const end = { x: p.x + u.x * SCAN, z: p.z + u.z * SCAN };
  const cols = columnsAlong(bot, p, end, 0);
  const hit = firstHazard(cols);
  if (!hit || hit.at > NEAR_WET) return null;
  return wetWords(dir, cols);
}

function blocked(bot: Bot, dir: CompassPoint): TaskError {
  const wet = wetAhead(bot, dir);
  if (wet) return new TaskError("blocked", wet);
  const ahead = lookAhead(bot, dir);
  const why = blockedWords(dir, ahead);
  return new TaskError(ahead.some((a) => a !== "open") ? "blocked" : "stuck", why);
}
