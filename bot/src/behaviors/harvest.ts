// `collect`: dig the block a handle points at, or the logs of the tree it points at, with a hand's
// guards: natural blocks only, the right tool in the inventory, look-before-you-dig, nothing in a place
// where the server undid its digs. The digging itself is mine.ts's (stone, ores) and lib/collect.ts's (logs).
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { collectLog } from "../lib/collect";
import { itemCount } from "../lib/inventory";
import { logger } from "../lib/logger";
import { gatherMovements, isNaturalLog, safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { madeBlocksNear, safeToDig, type Pos } from "./dig-safety";
import { TaskError } from "./fail";
import { collectKind, MAX_COLLECT, sameKindRun, shortWords, toolWords, trunkLogs } from "./harvest-plan";
import { numberWords } from "./dig-down-plan";
import { findStand, mineBlock, nameAtOf, reachable, type MineCtx, type MineSpec } from "./mine";
import { NoDigMap, noteMade } from "./no-dig";
import { noteRefused, refusedNow, reverted, undoneWords } from "./refused";
import { boundedAttempt } from "./walk";

const log = logger("harvest");

const LOG_ATTEMPT_MS = 40_000;
const BLOCK_ATTEMPT_MS = 45_000;
const STUCK_CAP = 3; // attempts in a row that gained nothing

export interface BlockTarget {
  pos: Vec3;
  name: string;
}

const key = (p: Pos) => `${p.x},${p.y},${p.z}`;
const label = (name: string) => name.replace(/_/g, " ");

// the item names a block drops, which is all a dig of it may pick up
function dropsOf(bot: Bot, name: string): string[] {
  const def = bot.registry.blocksByName[name];
  const ids = (def?.drops ?? []).map((d) => (typeof d === "number" ? d : typeof d.drop === "number" ? d.drop : d.drop.id));
  const names = ids.map((id) => bot.registry.items[id]?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names : [name];
}

// null when some tool it carries can take the block, else what it would need
export function missingTool(bot: Bot, name: string): string | null {
  const block = bot.registry.blocksByName[name];
  const harvest = block?.harvestTools as Record<string, boolean> | undefined;
  if (!harvest) return null; // by hand
  const carried = new Set(bot.inventory.items().map((i) => i.type));
  if (Object.keys(harvest).some((id) => carried.has(Number(id)))) return null;
  return toolWords(Object.keys(harvest).map((id) => bot.registry.items[Number(id)]?.name ?? ""));
}

// Throws its reason as the message: stale_handle, refused, no_tool, protected, stuck. A run that ends short of `count`
// says why in `detail`.
export async function collect(bot: Bot, ctx: MineCtx, target: BlockTarget, count = 1): Promise<{ detail?: string } | void> {
  const live = bot.blockAt(target.pos);
  if (!live || live.name !== target.name) throw new TaskError("stale_handle");
  const kind = collectKind(live.name);
  if (!kind) throw new TaskError("refused", "that is not a natural block, so it stays");
  if (reverted.covers(target.pos)) throw new TaskError("refused", "that spot is where its digs were undone");
  if (kind === "log") return collectTree(bot, ctx, target);

  const need = missingTool(bot, live.name);
  if (need) throw new TaskError("no_tool", `it needs ${need}`);
  return collectBlocks(bot, ctx, target, Math.min(Math.max(1, count), MAX_COLLECT));
}

async function collectBlocks(bot: Bot, ctx: MineCtx, target: BlockTarget, count: number): Promise<{ detail?: string } | void> {
  const nameAt = nameAtOf(bot);
  if (!safeToDig(target.pos, nameAt)) {
    throw new TaskError("refused", madeBlocksNear(target.pos, nameAt).length > 0 ? "something a player built is too close to it" : "it is not safe to dig: liquid or falling blocks next to it");
  }
  const drops = dropsOf(bot, target.name);
  const spec: MineSpec = {
    names: [target.name],
    drop: drops[0],
    drops,
    target: count,
    range: 12,
    minY: -64,
    looking: `looking at the ${label(target.name)}`,
    mining: `digging the ${label(target.name)}`,
    what: label(target.name),
  };
  const run = sameKindRun(target.pos, nameAt, count).map((p) => new Vec3(p.x, p.y, p.z));
  const builds = new NoDigMap();
  const skipped = new Set<string>();
  bot.pathfinder.setMovements(safeMovements(bot));
  let dug = 0;
  let stuck = 0;
  let nearBuild = 0; // passed over because of a build
  let undone = 0; // passed over where the server undid a dig

  while (dug < count) {
    await ctx.pause();
    const me = bot.entity.position;
    const todo = run.filter((p) => !skipped.has(key(p)) && bot.blockAt(p)?.name === target.name).sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
    const pos = todo[0];
    if (!pos) break;
    if (reverted.covers(pos)) {
      skipped.add(key(pos));
      undone++;
      continue;
    }
    if (builds.covers(pos)) {
      skipped.add(key(pos));
      nearBuild++;
      continue;
    }
    if (!safeToDig(pos, nameAt)) {
      noteMade(builds, madeBlocksNear(pos, nameAt));
      skipped.add(key(pos));
      nearBuild++;
      continue;
    }
    const stand = findStand(bot, pos);
    const pick = stand && { pos, stand };
    if (!pick || !reachable(bot, pick)) {
      skipped.add(key(pos));
      continue;
    }

    await setStatus({ task: count > 1 ? `digging ${numberWords(dug + 1)} of ${numberWords(Math.min(count, run.length))}` : spec.mining });
    let dugIt = false;
    const mark = (b: { position: { equals(o: unknown): boolean } }) => {
      if (b.position.equals(pos)) dugIt = true; // undone only if the block is back afterwards
    };
    bot.on("diggingCompleted", mark);
    bot.on("diggingAborted", mark);
    await boundedAttempt(bot, BLOCK_ATTEMPT_MS, () => mineBlock(bot, ctx, spec, pick), (e) => log.warn("dig attempt failed", { message: e.message }));
    bot.removeListener("diggingCompleted", mark);
    bot.removeListener("diggingAborted", mark);
    ctx.checkStop();

    if (bot.blockAt(pos)?.name !== target.name) {
      dug++;
      stuck = 0;
      continue;
    }
    skipped.add(key(pos));
    if (dugIt) {
      noteRefused(pos.x, pos.z);
      if (dug === 0) throw new TaskError("protected", undoneWords(1, label(target.name), bot.entity.position, refusedNow()));
      undone++;
      break;
    }
    if (++stuck >= STUCK_CAP) break;
  }

  log.info("collected", { name: target.name, dug, asked: count });
  if (dug > 0) return dug < count ? { detail: shortWords({ builds: nearBuild, undone }) } : undefined;
  if (nearBuild > 0) throw new TaskError("refused", "something a player built is too close to it");
  throw new TaskError("stuck", `no way to dig the ${label(target.name)}`);
}

// one tree: the logs of its trunk from the base up, those within reach
async function collectTree(bot: Bot, ctx: MineCtx, target: BlockTarget): Promise<void> {
  const nameAt = nameAtOf(bot);
  const movements = gatherMovements(bot);
  bot.pathfinder.setMovements(movements);
  const logs = trunkLogs(target.pos, nameAt).map((p) => new Vec3(p.x, p.y, p.z));
  const skipped = new Set<string>();
  const start = itemCount(bot, target.name);
  let stuck = 0;
  let cut = 0;
  let nearBuild = 0;
  try {
    for (;;) {
      await ctx.pause();
      const me = bot.entity.position;
      const next = logs.filter((p) => !skipped.has(key(p)) && /_log$/.test(nameAt(p) ?? "")).sort((a, b) => a.y - b.y || a.distanceTo(me) - b.distanceTo(me))[0];
      if (!next) break;
      const block = bot.blockAt(next);
      if (!block || !isNaturalLog(bot, block)) {
        skipped.add(key(next));
        continue;
      }
      if (reverted.covers(next)) {
        if (cut === 0) throw new TaskError("refused", "that tree is where its digs were undone");
        break;
      }
      if (!movements.safeToBreak(block as never)) {
        skipped.add(key(next)); // a build beside it: the tree stays
        nearBuild++;
        continue;
      }

      await setStatus({ task: "cutting the tree" });
      let dugIt = false;
      const mark = (b: { position: { equals(o: unknown): boolean } }) => {
        if (b.position.equals(next)) dugIt = true;
      };
      bot.on("diggingCompleted", mark);
      bot.on("diggingAborted", mark);
      await boundedAttempt(bot, LOG_ATTEMPT_MS, () => collectLog(bot, block, movements, ctx.stopping), (e) => log.warn("collect failed", { message: e.message }));
      bot.removeListener("diggingCompleted", mark);
      bot.removeListener("diggingAborted", mark);
      ctx.checkStop();

      if (bot.blockAt(next)?.name !== block.name) {
        cut++;
        stuck = 0;
        continue;
      }
      skipped.add(key(next));
      if (dugIt) {
        noteRefused(next.x, next.z);
        if (cut === 0) throw new TaskError("protected", undoneWords(1, "tree", bot.entity.position, refusedNow()));
        break;
      }
      if (++stuck >= STUCK_CAP) break;
    }
  } finally {
    bot.pathfinder.setMovements(safeMovements(bot));
  }
  log.info("tree done", { cut, logs: logs.length, gained: itemCount(bot, target.name) - start });
  if (cut === 0 && nearBuild > 0) throw new TaskError("refused", "something a player built is too close to it");
  if (cut === 0) throw new TaskError(logs.length === 0 ? "stale_handle" : "stuck", logs.length === 0 ? undefined : "none of that tree's logs were within reach");
}
