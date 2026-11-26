// `ensure`: gets a pickaxe, torches, food or all three back up to what a strip needs, without leaving the mine. It looks in
// the landing chest (its own, nothing else), then crafts from what it holds: the plan is ensure-plan.ts, this runs it with
// the existing `take` and `craft`. It does not smelt and it does not walk to the surface or the base: what it cannot make
// from what the chest and the pack hold it says, in words. Making the whole chain from nothing is roadmap 0.8.8.
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { base } from "../lib/base";
import { getMine } from "../lib/sites";
import { durabilityLeft } from "../senses/bands";
import { carried } from "./run-report";
import { craft } from "./craft";
import { GOOD_LEFT, lacksWords, planEnsure, type Counts, type EnsureWhat, type Part } from "./ensure-plan";
import { TaskError } from "./fail";
import { restockable } from "./food";
import type { MineCtx } from "./mine";
import { ownChests, peekChest, take } from "./stash";
import { OWN_NEAR } from "./stash-plan";
import { foodTable } from "./survival";

const NEAR_LANDING = 64; // blocks: a landing chest this near is the one to use

const flat = (a: Vec3, b: Vec3): number => a.distanceTo(b);

// the landing's chest when the body is at the mine, else the nearest chest of its own or the base's within a few
// blocks; null when there is none, and then only what it carries can be made into anything
function chestFor(bot: Bot): Vec3 | null {
  const me = bot.entity.position;
  const k = getMine()?.kit.chest;
  if (k) {
    const landing = new Vec3(k.x, k.y, k.z);
    if (flat(landing, me) <= NEAR_LANDING && ownChests(bot).some((c) => c.equals(landing))) return landing;
  }
  const near = [...ownChests(bot), ...base.stashChests].filter((c) => flat(c, me) <= OWN_NEAR).sort((a, b) => flat(a, me) - flat(b, me));
  return near[0] ?? null;
}

// pickaxes it carries that still have life in them
function goodPickaxes(bot: Bot): number {
  return bot.inventory
    .items()
    .filter((i) => i.name.endsWith("_pickaxe") && i.maxDurability && durabilityLeft(i.durabilityUsed ?? 0, i.maxDurability) >= GOOD_LEFT)
    .reduce((n, i) => n + i.count, 0);
}

function foodsOf(bot: Bot): Record<string, number> {
  const table = foodTable(bot);
  return Object.fromEntries(Object.entries(table).filter(([name]) => restockable(name, table)).map(([name, f]) => [name, f.points]));
}

const NAMES: Record<Part["what"], string> = { pickaxe: "a pickaxe", torches: "torches", food: "food" };

// Throws what `take` and `craft` throw (none_stashed, missing, no_table ...) when a step fails, and `missing` with what is
// still lacking when the plan could not be finished, after doing as much of it as it could. Returns what it has.
export async function ensure(bot: Bot, ctx: MineCtx, what: EnsureWhat, count?: number): Promise<{ detail: string }> {
  const chest = chestFor(bot);
  const inChest = chest ? await peekChest(bot, ctx, chest) : ({} as Counts);
  const parts = planEnsure({ what, count, pack: carried(bot), chest: inChest, good: goodPickaxes(bot), foods: foodsOf(bot) });

  const lacks: Counts = {};
  let failure: TaskError | null = null;
  for (const part of parts) {
    Object.assign(lacks, part.lacks);
    for (const step of part.steps) {
      ctx.checkStop();
      try {
        if (step.do === "take") await take(bot, ctx, step.item, step.count, chest ?? undefined);
        else await craft(bot, ctx, step.item, step.count);
      } catch (err) {
        if (!(err instanceof TaskError)) throw err;
        failure ??= err;
        break; // the rest of this part rests on the step that failed; the next part is its own
      }
    }
  }

  if (Object.keys(lacks).length === 0 && failure === null) {
    const names = parts.map((p) => NAMES[p.what]).join(", ");
    return { detail: parts.every((p) => p.steps.length === 0) ? `it already had ${names}` : `it now has ${names}` };
  }
  const detail = [failure?.detail, lacksWords(lacks)].filter(Boolean).join("; ");
  const reason = failure?.reason ?? (Object.keys(lacks).every((k) => k === "food") ? "none_stashed" : "missing");
  throw new TaskError(reason, detail || undefined, Object.keys(lacks).length > 0 ? lacks : undefined);
}
