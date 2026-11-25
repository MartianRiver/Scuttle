// `tunnel`: a branch mine, as a player digs one. A one-wide, two-high passage at foot level, a column at a time, the
// body walking into it as it goes, looking at the walls as they open. The planning is tunnel-plan.ts; this walks it:
// every block checked by dig-safety just before it is dug, every wait bounded.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { pickUp } from "../lib/collect";
import { safeMovements } from "../lib/movement";
import { setStatus } from "../lib/status";
import { madeBlocksNear, type Pos } from "./dig-safety";
import { facingsFrom, type Facing } from "./dig-down-plan";
import { breakBlock, canBreak, cellOf, grid, same } from "./dig-down";
import { TaskError } from "./fail";
import { missingTool } from "./harvest";
import { lightAtHead, torchIfDue } from "./torches";
import { TorchPacer, withTorchNote } from "./torch-plan";
import { noRoomFor } from "./upkeep";
import type { MineCtx } from "./mine";
import { reverted } from "./refused";
import { addTunnelCell, beginStair, inWay, noteOre, oreKnown, wayFacing } from "./stair";
import { inWater } from "./swim";
import { facingOf, planTunnelStep, sawWords, stopWords, tunnelLength, tunnelStatus, wallOres, type Cardinal } from "./tunnel-plan";
import { walkWithin } from "./walk";

const STEP_WALK_MS = 20_000;
const RUN_MS = 8 * 60_000;

export interface TunnelOpts {
  dir?: Cardinal;
  length?: number | string;
  through?: boolean;
  torches?: boolean;
}

const key = (p: Pos) => `${p.x},${p.y},${p.z}`;
const over = (p: Pos): Pos => ({ x: p.x, y: p.y + 1, z: p.z });

// Throws `refused`, `blocked`, `no_tool`, `protected` or `stuck`; returns why it stopped, and what it saw when it went through.
export async function tunnel(bot: Bot, ctx: MineCtx, opts: TunnelOpts): Promise<{ detail: string; saw?: string }> {
  const g = grid(bot);
  const rules = { canBreak: canBreak(bot), missingTool: (name: string) => missingTool(bot, name) };
  if (inWater(bot) || !bot.entity.onGround) throw new TaskError("stuck", "it is not standing on firm ground");

  let cur = cellOf(bot);
  if (reverted.covers(cur)) throw new TaskError("refused", "that spot is where its digs were undone");
  if (madeBlocksNear(cur, g.name).length > 0) throw new TaskError("refused", "something a player built is too close to start here");

  // on the way it dug it goes on the way it was going; from anywhere else it starts a way of its own
  const goingOn = inWay(cur);
  const facing: Facing = opts.dir ? facingOf(opts.dir) : goingOn ? (wayFacing() as Facing) : facingsFrom(bot.entity.yaw)[0];
  const length = tunnelLength(opts.length);
  // what is already in the wall where it stands has been seen: it only stops for ore that is new
  const start = wallOres(g, [cur, over(cur)]);

  bot.pathfinder.setMovements(safeMovements(bot));
  const deadline = Date.now() + RUN_MS;
  const seen: string[] = [];
  const pacer = opts.torches ? new TorchPacer(lightAtHead(bot)) : null;
  const job = `tunnel@${Date.now()}`;
  let stopped: string | null = null;
  let dug = 0;
  try {
    while (dug < length && !stopped) {
      await ctx.pause();
      if (Date.now() > deadline) throw new TaskError("stuck", "ran out of time on the way");
      if (reverted.covers({ x: cur.x + facing.dx, y: cur.y, z: cur.z + facing.dz })) throw new TaskError("refused", "that spot is where its digs were undone");
      const plan = planTunnelStep(g, cur, facing, rules);
      if (plan.kind !== "step") throw new TaskError(plan.kind, plan.detail);
      if (dug === 0) {
        if (!goingOn) beginStair(cur, facing);
        for (const o of start) noteOre(key(o.pos));
      }

      await torchIfDue(bot, ctx, pacer, job);
      // drops with nowhere to go are left where they fall: it stops here and the mind empties the pack
      if (noRoomFor(bot, plan.dig.filter((p) => g.solid(p)).map((p) => g.name(p) as string))) {
        stopped = "pack full";
        break;
      }
      await setStatus({ task: tunnelStatus(dug) });
      for (const p of plan.dig) await breakBlock(bot, ctx, p, true, job);
      await walkWithin(bot, new goals.GoalBlock(plan.to.x, plan.to.y, plan.to.z), STEP_WALK_MS);
      ctx.checkStop();
      if (!same(cellOf(bot), plan.to)) throw new TaskError("stuck", "it could not walk on into the tunnel");
      addTunnelCell(plan.to, facing);
      cur = plan.to;
      dug++;
      pacer?.step();

      const found = wallOres(g, [cur, over(cur)]).filter((o) => !oreKnown(key(o.pos)));
      for (const o of found) noteOre(key(o.pos));
      if (found.length === 0) continue;
      if (opts.through) seen.push(...found.map((o) => o.name));
      else stopped = stopWords(found.map((o) => o.name));
    }
  } finally {
    // what fell from the last blocks is picked up whichever way it ends
    if (!ctx.stopping()) await pickUp(bot, new Vec3(cur.x + 0.5, cur.y + 0.5, cur.z + 0.5), ctx.stopping, () => true);
  }
  return { detail: withTorchNote(stopped ?? "ran out of length", pacer), ...(seen.length > 0 && { saw: sawWords(seen) }) };
}
