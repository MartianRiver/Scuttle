import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import "mineflayer-tool"; // types for bot.tool
import { home } from "../lib/home";
import { itemCount, craftItem } from "../lib/inventory";
import { dig, inReach, pickUp } from "../lib/collect";
import { isPlainLogName, safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { logger } from "../lib/logger";
import { isStandHazard, safeToDig, standOk, type NameAt, type Pos } from "./dig-safety";
import { canMineStone, COBBLE_TARGET, stashAmount, toolPlan } from "./stone-plan";
import { StuckError, walkTo } from "./unstuck";

const log = logger("stone");

// The stone rung: cobblestone from natural stone near home with whatever pickaxe the body holds,
// then stone tools at the home table. Digging is done by hand here, one block at a time, each one
// checked by dig-safety.ts first; the pathfinder never gets canDig, so a walk can't tunnel.
const RANGE = 40; // from the home table
const MIN_Y = 30; // nothing at or below this
const SEARCH_COUNT = 64;
const ZONE_RADIUS = 12; // around a dig the server undid
const ZONE_CAP = 3;
const STUCK_CAP = 3; // attempts in a row that gained nothing
const ATTEMPT_MS = 45_000; // one block, walking included
const ABANDON_MS = 5_000;
const REFRESH_CAP = 8; // searches of the world in one run

export interface StoneCtx {
  checkStop(): void; // throws when a stop was asked for
  pause(): Promise<void>; // between steps: stop check, a meal if one is due
  stopping(): boolean;
}

const cobble = (bot: Bot) => itemCount(bot, "cobblestone");
const keyOf = (p: Pos) => `${p.x},${p.y},${p.z}`;
const nameAtOf =
  (bot: Bot): NameAt =>
  (p) =>
    bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null;

const NEIGHBOURS = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

// Only `stone` is dug: andesite, diorite and granite drop themselves, not cobblestone, so digging
// them gets nothing toward the target.
function findStone(bot: Bot): Vec3[] {
  const exposed = (b: Block) =>
    b.position.y > MIN_Y && NEIGHBOURS.some((d) => bot.blockAt(b.position.plus(d))?.boundingBox === "empty");
  return bot.findBlocks({
    matching: bot.registry.blocksByName.stone.id,
    useExtraInfo: exposed,
    point: home.craftingTable,
    maxDistance: RANGE,
    count: SEARCH_COUNT,
  });
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

type Zone = { x: number; z: number };
const inZone = (zones: Zone[], p: Pos) => zones.some((z) => Math.hypot(z.x - p.x, z.z - p.z) <= ZONE_RADIUS);

interface Pick {
  pos: Vec3;
  stand: Vec3;
}

// nearest first from where the body is now; whatever fails a check is dropped from the list
function pickTarget(bot: Bot, list: Vec3[], skipped: Set<string>, zones: Zone[]): Pick | null {
  const me = bot.entity.position;
  list.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
  const nameAt = nameAtOf(bot);
  while (list.length) {
    const pos = list.shift() as Vec3;
    if (skipped.has(keyOf(pos)) || inZone(zones, pos)) continue;
    if (pos.distanceTo(home.craftingTable) > RANGE || pos.y <= MIN_Y) continue;
    if (nameAt(pos) !== "stone" || !safeToDig(pos, nameAt)) continue;
    const stand = findStand(bot, pos);
    if (stand) return { pos, stand };
  }
  return null;
}

// walk, look again, dig, pick the drop up. Every wait is bounded; the caller reads the world after
async function mineBlock(bot: Bot, ctx: StoneCtx, pick: Pick): Promise<void> {
  await walkTo(bot, new goals.GoalBlock(pick.stand.x, pick.stand.y, pick.stand.z));
  ctx.checkStop();
  // the world may have moved on while it walked: judge the block again from where the feet really are
  const live = bot.blockAt(pick.pos);
  const feet = bot.entity.position.floored();
  if (!live || live.name !== "stone" || !inReach(bot, pick.pos) || !safeToDig(pick.pos, nameAtOf(bot), feet)) return;
  try {
    await bot.tool.equipForBlock(live, { requireHarvest: true });
  } catch {
    return; // bare hands break stone and drop nothing
  }
  ctx.checkStop();
  await dig(bot, live, ctx.stopping);
  if (bot.blockAt(pick.pos)?.name !== "stone" && !ctx.stopping()) {
    await pickUp(bot, pick.pos.offset(0.5, 0.5, 0.5), ctx.stopping, (name) => name === "cobblestone");
  }
}

async function mineCobble(bot: Bot, ctx: StoneCtx, start: number): Promise<void> {
  await setStatus({ task: "looking for stone" });
  bot.pathfinder.setMovements(safeMovements(bot));

  const skipped = new Set<string>();
  const zones: Zone[] = [];
  let list: Vec3[] = [];
  let fresh = false; // the list came from a search with nothing mined since
  let searches = 0;
  let stuck = 0;
  let mining = false;

  while (cobble(bot) - start < COBBLE_TARGET) {
    await ctx.pause();
    const pick = pickTarget(bot, list, skipped, zones);
    if (!pick) {
      if (fresh || searches >= REFRESH_CAP) break;
      list = findStone(bot);
      searches++;
      fresh = true;
      continue;
    }
    fresh = false;
    if (!mining) {
      mining = true;
      await setStatus({ task: "mining stone" });
    }

    const before = cobble(bot);
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
    const work = mineBlock(bot, ctx, pick);
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

    const standing = bot.blockAt(pick.pos)?.name === "stone";
    if (cobble(bot) > before || !standing) {
      stuck = 0;
      continue;
    }
    skipped.add(keyOf(pick.pos));
    // a dig happened and the stone is back: the server undid it
    if (dug) {
      zones.push({ x: pick.pos.x, z: pick.pos.z });
      log.warn("protected zone", { position: pick.pos, radius: ZONE_RADIUS, zones: zones.length });
      if (zones.length >= ZONE_CAP) throw new Error("protected");
      stuck = 0;
      continue;
    }
    if (++stuck >= STUCK_CAP) throw new Error("stuck");
  }

  if (cobble(bot) - start <= 0) throw new Error("no_stone");
  log.info("mining done", { gained: cobble(bot) - start });
}

// sticks from planks, planks from a log, if that is what it holds; false when it can't
async function ensureSticks(bot: Bot, need: number, stopping: () => boolean): Promise<boolean> {
  const missing = need - itemCount(bot, "stick");
  if (missing <= 0) return true;
  const crafts = Math.ceil(missing / 4);
  const planks = bot.inventory.items().filter((i) => i.name.endsWith("_planks")).reduce((n, i) => n + i.count, 0);
  if (planks < crafts * 2) {
    const logItem = bot.inventory.items().find((i) => isPlainLogName(i.name));
    if (!logItem) return false;
    if (!(await craftItem(bot, logItem.name.replace("_log", "_planks"), 1, null, stopping))) return false;
    if (stopping()) return false;
  }
  return craftItem(bot, "stick", crafts, null, stopping);
}

// returns the cobblestone still owed to a tool that wasn't made
async function craftStoneTools(bot: Bot, ctx: StoneCtx): Promise<number> {
  const count = (name: string) => itemCount(bot, name);
  const plan = toolPlan(count);
  if (!plan.pickaxe && !plan.sword) return 0;

  await setStatus({ task: "crafting stone tools" });
  await walkTo(bot, new goals.GoalNear(home.craftingTable.x, home.craftingTable.y, home.craftingTable.z, 2));
  ctx.checkStop();
  const table = bot.blockAt(home.craftingTable);
  if (!table) throw new Error("crafting table isn't where I expected it");

  if (!(await ensureSticks(bot, plan.sticks, ctx.stopping))) {
    ctx.checkStop();
    log.info("no sticks and nothing to make them from, skipping the stone tools");
    return plan.cobble;
  }
  // owed comes from what the crafts returned: the inventory can still show the old state right after a craft
  let owed = 0;
  ctx.checkStop();
  if (plan.pickaxe && !(cobble(bot) >= 3 && (await craftItem(bot, "stone_pickaxe", 1, table, ctx.stopping)))) {
    log.warn("couldn't craft a stone pickaxe");
    owed += 3;
  }
  ctx.checkStop();
  if (plan.sword && !(cobble(bot) >= 2 && (await craftItem(bot, "stone_sword", 1, table, ctx.stopping)))) {
    log.warn("couldn't craft a stone sword");
    owed += 2;
  }
  ctx.checkStop();
  return owed;
}

async function stashCobble(bot: Bot, ctx: StoneCtx, reserved: number): Promise<void> {
  const extra = stashAmount(cobble(bot), reserved);
  if (extra <= 0) return;
  await setStatus({ task: "stashing stone" });
  const chestPos = home.stashChests[0];
  await walkTo(bot, new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
  ctx.checkStop();
  const block = bot.blockAt(chestPos);
  if (!block) throw new Error("stash chest isn't where I expected it");
  const chest = await bot.openChest(block);
  try {
    ctx.checkStop();
    // a full chest leaves the cobblestone in the inventory; the stone is mined either way
    await chest.deposit(bot.registry.itemsByName.cobblestone.id, null, extra).catch((err: Error) => {
      if (!ctx.stopping()) log.warn("couldn't stash the cobblestone", { message: err.message });
    });
  } finally {
    chest.close();
  }
}

// Throws the reason as the message: no_pickaxe, no_stone, protected, stuck; anything else is an error's own text.
export async function getStone(bot: Bot, ctx: StoneCtx): Promise<void> {
  if (!canMineStone((name) => itemCount(bot, name))) throw new Error("no_pickaxe");
  const start = cobble(bot);
  try {
    await mineCobble(bot, ctx, start);
  } finally {
    // digging was never switched on for the pathfinder; this puts the movements back to the default regardless
    bot.pathfinder.setMovements(safeMovements(bot));
  }
  await ctx.pause();
  const reserved = await craftStoneTools(bot, ctx);
  await ctx.pause();
  await stashCobble(bot, ctx, reserved);
}
