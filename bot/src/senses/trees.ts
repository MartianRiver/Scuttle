// Which trees to list in an observation: one handle per tree, on its base log, and only the ones
// get_wood itself would cut (a plain log with natural leaves near it), so a log cabin is never
// shown as a tree. Pure: the caller says what is where.
import { isPlainLogName, nearNaturalLeaves } from "../lib/movement";
import type { Pos } from "../behaviors/dig-safety";
import { PER_KIND } from "./notable";

export const TREE_TESTS = 40; // bases looked at (each is a few hundred block reads) before giving up
const MAX_TRUNK = 48;

export interface TreeProbe {
  nameAt(p: Pos): string | null;
  naturalLeafAt(p: Pos): boolean; // natural (non-persistent) leaves at this cell
  visible(p: Pos): boolean; // the eye reaches the log
}

// the lowest log of the column this one is in
export function baseLog(p: Pos, nameAt: (p: Pos) => string | null): Pos {
  let y = p.y;
  for (let i = 0; i < MAX_TRUNK; i++) {
    const below = nameAt({ x: p.x, y: y - 1, z: p.z });
    if (below === null || !isPlainLogName(below)) break;
    y--;
  }
  return { x: p.x, y, z: p.z };
}

// get_wood's gate, on a log at `p`
export const isNaturalAt = (p: Pos, probe: TreeProbe): boolean => {
  const name = probe.nameAt(p);
  return name !== null && isPlainLogName(name) && nearNaturalLeaves((dx, dy, dz) => probe.naturalLeafAt({ x: p.x + dx, y: p.y + dy, z: p.z + dz }));
};

// `logs` come nearest first. A thick trunk (2 by 2) is one tree.
export function pickTrees(logs: readonly Pos[], probe: TreeProbe, cap = PER_KIND, maxTests = TREE_TESTS): Pos[] {
  const seen = new Set<string>();
  const picked: Pos[] = [];
  let tested = 0;
  for (const log of logs) {
    if (picked.length >= cap || tested >= maxTests) break;
    const base = baseLog(log, probe.nameAt);
    const key = `${base.x},${base.y},${base.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (picked.some((t) => Math.abs(t.x - base.x) <= 1 && Math.abs(t.z - base.z) <= 1)) continue;
    tested++;
    if (!isNaturalAt(base, probe) || !probe.visible(base)) continue;
    picked.push(base);
  }
  return picked;
}
