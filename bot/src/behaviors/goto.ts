// The `go_to` intent: walk to something the mind was handed a handle for (senses/handles.ts). The
// handle is resolved here, inside the body; a position or entity id never goes back out.
import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { nameAtOf } from "../lib/gate";
import { setStatus } from "../lib/status";
import { HandleTable, isPlace } from "../senses/handles";
import { isOverworld, placeSpot } from "../senses/observe";
import { madeBlocksNear } from "./dig-safety";
import { TaskError } from "./fail";
import { reverted } from "./refused";
import { StuckError, walkTo } from "./unstuck";
import { walkWithin } from "./walk";

const ENTITY_ARRIVED = 3; // blocks; the walk stops this close to a mob or player
const REWALKS = 5; // the target moves, so the walk is redone from where it ended up
const BUDGET_MS = 90_000;

export interface Destination {
  label: string; // for the status text
  // where it is now; null once it is gone
  at(): Vec3 | null;
  moves: boolean;
  near: number; // goal radius in blocks
}

// null for a handle that is unknown, expired, or whose target has gone
export function destination(bot: Bot, handles: HandleTable, handle: string): Destination | null {
  if (isPlace(handle)) {
    if (!isOverworld(bot) || !placeSpot(handle)) return null; // the known places are overworld positions; the stair only once dug
    return { label: handle === "home" ? "home" : `the ${handle}`, at: () => placeSpot(handle), moves: false, near: handle === "home" ? 4 : 2 };
  }
  const t = handles.resolve(handle);
  if (!t) return null;
  if (t.kind === "entity") {
    if (!bot.entities[t.id]) return null;
    return { label: t.label, at: () => bot.entities[t.id]?.position ?? null, moves: true, near: 2 };
  }
  const block = bot.blockAt(new Vec3(t.x, t.y, t.z), false);
  if (block?.name !== t.name) return null; // mined, replaced or not loaded
  return { label: `the ${t.name.replace(/_/g, " ")}`, at: () => block.position, moves: false, near: 2 };
}

export async function goTo(bot: Bot, handles: HandleTable, handle: string): Promise<void> {
  const dest = destination(bot, handles, handle);
  if (!dest) throw new Error("stale_handle");
  await setStatus({ task: `walking to ${dest.label}` });
  const deadline = Date.now() + BUDGET_MS;
  try {
    for (let leg = 0; ; leg++) {
      const p = dest.at();
      if (!p) throw new Error("stale_handle");
      if (dest.moves && p.distanceTo(bot.entity.position) <= ENTITY_ARRIVED) break;
      if (leg > (dest.moves ? REWALKS : 0) || Date.now() > deadline) {
        throw new StuckError(dest.moves && leg > REWALKS ? "the target kept moving away" : "ran out of time on the way");
      }
      await walkTo(bot, new goals.GoalNear(p.x, p.y, p.z, dest.near));
      if (!dest.moves) break;
    }
  } catch (err) {
    // a reflex or a stop owns the status after any other failure
    if (err instanceof StuckError) await setStatus({ task: "idle" });
    throw err;
  }
  await setStatus({ task: "idle" });
}

const ARRIVED = 2; // blocks; this close to the cell counts as there

// `go_to {x,y,z}`: on foot to a cell, by the safe movements (never a dig or a placed block). A cell inside a kept-out
// zone or beside a build is refused in words, as a dig there would be, so the mind does not stand where it may not work.
export async function goToPoint(bot: Bot, p: { x: number; y: number; z: number }): Promise<void> {
  if (!isOverworld(bot)) throw new TaskError("refused", "it only walks by place in the overworld");
  if (reverted.covers(p)) throw new TaskError("refused", "that spot is where its digs were undone");
  if (madeBlocksNear(p, nameAtOf(bot)).length > 0) throw new TaskError("refused", "something a player built is too close to there");
  const here = () => bot.entity.position.distanceTo(new Vec3(p.x + 0.5, p.y + 0.5, p.z + 0.5)) <= ARRIVED + 0.5;
  if (here()) return;
  if (!bot.blockAt(new Vec3(p.x, p.y, p.z))) throw new StuckError("that place is too far to see");

  await setStatus({ task: "walking to a place" });
  try {
    await walkWithin(bot, new goals.GoalBlock(p.x, p.y, p.z), BUDGET_MS);
  } catch (err) {
    // a walk that ended a block or two short of the cell is an arrival; a reflex or a stop owns the status after it
    if (err instanceof StuckError) {
      await setStatus({ task: "idle" });
      if (here()) return;
    }
    throw err;
  }
  await setStatus({ task: "idle" });
}
