// The one place door: nothing sets a block down without the gate saying yes first. The check and the call are
// one synchronous step, since fillPit times its placing to a single physics tick.
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { done, GateRefusal, placeBudget, worldOf } from "./gate";
import { check, type CheckOpts, type Op } from "./policy";

type PlaceOptions = { swingArm?: "right" | "left"; forceLook?: boolean | "ignore" };
type Placer = { _placeBlockWithOptions(ref: Block, face: Vec3, o: PlaceOptions): Promise<void> };

const FACING: Record<string, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// sets `item` against the `face` of `ref`; throws GateRefusal when the policy says no, the server's error when
// the placing itself fails. `checks.strict` is for the hands (the made radius and zones count). What went down is
// journalled under the name the world has for it afterwards: a torch on a wall is a wall_torch, a bed is two cells.
export async function placeBlock(bot: Bot, ref: Block, face: Vec3, item: string, job: string, options: PlaceOptions = {}, checks: CheckOpts = {}): Promise<void> {
  const cell = ref.position.plus(face);
  const op: Op = { kind: "place", pos: cell, against: ref.position, block: item, job };
  const verdict = check(op, worldOf(bot, op), checks);
  if (!verdict.ok) throw new GateRefusal(verdict);
  const before = bot.blockAt(cell)?.name ?? "air";
  await (bot as unknown as Placer)._placeBlockWithOptions(ref, face, options);
  placeBudget.spend(job, Date.now());
  const isBed = item.endsWith("_bed");
  if (isBed) await sleep(150); // the head half arrives in its own update
  const foot = bot.blockAt(cell);
  if (!foot) return;
  done(op, before, foot.name);
  if (isBed) {
    // the head is the cell the foot faces; only that one is the body's
    const toward = FACING[String(foot.getProperties().facing)];
    const head = toward && bot.blockAt(cell.plus(toward));
    if (head && head.name === foot.name) done({ ...op, pos: head.position }, "air", head.name);
  }
}
