// The hands that set things down: `place` (a table, furnace, chest, torch, bed or scaffolding block), `pick_up` (take
// back only what the journal says it set down) and `make_base` (move home to what it placed). Every change goes
// through the gate and the journal like a dig does; place.ts is the death-place words, so this one is put.
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { setBase, type BaseRecord } from "../lib/base";
import { dig, pickUp } from "../lib/collect";
import { GateRefusal, nameAtOf, taskErrorOf, worldOf } from "../lib/gate";
import { itemCount } from "../lib/inventory";
import { journal } from "../lib/journal";
import { logger } from "../lib/logger";
import { placeBlock } from "../lib/place-block";
import { check, handsPlaceable, madeNear, type Op } from "../lib/policy";
import { setStatus } from "../lib/status";
import { isOverworld } from "../senses/observe";
import { TaskError } from "./fail";
import { missingTool } from "./harvest";
import type { MineCtx } from "./mine";
import { cardinalOfYaw, planPut, putWords, PUT_REACH, type Spot, type Where } from "./put-plan";
import { noteRefused, reverted } from "./refused";
import { walkWithin } from "./walk";

const log = logger("put");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cellOf = (v: Vec3): Vec3 => new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z));
const vecOf = (p: { x: number; y: number; z: number }): Vec3 => new Vec3(p.x, p.y, p.z);

export type WhereWord = { word: "here" | "ahead" | "wall" } | { word: "on"; target: Vec3 };

function viewOf(bot: Bot) {
  const entities = Object.values(bot.entities).filter((e) => e !== bot.entity && ["player", "mob", "hostile", "animal", "passive"].includes(e.type ?? ""));
  return {
    eye: bot.entity.position.offset(0, 1.62, 0),
    feet: cellOf(bot.entity.position),
    facing: cardinalOfYaw(bot.entity.yaw),
    nameAt: nameAtOf(bot),
    solid: (p: { x: number; y: number; z: number }) => bot.blockAt(vecOf(p))?.boundingBox === "block",
    occupied: (p: { x: number; y: number; z: number }) => entities.some((e) => Math.floor(e.position.x) === p.x && Math.floor(e.position.y) === p.y && Math.floor(e.position.z) === p.z),
  };
}

// the gate's word on setting `item` in `cell`, as words, or null when it is fine
function vetter(bot: Bot, item: string, job: string) {
  return (cell: { x: number; y: number; z: number }, against: { x: number; y: number; z: number }): string | null => {
    const op: Op = { kind: "place", pos: cell, against, block: item, job };
    const v = check(op, worldOf(bot, op), { strict: true });
    return v.ok ? null : v.detail;
  };
}

// words for a plan that found nothing, as the error the task ends with
const failOf = (reason: string, detail: string): TaskError => new TaskError(reason === "refused" ? "refused" : reason === "too_far" ? "no_room" : reason, detail);

// Throws its reason as the message: not_allowed, none_held, no_room, refused, protected, stale_handle, stuck.
export async function put(bot: Bot, ctx: MineCtx, item: string, where: WhereWord): Promise<{ detail: string; at: Vec3 }> {
  if (!handsPlaceable(item)) throw new TaskError("not_allowed", "it does not set that block down");
  const held = bot.inventory.items().find((i) => i.name === item);
  if (!held) throw new TaskError("none_held", "it holds none of that");
  if (!isOverworld(bot)) throw new TaskError("no_room", "it only builds in the overworld");

  const job = `place@${Date.now()}`;
  const aimed = (): Where => {
    if (where.word !== "on") return { kind: where.word };
    const target = bot.blockAt(where.target);
    if (!target || target.boundingBox !== "block") throw new TaskError("stale_handle", "that block is gone or not solid");
    return { kind: "on", target: { x: where.target.x, y: where.target.y, z: where.target.z } };
  };

  await setStatus({ task: `placing ${item.replace(/_/g, " ")}` });
  let plan = planPut(item, aimed(), viewOf(bot), vetter(bot, item, job));
  if (!plan.ok && plan.reason === "too_far" && where.word === "on") {
    // a block it was pointed at from a way off: get beside it first
    await walkWithin(bot, new goals.GoalNear(where.target.x, where.target.y, where.target.z, 3));
    ctx.checkStop();
    plan = planPut(item, aimed(), viewOf(bot), vetter(bot, item, job));
  }
  if (!plan.ok) throw failOf(plan.reason, plan.detail);
  ctx.checkStop();

  await setDown(bot, item, plan.spot, job);
  return { detail: putWords(item, plan.where), at: vecOf(plan.spot.cell) };
}

// equips, sets the block down through the one place door, and tells a server that undid it from one that took it
export async function setDown(bot: Bot, item: string, spot: Spot, job: string): Promise<void> {
  const held = bot.inventory.items().find((i) => i.name === item);
  if (!held) throw new TaskError("none_held", "it holds none of that");
  await bot.equip(held, "hand");
  const ref = bot.blockAt(vecOf(spot.ref));
  if (!ref) throw new TaskError("no_room", "it cannot see what to set it on");
  const cell = vecOf(spot.cell);
  try {
    await placeBlock(bot, ref, vecOf(spot.face), item, job, { swingArm: "right" }, { strict: true });
  } catch (err) {
    if (err instanceof GateRefusal) throw taskErrorOf(err.verdict);
    log.warn("place failed", { item, message: (err as Error).message });
    if (undone(bot, cell)) throw reverted_(cell);
    throw new TaskError("stuck", "the server would not take it");
  }
  // WorldGuard puts the old block back a moment after the packet: a place that does not stay is a refusal like a dig's
  await sleep(500);
  if (undone(bot, cell)) throw reverted_(cell);
}

const undone = (bot: Bot, cell: Vec3): boolean => {
  const n = bot.blockAt(cell)?.name;
  return n === undefined || /^(air|cave_air|void_air)$/.test(n);
};

function reverted_(cell: Vec3): TaskError {
  noteRefused(cell.x, cell.z);
  return new TaskError("protected", "the server undid it, so it may not build near there");
}

const dropName = (block: string): string => (block === "wall_torch" ? "torch" : block);

// Throws its reason as the message: stale_handle, not_yours, not_empty, no_tool, refused, protected, stuck. The block has to be
// one the journal says it set down and that is still what it set down.
export async function pickUpBlock(bot: Bot, ctx: MineCtx, at: Vec3): Promise<{ detail: string }> {
  const block = bot.blockAt(at);
  if (!block) throw new TaskError("stale_handle", "that block is gone");
  if (!journal.ownAt(at, block.name)) throw new TaskError("not_yours", "it only picks up what it set down itself");
  const need = missingTool(bot, block.name);
  if (need) throw new TaskError("no_tool", `it needs ${need} to take that up`);

  await setStatus({ task: `picking up the ${block.name.replace(/_/g, " ")}` });
  await walkWithin(bot, new goals.GoalNear(at.x, at.y, at.z, 3));
  ctx.checkStop();
  await mustBeEmpty(bot, block);
  ctx.checkStop();

  const live = bot.blockAt(at);
  if (!live || live.name !== block.name) throw new TaskError("stale_handle", "that block is gone");
  try {
    await bot.tool.equipForBlock(live, { requireHarvest: true });
  } catch {
    // dig with what is in hand
  }
  const before = itemCount(bot, dropName(block.name));
  const verdict = await dig(bot, live, ctx.stopping, "pick_up", { physical: false });
  if (!verdict.ok) throw taskErrorOf(verdict);
  if (bot.blockAt(at)?.name === block.name) throw new TaskError("protected", "the server put it back");
  const drop = dropName(block.name);
  await pickUp(bot, at.offset(0.5, 0.5, 0.5), ctx.stopping, (n) => n === drop);
  if (itemCount(bot, drop) <= before) throw new TaskError("stuck", "it took the block up but could not collect it");
  return { detail: `took up the ${block.name.replace(/_/g, " ")}` };
}

// a chest or furnace with things in it spills them when it is broken
async function mustBeEmpty(bot: Bot, block: Block): Promise<void> {
  const chest = block.name.endsWith("chest");
  if (!chest && block.name !== "furnace") return;
  const open = chest ? await bot.openChest(block) : await bot.openFurnace(block);
  try {
    const items = open.containerItems();
    if (items.length > 0) throw new TaskError("not_empty", `it still holds things; take them out first`);
  } finally {
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  }
}

// ---- the base ----

export const BASE_REACH = 8; // blocks: the bed, table and a chest all have to be this near the body

const live = (bot: Bot, p: { x: number; y: number; z: number }): string | null => {
  const n = bot.blockAt(vecOf(p))?.name;
  return n && journal.ownAt(p, n) ? n : null;
};

function ownNear(bot: Bot, match: (name: string) => boolean): Vec3[] {
  const me = bot.entity.position;
  return journal
    .ownCells(match)
    .map(vecOf)
    .filter((p) => live(bot, p) !== null && p.offset(0.5, 0.5, 0.5).distanceTo(me) <= BASE_REACH)
    .sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
}

// the body's own bed: the foot and the head cell it faces
function bedPair(bot: Bot): [Vec3, Vec3] | null {
  const FACING: Record<string, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
  for (const foot of ownNear(bot, (n) => n.endsWith("_bed"))) {
    const b = bot.blockAt(foot);
    if (!b || b.getProperties().part !== "foot") continue;
    const to = FACING[String(b.getProperties().facing)];
    const head = to && foot.plus(to);
    if (head && live(bot, head)) return [foot, head];
  }
  return null;
}

// Makes where it stands the base: refused unless its own bed, table and a chest are within a few blocks, it stands outside every
// place its digs were undone and clear of what players built. Replaces the home for every task from now on.
export async function makeBase(bot: Bot, ctx: MineCtx): Promise<{ detail: string }> {
  if (!isOverworld(bot)) throw new TaskError("refused", "a base goes in the overworld");
  await setStatus({ task: "making a base" });
  const feet = cellOf(bot.entity.position);
  const bed = bedPair(bot);
  const table = ownNear(bot, (n) => n === "crafting_table")[0];
  const chests = ownNear(bot, (n) => n === "chest");
  const missing = [!bed && "a bed", !table && "a crafting table", chests.length === 0 && "a chest"].filter(Boolean);
  if (missing.length > 0) throw new TaskError("not_ready", `it needs its own ${missing.join(" and ")} set down within a few blocks of here`);
  if (reverted.covers(feet)) throw new TaskError("protected", "this is a place where its digs were undone");
  const op: Op = { kind: "dig", pos: feet, job: "make_base" };
  const world = worldOf(bot, op);
  if (madeNear(feet, world, (p) => world.isOwn?.(p, world.nameAt(p) ?? "") ?? false)) throw new TaskError("refused", "something a player built is too close to make a base here");
  ctx.checkStop();

  const furnaces = ownNear(bot, (n) => n === "furnace").slice(0, 2);
  const record: BaseRecord = { bed: [bed![0], bed![1]], craftingTable: table, furnaces, stashChests: chests.slice(0, 3) };
  setBase(record);
  log.info("base made", { chests: record.stashChests.length, furnaces: furnaces.length });
  return { detail: "this is its base now" };
}
