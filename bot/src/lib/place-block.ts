// The one place door: nothing sets a block down without the gate saying yes first. The check and the call are
// one synchronous step, since fillPit times its placing to a single physics tick.
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Vec3 } from "vec3";
import { GateRefusal, placeBudget, worldOf } from "./gate";
import { check, type Op } from "./policy";

type PlaceOptions = { swingArm?: "right" | "left"; forceLook?: boolean | "ignore" };
type Placer = { _placeBlockWithOptions(ref: Block, face: Vec3, o: PlaceOptions): Promise<void> };

// sets `item` against the `face` of `ref`; throws GateRefusal when the policy says no, the server's error when
// the placing itself fails
export async function placeBlock(bot: Bot, ref: Block, face: Vec3, item: string, job: string, options: PlaceOptions = {}): Promise<void> {
  const op: Op = { kind: "place", pos: ref.position.plus(face), against: ref.position, block: item, job };
  const verdict = check(op, worldOf(bot, op));
  if (!verdict.ok) throw new GateRefusal(verdict);
  await (bot as unknown as Placer)._placeBlockWithOptions(ref, face, options);
  placeBudget.spend(job, Date.now());
}
