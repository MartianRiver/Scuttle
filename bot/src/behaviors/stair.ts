// The stair the body dug, remembered for its life so it can walk back up: the cells its feet stood in, top first,
// and the way it faced. Positions stay in here; `observe` says only that it is there and which way it leads.
import type { Pos } from "./dig-safety";
import type { Facing } from "./dig-down-plan";

interface Stair {
  facing: Facing;
  steps: Pos[]; // steps[0] is the surface cell the first step was taken from
}

let stair: Stair | null = null;

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;

export function beginStair(top: Pos, facing: Facing): void {
  stair = { facing, steps: [{ ...top }] };
}

export function addStep(p: Pos): void {
  if (stair && !same(stair.steps[stair.steps.length - 1], p)) stair.steps.push({ ...p });
}

export const hasStair = (): boolean => stair !== null;
export const stairTop = (): Pos | null => stair?.steps[0] ?? null;
export const stairFacing = (): Facing | null => stair?.facing ?? null;
export const stairBottom = (): Pos | null => (stair ? stair.steps[stair.steps.length - 1] : null);
export const isStairStep = (p: Pos): boolean => stair?.steps.some((s) => same(s, p)) ?? false;
export const forgetStair = (): void => {
  stair = null;
};

// Whether the stair is cut into the ground the body stands in now: it is by its steps, within a block or so
export function nearStair(p: Pos, reach = 2): boolean {
  return stair?.steps.some((s) => Math.abs(s.x - p.x) <= reach && Math.abs(s.z - p.z) <= reach && Math.abs(s.y - p.y) <= reach) ?? false;
}

// which way a walk to the top goes from `body`: up when the body is a good way below it, else the stair leads down
export function stairLeads(body: Pos): "up" | "down" {
  const top = stairTop();
  return top && body.y <= top.y - 2 ? "up" : "down";
}
