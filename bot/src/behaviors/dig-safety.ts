// The look-before-you-dig rule every mining step shares. The rules themselves are lib/policy.ts, the same
// check the doors run again at the moment of the dig; this is the planners' view of it (a stand, a name grid).
// A block is dug only when digging it can't let lava or water loose, bring sand or gravel down on the body,
// or take apart something a player made.
import { journal } from "../lib/journal";
import { check, type Op } from "../lib/policy";
import { BUILD_HEIGHT, MADE_RADIUS, isMade, type NameAt, type Pos } from "../lib/block-rules";

export * from "../lib/block-rules";

// A position test lifts the made-block rules for the blocks a player pointed at: a grant, as far as a planner
// can see. There is no "all of it" form. It never touches liquid, falling or standing checks.
export type DigOpts = { allowMade?: (p: Pos) => boolean };

// the made blocks that make safeToDig refuse a target: within the radius, or above it in its column; the body's own
// (the journal's word) are not builds
export function madeBlocksNear(target: Pos, nameAt: NameAt): Pos[] {
  const found: Pos[] = [];
  const look = (dx: number, dy: number, dz: number) => {
    const p = { x: target.x + dx, y: target.y + dy, z: target.z + dz };
    const name = nameAt(p);
    if (name !== null && isMade(name) && !journal.ownAt(p, name)) found.push(p);
  };
  for (let dx = -MADE_RADIUS; dx <= MADE_RADIUS; dx++)
    for (let dy = -MADE_RADIUS; dy <= MADE_RADIUS; dy++) for (let dz = -MADE_RADIUS; dz <= MADE_RADIUS; dz++) look(dx, dy, dz);
  for (let dy = MADE_RADIUS + 1; dy <= BUILD_HEIGHT; dy++)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) look(dx, dy, dz);
  return found;
}

export function safeToDig(target: Pos, nameAt: NameAt, stand?: Pos, opts: DigOpts = {}): boolean {
  const op: Op = { kind: "dig", pos: target, job: "plan" };
  return check(op, { nameAt, isOwn: (p, n) => journal.ownAt(p, n) || journal.restoredAt(p, n), granted: opts.allowMade && ((p) => opts.allowMade?.(p) === true) }, { stand }).ok;
}
