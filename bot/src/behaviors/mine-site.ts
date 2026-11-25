// The mine site's three jobs: `dig_shaft` (the stair down, dug once and kept), walking it (`go_to` the mine or the
// shaft's top), and `make_mine` (the landing kit at its foot). The shaft itself is `digDown`, told to keep the site as
// it goes; the record is lib/sites.ts. The base (lib/base.ts) is never touched by any of this.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { pickUp } from "../lib/collect";
import { nameAtOf } from "../lib/gate";
import { itemCount } from "../lib/inventory";
import { journal } from "../lib/journal";
import { logger } from "../lib/logger";
import { safeMovements } from "../lib/movement";
import { planPut } from "./put-plan";
import { getMine, setMine, type Kit, type MineSite } from "../lib/sites";
import { setStatus } from "../lib/status";
import { breakBlock, cellOf, digDown } from "./dig-down";
import type { Facing } from "./dig-down-plan";
import { safeToDig, type Pos } from "./dig-safety";
import { TaskError } from "./fail";
import { missingTool } from "./harvest";
import type { MineCtx } from "./mine";
import { setDown, viewOf, vetter } from "./put";
import { noteStashed } from "./run-report";
import { seedStair, stairSteps } from "./stair";
import { noteLook } from "./stash";
import { walkWithin } from "./walk";

const log = logger("mine");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LEG = 8; // shaft cells in one walk: a path of a hundred steps is never planned at once
const LEG_MS = 30_000;
const NEAR_CELL = 3; // blocks from a shaft cell that count as standing in the shaft
const same = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const plain = (p: Pos): Pos => ({ x: p.x, y: p.y, z: p.z });
const dist = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const up = (p: Pos): Pos => ({ x: p.x, y: p.y + 1, z: p.z });
const down = (p: Pos): Pos => ({ x: p.x, y: p.y - 1, z: p.z });

// the shaft put back in memory (a restart forgets the stair, and `dig_down` goes on from the foot of the stair it knows)
export function seedSite(): void {
  const m = getMine();
  if (m?.facing && m.shaft.length > 0) seedStair(m.shaft, m.facing as Facing);
}

// a stair in memory that is the shaft's, grown by a plain `dig_down` from its foot, is the shaft now
function adoptStair(m: MineSite): MineSite {
  const steps = stairSteps();
  if (!steps || steps.length <= m.shaft.length || !same(steps[0], m.top)) return m;
  const grown = { ...m, shaft: steps.map(plain) };
  setMine(grown);
  return grown;
}

const noMine = (): TaskError => new TaskError("no_mine", "it has not dug a mine");

// Walks the shaft's cells to its top or its foot, from the nearest cell, a few at a time. `stopped` is how a walk that is
// not a task hears a stop between legs. Throws `no_mine`, `stuck`, `cancelled`.
export async function walkShaft(bot: Bot, end: "top" | "foot", stopped: () => boolean): Promise<void> {
  const m = getMine();
  if (!m || m.shaft.length === 0) throw noMine();
  const cells = m.shaft;
  const goal = end === "top" ? 0 : cells.length - 1;
  const me = cellOf(bot);
  let k = 0;
  for (let i = 1; i < cells.length; i++) if (dist(cells[i], me) < dist(cells[k], me)) k = i;
  const check = () => {
    if (stopped()) throw new Error("cancelled");
  };

  await setStatus({ task: end === "top" ? "going up the shaft" : "going down the shaft" });
  bot.pathfinder.setMovements(safeMovements(bot));
  if (dist(cells[k], me) > NEAR_CELL) {
    await walkWithin(bot, new goals.GoalBlock(cells[k].x, cells[k].y, cells[k].z));
    check();
  }
  for (let i = k; i !== goal; ) {
    i = goal > i ? Math.min(i + LEG, goal) : Math.max(i - LEG, goal);
    await walkWithin(bot, new goals.GoalBlock(cells[i].x, cells[i].y, cells[i].z), LEG_MS);
    check();
  }
  if (dist(cellOf(bot), cells[goal]) > NEAR_CELL) throw new TaskError("stuck", "it could not get along the shaft");
  // a walk that ends on a drop is still landing: the next dig wants firm ground
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(100);
}

// `go_to` the mine (the landing) or the shaft's top: a way that is not a path to plan
export async function goToSite(bot: Bot, place: "mine" | "shaft", stopped: () => boolean): Promise<void> {
  const m = getMine();
  if (!m) throw noMine();
  if (place === "mine" && !m.landing) throw new TaskError("not_ready", "the shaft has no landing yet");
  try {
    await walkShaft(bot, place === "mine" ? "foot" : "top", stopped);
  } catch (err) {
    // a reflex or a stop owns the status after any other failure
    if ((err as Error).message === "stuck") await setStatus({ task: "idle" });
    throw err;
  }
  await setStatus({ task: "idle" });
}

// Digs the permanent way down to the step at `to`, or goes on from where a half-dug shaft ended. Throws what `digDown`
// throws, plus `no_mine` and `refused`.
export async function digShaft(bot: Bot, ctx: MineCtx, opts: { to: number; torches?: boolean }): Promise<{ detail: string }> {
  let m = getMine();
  if (m?.landing) throw new TaskError("refused", "the shaft already has its landing; it does not dig it on");
  if (m && m.facing && m.shaft.length > 0) {
    seedSite();
    m = adoptStair(m);
    // a shaft goes on from its foot, wherever the body is now
    await walkShaft(bot, "foot", ctx.stopping);
    ctx.checkStop();
    const foot = m.shaft[m.shaft.length - 1];
    if (!same(cellOf(bot), foot)) throw new TaskError("stuck", "it could not get to the foot of the shaft");
  }
  const track = {
    begin: (top: Pos, facing: Facing) => setMine({ top: plain(top), facing: { dx: facing.dx, dz: facing.dz }, shaft: [plain(top)], landing: null, kit: {} }),
    step: (p: Pos) => {
      const now = getMine();
      if (now) setMine({ ...now, shaft: [...now.shaft, plain(p)] });
    },
  };
  return digDown(bot, ctx, { to: opts.to, torches: opts.torches, job: `dig_shaft@${Date.now()}`, track });
}

// ---- the landing kit ----

type Piece = { item: "chest" | "crafting_table" | "furnace"; key: keyof Kit; cell: Pos; ref: Pos };

const WORDS: Record<string, string> = { chest: "a chest", crafting_table: "a crafting table", furnace: "a furnace", torch: "torches" };
const listWords = (items: string[]): string => items.map((i) => WORDS[i]).join(items.length > 2 ? ", " : " and ");

// where the kit goes round the foot: the chest to one side, the table to the other and the furnace on top of the table.
// Never the cell ahead, which is where a tunnel off the foot starts, and never a cell of the way up.
function piecesAt(foot: Pos, facing: Facing): Piece[] {
  const side = { x: facing.dz, z: facing.dx };
  const chest = { x: foot.x + side.x, y: foot.y, z: foot.z + side.z };
  const table = { x: foot.x - side.x, y: foot.y, z: foot.z - side.z };
  return [
    { item: "chest", key: "chest", cell: chest, ref: down(chest) },
    { item: "crafting_table", key: "table", cell: table, ref: down(table) },
    { item: "furnace", key: "furnace", cell: up(table), ref: table },
  ];
}

const FREE = /^(air|cave_air|void_air)$/;

// opens the cell for a piece when rock is in it: only where a dig is safe and the floor under it is solid
async function clearCell(bot: Bot, ctx: MineCtx, cell: Pos, job: string): Promise<boolean> {
  const name = nameAtOf(bot)(cell);
  if (name === null) return false;
  if (FREE.test(name)) return true;
  const g = nameAtOf(bot);
  if (!bot.blockAt(new Vec3(cell.x, cell.y, cell.z))?.diggable || !safeToDig(cell, g)) return false;
  const need = missingTool(bot, name);
  if (need) throw new TaskError("no_tool", `it needs ${need} to cut room for the landing`);
  await breakBlock(bot, ctx, cell, true, job);
  await pickUp(bot, new Vec3(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5), ctx.stopping, () => true);
  return FREE.test(g(cell) ?? "");
}

const torchNear = (bot: Bot, foot: Pos): boolean => {
  const at = nameAtOf(bot);
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) if (/torch$/.test(at({ x: foot.x + dx, y: foot.y + dy, z: foot.z + dz }) ?? "")) return true;
  return false;
};

// the torches it carries beyond a few go into the landing chest, where `take` finds them again
async function stock(bot: Bot, chestAt: Pos): Promise<boolean> {
  const spare = Math.floor(itemCount(bot, "torch") / 2);
  if (spare < 1) return false;
  const block = bot.blockAt(new Vec3(chestAt.x, chestAt.y, chestAt.z));
  if (!block || !block.name.endsWith("chest")) return false;
  let open;
  try {
    open = await bot.openChest(block);
  } catch {
    return false;
  }
  try {
    await open.deposit(bot.registry.itemsByName.torch.id, null, spare);
    noteStashed("torch", spare);
    return true;
  } catch {
    return false;
  } finally {
    noteLook(new Vec3(chestAt.x, chestAt.y, chestAt.z), open);
    open.close();
  }
}

// Sets the landing at the foot of the shaft: a chest, a crafting table, a furnace and a torch from what it carries, in
// cells it cuts beside the foot. What it cannot place is said in words; what is down stays down, so asking again after
// getting the rest finishes the kit. Throws `no_mine`, `not_ready`, `no_tool`, `protected`, `refused`, `stuck`.
export async function makeMine(bot: Bot, ctx: MineCtx): Promise<{ detail: string }> {
  const m = getMine();
  if (!m || m.shaft.length < 2 || !m.facing) throw new TaskError("no_mine", "there is no shaft to put a landing at the foot of");
  const foot = m.shaft[m.shaft.length - 1];
  await walkShaft(bot, "foot", ctx.stopping);
  ctx.checkStop();
  if (!same(cellOf(bot), foot)) throw new TaskError("stuck", "it could not get to the foot of the shaft");

  const job = `make_mine@${Date.now()}`;
  await setStatus({ task: "setting up the landing" });
  const kit: Kit = { ...m.kit };
  const lacks: string[] = [];
  const noRoom: string[] = [];
  let newChest = false;
  const at = nameAtOf(bot);
  for (const piece of piecesAt(foot, m.facing as Facing)) {
    ctx.checkStop();
    if (journal.ownAt(piece.cell, at(piece.cell) ?? "")) {
      kit[piece.key] = plain(piece.cell);
      continue;
    }
    if (itemCount(bot, piece.item) === 0) {
      lacks.push(piece.item);
      continue;
    }
    // the floor has to be there before the cell is cut, and the furnace sits on the table
    const floor = at(piece.ref);
    if (piece.item !== "furnace" ? !floor || FREE.test(floor) : kit.table === undefined) {
      noRoom.push(piece.item);
      continue;
    }
    // a chest does not open under rock: the cell above it is cut too
    if (!(await clearCell(bot, ctx, piece.cell, job)) || (piece.item === "chest" && !(await clearCell(bot, ctx, up(piece.cell), job)))) {
      noRoom.push(piece.item);
      continue;
    }
    await setDown(bot, piece.item, { cell: piece.cell, ref: piece.ref, face: { x: 0, y: 1, z: 0 } }, job);
    kit[piece.key] = plain(piece.cell);
    if (piece.item === "chest") newChest = true;
  }

  let torch = torchNear(bot, foot);
  if (!torch) {
    if (itemCount(bot, "torch") === 0) lacks.push("torch");
    else {
      const plan = planPut("torch", { kind: "wall" }, viewOf(bot), vetter(bot, "torch", job));
      if (plan.ok) {
        await setDown(bot, "torch", plan.spot, job);
        torch = true;
      }
    }
  }
  // stocked once, when the chest is new: asking again for the rest of the kit does not empty the pack into it
  const stocked = newChest && kit.chest ? await stock(bot, kit.chest) : false;

  setMine({ ...m, landing: plain(foot), kit });
  const done = [kit.chest && "chest", kit.table && "table", kit.furnace && "furnace", torch && "torch"].filter(Boolean).join(", ");
  if (lacks.length > 0 || noRoom.length > 0) {
    const missing = Object.fromEntries(lacks.map((i) => [i, 1]));
    const why = [lacks.length > 0 && `it lacks ${listWords(lacks)}`, noRoom.length > 0 && `no room to set down ${listWords(noRoom)}`].filter(Boolean).join(", ");
    throw new TaskError("not_ready", `${why}${done ? `; down so far: ${done}` : ""}`, missing);
  }
  return { detail: `the landing is ready: ${done}${stocked ? ", torches in the chest" : ""}` };
}
