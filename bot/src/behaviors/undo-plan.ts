// What `undo` takes back, planned apart from the world: the journal's entries of one job, newest first, each checked
// against what the cell holds now. A place is taken out again, a dig is put back with what that block drops when dug
// (stone goes back as cobblestone: the block itself is never in the pack), and only when that is carried and the hands
// may set it down; a cell that cannot be put back is said so, never filled with something else. Pure, tested on
// made-up histories.
import { handsPlaceable } from "../lib/policy";
import { dropOf, type Loot } from "./block-drop";
import { isUndoJob, keyOf, UNDO_PREFIX, type Entry } from "../lib/journal";
import type { Pos } from "../lib/block-rules";
import { numberWords } from "./dig-down-plan";

export const UNDO_MAX = 16; // cells in one call; the place budget is 16 a job too

export type Why = "changed" | "no_block" | "not_carried" | "not_set_down" | "chest" | "stood" | "refused" | "stuck";
export type Skip = { pos: Pos; why: Why };

// the item a dug cell is filled with; for a place it is the block taken up
export type Todo = Entry & { item: string };

export interface UndoPlan {
  job: string | null;
  todo: Todo[]; // newest first, at most UNDO_MAX
  skipped: Skip[];
  more: boolean; // cells left over the cap
}

// what a `what` is in a sentence about the cells it could not take back
const WHY: Record<Why, string> = {
  changed: "changed since",
  no_block: "gave nothing it can set down again",
  not_carried: "it had none of what that block drops to put back",
  not_set_down: "not something it set down",
  chest: "held things, take them out first",
  stood: "it was standing there",
  refused: "the server or the rules said no",
  stuck: "it could not get at",
};

const undoneBy = (e: Entry, job: string): boolean => e.job.startsWith(`${UNDO_PREFIX}${job}|`);

// the kinds of job the mind may ask to undo: the part of the key before the `@`. The fixed keys (a tree, a pick_up, the
// base) are no run of their own, so they are never the answer to "the last one"
export const UNDO_KINDS = ["dig_down", "dig_shaft", "tunnel", "place", "make_mine"] as const;
export type UndoKind = (typeof UNDO_KINDS)[number];
export const jobKind = (job: string): string => job.split("@")[0];

// The job to undo: the newest of that kind (any kind it may undo when none is named) that still has a cell where the world
// is what the job left. A job whose cells all changed outside the journal (a player's work, the test world's own tidying)
// is passed over, or it would stay "last" and hide every older one; a cell that is not loaded is still taken to be there.
export function lastJob(history: readonly Entry[], kind?: string, nameNow?: (p: Pos) => string | null): string | null {
  const latest = new Map<string, Entry>();
  for (const e of history) latest.set(keyOf(e.pos), e);
  const wanted = (job: string): boolean => (kind ? jobKind(job) === kind : (UNDO_KINDS as readonly string[]).includes(jobKind(job)));
  const standing = (e: Entry): boolean => {
    const now = nameNow?.(e.pos);
    return nameNow === undefined || now === null || now === e.after;
  };
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (!isUndoJob(e.job) && wanted(e.job) && latest.get(keyOf(e.pos)) === e && standing(e)) return e.job;
  }
  return null;
}

// `carried` is how many of each block the pack holds, `nameNow` what is in a cell, `loot` the registry's drops. A restore
// uses one carried block.
export function planUndo(history: readonly Entry[], job: string | null, nameNow: (p: Pos) => string | null, carried: Record<string, number>, loot?: Loot): UndoPlan {
  const which = job;
  const plan: UndoPlan = { job: which, todo: [], skipped: [], more: false };
  if (which === null) return plan;
  const latest = new Map<string, Entry>();
  for (const e of history) latest.set(keyOf(e.pos), e);
  const left = { ...carried };
  const seen = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.job !== which) continue;
    const k = keyOf(e.pos);
    if (seen.has(k)) continue; // a cell the job changed twice: the newest entry stands for it
    seen.add(k);
    const now = latest.get(k) as Entry;
    if (now !== e) {
      if (!undoneBy(now, which) && now.job !== which) plan.skipped.push({ pos: e.pos, why: "changed" });
      continue;
    }
    const name = nameNow(e.pos);
    if (name !== e.after) {
      plan.skipped.push({ pos: e.pos, why: name === null ? "stuck" : "changed" });
      continue;
    }
    if (e.op === "place") {
      if (!e.own) plan.skipped.push({ pos: e.pos, why: "not_set_down" });
      else if (plan.todo.length >= UNDO_MAX) plan.more = true;
      else plan.todo.push({ ...e, item: e.after });
      continue;
    }
    const item = dropOf(e.before, loot);
    if (!handsPlaceable(item)) {
      plan.skipped.push({ pos: e.pos, why: "no_block" });
      continue;
    }
    if ((left[item] ?? 0) < 1) {
      plan.skipped.push({ pos: e.pos, why: "not_carried" });
      continue;
    }
    if (plan.todo.length >= UNDO_MAX) {
      plan.more = true;
      continue;
    }
    left[item]--;
    plan.todo.push({ ...e, item });
  }
  return plan;
}

const plural = (n: number, one: string, many: string): string => `${numberWords(n)} ${n === 1 ? one : many}`;

// the ending's words, no digits: "put back six blocks and took up two; one it could not undo (changed since)"
export function undoWords(taken: number, put: number, skipped: readonly Skip[], more: boolean): string {
  const did = [put > 0 && `put back ${plural(put, "block", "blocks")}`, taken > 0 && `took up ${plural(taken, "block", "blocks")}`].filter(Boolean).join(" and ");
  const byWhy = new Map<Why, number>();
  for (const s of skipped) byWhy.set(s.why, (byWhy.get(s.why) ?? 0) + 1);
  const left = [...byWhy].map(([why, n]) => `${plural(n, "cell", "cells")} ${WHY[why]}`).join(", ");
  const parts = [did || "nothing undone", left && `left: ${left}`, more && "more to undo, ask again"].filter(Boolean);
  return parts.join("; ");
}

// where a block can be set to fill `cell` again: a solid neighbour to set it against, in reach of the eyes and not the
// body's own column. null when there is none.
export interface RestoreView {
  eye: { x: number; y: number; z: number };
  feet: Pos;
  solid(p: Pos): boolean;
}
export const RESTORE_REACH = 4.5;
const SIX: ReadonlyArray<Pos> = [
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export function restoreSpot(cell: Pos, v: RestoreView): { ref: Pos; face: Pos } | "stood" | null {
  if (cell.x === v.feet.x && cell.z === v.feet.z && (cell.y === v.feet.y || cell.y === v.feet.y + 1)) return "stood";
  for (const d of SIX) {
    const ref = { x: cell.x + d.x, y: cell.y + d.y, z: cell.z + d.z };
    if (!v.solid(ref)) continue;
    const face = { x: -d.x || 0, y: -d.y || 0, z: -d.z || 0 };
    const reach = Math.hypot(v.eye.x - (ref.x + 0.5 + face.x * 0.5), v.eye.y - (ref.y + 0.5 + face.y * 0.5), v.eye.z - (ref.z + 0.5 + face.z * 0.5));
    if (reach <= RESTORE_REACH) return { ref, face };
  }
  return null;
}
