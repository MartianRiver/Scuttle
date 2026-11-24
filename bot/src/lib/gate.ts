// The live side of the policy: reads the world, the zones and the grants and asks lib/policy.ts, at the moment of
// the change. The doors (dig() in collect.ts, safeToBreak in movement.ts, placeBlock in place-block.ts) come here and
// nowhere else; doors.test.ts fails if a new one is added.
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { TaskError } from "../behaviors/fail";
import { refusedNow, reverted } from "../behaviors/refused";
import { check, GrantStore, memoNames, PlaceBudget, type CheckOpts, type Op, type Refusal, type Verdict, type World } from "./policy";
import type { NameAt, Pos } from "./block-rules";

export const grants = new GrantStore();
export const placeBudget = new PlaceBudget();

// the journal plugs in here: true when the body placed this block and it is still what it placed
export const hooks = { isOwn: (_p: Pos, _blockNow: string): boolean => false };

export type Refused = Extract<Verdict, { ok: false }>;

// a door's refusal; callers turn it into the TaskError or the quiet skip they already have
export class GateRefusal extends Error {
  constructor(readonly verdict: Refused) {
    super(verdict.reason);
  }
}

// the TaskError kinds the callers already use
const KIND: Record<Refusal, string> = { player_built: "refused", protected: "protected", unsafe: "blocked", unknown: "blocked", not_allowed: "refused" };
export const taskErrorOf = (v: Refused): TaskError => new TaskError(KIND[v.reason], v.detail);

export const nameAtOf =
  (bot: Bot): NameAt =>
  (p) =>
    bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null;

const MOB = new Set(["player", "mob", "hostile", "animal", "passive"]);

export function worldOf(bot: Bot, _op: Op, nameAt: NameAt = nameAtOf(bot), now: number = Date.now()): World {
  return {
    nameAt,
    solidAt: (p) => bot.blockAt(new Vec3(p.x, p.y, p.z))?.boundingBox === "block",
    zonesAt: (p) => {
      refusedNow(now); // forgets zones that have faded
      const z = reverted.find(p);
      return z ? [z.reason] : [];
    },
    isOwn: hooks.isOwn,
    granted: (p, o) => grants.covers(p, o, now),
    budgetLeft: (job) => placeBudget.left(job, now),
    occupied: (p) =>
      Object.values(bot.entities).some((e) => e !== bot.entity && MOB.has(e.type) && Math.floor(e.position.x) === p.x && Math.floor(e.position.y) === p.y && Math.floor(e.position.z) === p.z),
  };
}

// the dig door: the block is read again, and must still be the one planned
export function gateDig(bot: Bot, block: Block, job: string, opts: CheckOpts = {}): Verdict {
  const op: Op = { kind: "dig", pos: block.position, job };
  const live = bot.blockAt(block.position);
  if (!live || live.type !== block.type) return { ok: false, reason: "unknown", detail: "the block is not what it planned to dig" };
  return check(op, worldOf(bot, op), opts);
}

// The pathfinder's door: one answer per block for the life of the task it was made for, names remembered across
// scans. Only the made radius, zones and the block's own provenance apply: it digs trees, never ground, so the
// liquid and falling rules stay out as they always have.
export function breakGate(bot: Bot, job: string): (block: Block) => boolean {
  const names = memoNames(nameAtOf(bot));
  const memo = new Map<string, boolean>();
  return (block) => {
    const key = block.position.toString();
    let ok = memo.get(key);
    if (ok === undefined) {
      const op: Op = { kind: "dig", pos: block.position, job };
      ok = check(op, worldOf(bot, op, names), { physical: false }).ok;
      memo.set(key, ok);
    }
    return ok;
  };
}
