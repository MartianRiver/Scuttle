// The stair the body dug, remembered for its life so it can walk back up: the cells its feet stood in, top first,
// and the way it faced, then the tunnel cut off its foot (a branch mine) and the ore already seen along it. A tunnel
// begun away from any stair is a way of its own, its first cell the top. Positions stay in here; `observe` says only
// that it is there and which way it leads.
import type { Pos } from "./dig-safety";
import type { Facing } from "./dig-down-plan";

interface Stair {
  facing: Facing;
  steps: Pos[]; // steps[0] is the surface cell the first step was taken from
  tunnel: Pos[]; // the feet cells of the tunnel, in the order they were dug; none dug yet is empty
  tunnelFacing: Facing | null;
  ores: Set<string>; // ore the tunnel has already told of, so a second run does not stop at it again
}

let stair: Stair | null = null;

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;

export function beginStair(top: Pos, facing: Facing): void {
  stair = { facing, steps: [{ ...top }], tunnel: [], tunnelFacing: null, ores: new Set() };
}

// where a tunnel goes on from: the last cell of the tunnel, or the foot of the stair before one is dug
export const wayEnd = (): Pos | null => (stair ? (stair.tunnel[stair.tunnel.length - 1] ?? stair.steps[stair.steps.length - 1]) : null);
// the way a tunnel run from the end of the way goes on: the tunnel's own, else the stair's
export const wayFacing = (): Facing | null => stair?.tunnelFacing ?? stair?.facing ?? null;

export function addTunnelCell(p: Pos, facing: Facing): void {
  if (!stair) return;
  stair.tunnelFacing = facing;
  if (!stair.tunnel.some((t) => same(t, p))) stair.tunnel.push({ ...p });
}

export const oreKnown = (k: string): boolean => stair?.ores.has(k) ?? false;
export function noteOre(k: string): void {
  stair?.ores.add(k);
}

const near = (a: Pos, b: Pos): boolean => Math.abs(a.x - b.x) <= 1 && Math.abs(a.z - b.z) <= 1 && Math.abs(a.y - b.y) <= 1;
const onTunnel = (p: Pos): boolean => stair?.tunnel.some((t) => near(t, p)) ?? false;

// on or against the way it dug (a block to either side of a stair step or tunnel cell, or the pit under the foot): a tunnel
// begun here goes on with the way instead of starting another and forgetting the stair
export const inWay = (p: Pos): boolean => (stair?.steps.some((s) => near(s, p)) ?? false) || onTunnel(p);

export function addStep(p: Pos): void {
  if (stair && !same(stair.steps[stair.steps.length - 1], p)) stair.steps.push({ ...p });
}

export const hasStair = (): boolean => stair !== null;
// cells the way back to the top passes: every step and every tunnel cell
export const stairSize = (): number => (stair ? stair.steps.length + stair.tunnel.length : 0);
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

// which way a walk to the top goes from `body`: up when the body is a good way below it, or a few blocks along a tunnel
// from it; else the way leads down
export function stairLeads(body: Pos): "up" | "down" {
  const top = stairTop();
  if (!top) return "down";
  if (body.y <= top.y - 2) return "up";
  return onTunnel(body) && Math.hypot(body.x - top.x, body.z - top.z) >= 3 ? "up" : "down";
}
