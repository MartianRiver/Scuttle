import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import "mineflayer-tool"; // types for bot.tool
import { home } from "../lib/home";
import { itemCount } from "../lib/inventory";
import { dig, inReach, pickUp } from "../lib/collect";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";
import { isLiquid, isStandHazard, madeBlocksNear, safeToDig, standOk, type NameAt, type Pos } from "./dig-safety";
import { NoDigMap, noteMade } from "./no-dig";
import { isCandidate, type Cell } from "./ore-plan";
import { StuckError, walkTo } from "./unstuck";

const log = logger("mine");

// The mining loop get_stone and get_iron share: blocks of a given set near home, dug by hand one at
// a time, each one checked by dig-safety.ts first; the pathfinder never gets canDig, so a walk can't
// tunnel. Every wait is bounded and every attempt ends in progress, a skip, a protected zone or a
// stuck count.
const SEARCH_COUNT = 64;
const ZONE_RADIUS = 12; // around a dig the server undid
const ZONE_CAP = 3; // undone digs in one run before it gives up as protected
const PATH_CHECK_MS = 500; // longest it plans a route to a target before choosing it
const FORGET_REVERTED_MS = 30 * 60_000;
const STUCK_CAP = 3; // attempts in a row that gained nothing
const ATTEMPT_MS = 45_000; // one block, walking included
const ABANDON_MS = 5_000;
const REFRESH_CAP = 8; // searches of the world in one run

export interface MineCtx {
  checkStop(): void; // throws when a stop was asked for
  pause(): Promise<void>; // between steps: stop check, a meal if one is due
  stopping(): boolean;
}

export interface MineSpec {
  names: readonly string[]; // the blocks dug
  drop: string; // the item that counts
  target: number; // how many more of it than when it started
  range: number; // from the home table
  minY: number; // nothing at or below this
  looking: string; // status texts
  mining: string;
  xray?: boolean; // test world only: buried blocks are candidates too
}

const keyOf = (p: Pos) => `${p.x},${p.y},${p.z}`;
const nameAtOf =
  (bot: Bot): NameAt =>
  (p) =>
    bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null;

const cellAtOf =
  (bot: Bot) =>
  (p: Pos): Cell | null => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    if (!b) return null;
    if (b.boundingBox !== "empty") return "solid";
    return isLiquid(b.name) ? "liquid" : "air";
  };

// For stone: andesite, diorite and granite drop themselves, not cobblestone, so only `stone` is on its list.
function findTargets(bot: Bot, spec: MineSpec): Vec3[] {
  const cellAt = cellAtOf(bot);
  const ids = spec.names.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const wanted = (b: Block) => {
    if (b.position.y <= spec.minY || !isCandidate(b.position, cellAt, spec.xray === true)) return false;
    // buried blocks can fill the whole list and none of them could be reached
    return !spec.xray || findStand(bot, b.position) !== null;
  };
  return bot.findBlocks({ matching: ids, useExtraInfo: wanted, point: home.craftingTable, maxDistance: spec.range, count: SEARCH_COUNT });
}

function standable(bot: Bot, feet: Vec3): boolean {
  const body = bot.blockAt(feet);
  const head = bot.blockAt(feet.offset(0, 1, 0));
  const floor = bot.blockAt(feet.offset(0, -1, 0));
  if (!body || !head || !floor) return false;
  if (body.boundingBox !== "empty" || head.boundingBox !== "empty" || floor.boundingBox !== "block") return false;
  return ![body, head, floor].some((b) => isStandHazard(b.name));
}

// the cell beside the target, at its level or one under it, that is nearest the body
function findStand(bot: Bot, target: Vec3): Vec3 | null {
  const me = bot.entity.position;
  let best: Vec3 | null = null;
  for (const dy of [0, -1]) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const feet = target.offset(dx, dy, dz);
      if (!standOk(target, feet) || !standable(bot, feet)) continue;
      if (!best || feet.distanceTo(me) < best.distanceTo(me)) best = feet;
    }
  }
  return best;
}

// Where the server undid a dig is remembered for the bot's life (a later task starts out knowing it); the
// builds it runs into are only remembered for one run, since a build can be torn down and nothing here
// would notice.
const reverted = new NoDigMap();

const isTarget = (spec: MineSpec, name: string | null | undefined) => name != null && spec.names.includes(name);

interface Pick {
  pos: Vec3;
  stand: Vec3;
}

// nearest first from where the body is now; whatever fails a check is dropped from the list
function pickTarget(bot: Bot, spec: MineSpec, list: Vec3[], skipped: Set<string>, builds: NoDigMap): Pick | null {
  const me = bot.entity.position;
  list.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
  const nameAt = nameAtOf(bot);
  while (list.length) {
    const pos = list.shift() as Vec3;
    if (skipped.has(keyOf(pos)) || reverted.covers(pos) || builds.covers(pos)) continue;
    if (pos.distanceTo(home.craftingTable) > spec.range || pos.y <= spec.minY) continue;
    if (!isTarget(spec, nameAt(pos))) continue;
    if (!safeToDig(pos, nameAt)) {
      noteMade(builds, madeBlocksNear(pos, nameAt)); // a refusal because of a build teaches the map where it is
      continue;
    }
    const stand = findStand(bot, pos);
    if (stand) return { pos, stand };
  }
  return null;
}

// a target nothing can walk to (a ledge in a pit, the far side of a wall) is dropped here rather than
// found out by the walk timing out; a plan that runs out of time is given the benefit of the doubt
function reachable(bot: Bot, pick: Pick): boolean {
  const goal = new goals.GoalBlock(pick.stand.x, pick.stand.y, pick.stand.z);
  const { status } = bot.pathfinder.getPathTo(bot.pathfinder.movements, goal, PATH_CHECK_MS);
  log.debug("route check", { position: pick.pos, status });
  return status === "success" || status === "timeout";
}

// walk, look again, dig, pick the drop up. Every wait is bounded; the caller reads the world after
async function mineBlock(bot: Bot, ctx: MineCtx, spec: MineSpec, pick: Pick): Promise<void> {
  await walkTo(bot, new goals.GoalBlock(pick.stand.x, pick.stand.y, pick.stand.z));
  ctx.checkStop();
  // the world may have moved on while it walked: judge the block again from where the feet really are
  const live = bot.blockAt(pick.pos);
  const feet = bot.entity.position.floored();
  if (!live || !isTarget(spec, live.name) || !inReach(bot, pick.pos) || !safeToDig(pick.pos, nameAtOf(bot), feet)) return;
  try {
    await bot.tool.equipForBlock(live, { requireHarvest: true });
  } catch {
    return; // bare hands, or too weak a pickaxe, break it and drop nothing
  }
  ctx.checkStop();
  await dig(bot, live, ctx.stopping);
  if (!isTarget(spec, bot.blockAt(pick.pos)?.name) && !ctx.stopping()) {
    await pickUp(bot, pick.pos.offset(0.5, 0.5, 0.5), ctx.stopping, (name) => name === spec.drop);
  }
}

// Returns how many of the drop it gained; throws `protected` or `stuck`. Nothing mined is not an error here, the caller names it.
export async function mineBlocks(bot: Bot, ctx: MineCtx, spec: MineSpec): Promise<number> {
  const have = () => itemCount(bot, spec.drop);
  const start = have();
  await setStatus({ task: spec.looking });
  bot.pathfinder.setMovements(safeMovements(bot));

  const skipped = new Set<string>();
  let reverts = 0;
  const builds = new NoDigMap();
  reverted.forget(FORGET_REVERTED_MS);
  let list: Vec3[] = [];
  let fresh = false; // the list came from a search with nothing mined since
  let searches = 0;
  let stuck = 0;
  let mining = false;

  while (have() - start < spec.target) {
    await ctx.pause();
    const pick = pickTarget(bot, spec, list, skipped, builds);
    if (!pick) {
      if (fresh || searches >= REFRESH_CAP) break;
      list = findTargets(bot, spec);
      searches++;
      fresh = true;
      continue;
    }
    fresh = false;
    if (!reachable(bot, pick)) {
      skipped.add(keyOf(pick.pos));
      continue;
    }
    if (!mining) {
      mining = true;
      await setStatus({ task: spec.mining });
    }

    const before = have();
    let dug = false;
    const markDug = (b: { position: { equals(o: unknown): boolean } }) => {
      if (b.position.equals(pick.pos)) dug = true;
    };
    bot.on("diggingCompleted", markDug);
    bot.on("diggingAborted", markDug);
    const giveUp = setTimeout(() => {
      log.warn("attempt timed out", { position: pick.pos });
      try {
        if (bot.targetDigBlock) bot.stopDigging();
      } catch {
        // nothing to stop
      }
      bot.pathfinder.setGoal(null);
    }, ATTEMPT_MS);
    let abandonTimer: ReturnType<typeof setTimeout> | undefined;
    const abandoned = new Promise<void>((_, reject) => {
      abandonTimer = setTimeout(() => reject(new Error("attempt abandoned, it did not settle")), ATTEMPT_MS + ABANDON_MS);
    });
    const work = mineBlock(bot, ctx, spec, pick);
    work.catch(() => {}); // an attempt given up on may still fail later
    try {
      await Promise.race([work, abandoned]);
    } catch (err) {
      log.warn("mining attempt failed", { message: (err as Error).message, stuck: err instanceof StuckError });
    } finally {
      clearTimeout(giveUp);
      clearTimeout(abandonTimer);
      bot.removeListener("diggingCompleted", markDug);
      bot.removeListener("diggingAborted", markDug);
    }
    ctx.checkStop();

    const standing = isTarget(spec, bot.blockAt(pick.pos)?.name);
    if (have() > before || !standing) {
      stuck = 0;
      continue;
    }
    skipped.add(keyOf(pick.pos));
    // a dig happened and the block is back: the server undid it
    if (dug) {
      reverted.add({ x: pick.pos.x, z: pick.pos.z, r: ZONE_RADIUS, reason: "reverted" });
      reverts++;
      log.warn("protected zone", { position: pick.pos, radius: ZONE_RADIUS, reverts });
      if (reverts >= ZONE_CAP) throw new Error("protected");
      stuck = 0;
      continue;
    }
    if (++stuck >= STUCK_CAP) throw new Error("stuck");
  }

  const gained = have() - start;
  log.info("mining done", { drop: spec.drop, gained });
  return gained;
}

