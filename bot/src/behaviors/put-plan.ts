// Where `place` puts something: the body names a word (here, ahead, wall, on a block), this picks the exact cell, the
// block it is set against and the face. Pure, over a small view of the world, so it is tested on made-up grids. The
// gate's verdict on a candidate comes in as `vet`, which is how a refused cell makes the next one get tried.
import type { Pos } from "../lib/block-rules";
import { isReplaceable } from "../lib/policy";

export type Where = { kind: "here" } | { kind: "ahead" } | { kind: "wall" } | { kind: "on"; target: Pos };

export interface PutView {
  eye: { x: number; y: number; z: number }; // where the eyes are, for the reach and for the way a bed will face
  feet: Pos; // the cell the feet are in
  facing: { dx: number; dz: number }; // the cardinal it looks along
  nameAt(p: Pos): string | null;
  solid(p: Pos): boolean; // a full block to stand on or set something against
  occupied(p: Pos): boolean; // a player or mob stands in the cell (the body itself is not counted)
}

export type Spot = { cell: Pos; ref: Pos; face: Pos; head?: Pos };
export type PutFail = "no_room" | "too_far" | "not_allowed" | "refused";
export type Plan = { ok: true; spot: Spot; where: string } | { ok: false; reason: PutFail; detail: string };

// survival block reach, eye to the middle of the face it is set against
export const PUT_REACH = 4.5;

const SIDES: ReadonlyArray<Pos> = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];
const add = (a: Pos, b: Pos): Pos => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const down = (p: Pos): Pos => ({ x: p.x, y: p.y - 1, z: p.z });
const up = (p: Pos): Pos => ({ x: p.x, y: p.y + 1, z: p.z });
const same = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

export const isBed = (item: string): boolean => item.endsWith("_bed");
export const isTorch = (item: string): boolean => item === "torch";

// mineflayer's yaw looks along (-sin, -cos); the cardinal it is nearest
export function cardinalOfYaw(yaw: number): { dx: number; dz: number } {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  return Math.abs(dx) > Math.abs(dz) ? { dx: Math.sign(dx) || 0, dz: 0 } : { dx: 0, dz: Math.sign(dz) || 0 };
}

const free = (v: PutView, p: Pos): boolean => {
  const n = v.nameAt(p);
  return n !== null && isReplaceable(n) && !v.occupied(p);
};

const reach = (v: PutView, p: Pos, face: Pos): number =>
  Math.hypot(v.eye.x - (p.x + 0.5 + face.x * 0.5), v.eye.y - (p.y + 0.5 + face.y * 0.5), v.eye.z - (p.z + 0.5 + face.z * 0.5));

// a bed faces the way the body looks at it: the head is the cell beyond the foot, along the larger part of the
// line from the eyes to the foot's middle
function bedHead(v: PutView, foot: Pos): Pos {
  const dx = foot.x + 0.5 - v.eye.x;
  const dz = foot.z + 0.5 - v.eye.z;
  return Math.abs(dx) > Math.abs(dz) ? add(foot, { x: Math.sign(dx), y: 0, z: 0 }) : add(foot, { x: 0, y: 0, z: Math.sign(dz) });
}

const nextToChest = (v: PutView, cell: Pos): boolean => SIDES.some((d) => (v.nameAt(add(cell, d)) ?? "").endsWith("chest"));

const article = (name: string): string => (/^[aeiou]/.test(name) ? "an" : "a");
export const itemWords = (item: string): string => item.replace(/_/g, " ");

// words for the ending: "a crafting table beside it"
export const putWords = (item: string, where: string): string => `${article(item)} ${itemWords(item)} ${where}`;

interface Candidate {
  cell: Pos;
  ref: Pos;
  face: Pos;
}

// the cells to try for a word, best first
function candidates(item: string, where: Where, v: PutView): Candidate[] {
  const floorAt = (cell: Pos): Candidate => ({ cell, ref: down(cell), face: { x: 0, y: 1, z: 0 } });
  const ahead = { x: v.facing.dx, y: 0, z: v.facing.dz };
  switch (where.kind) {
    case "ahead":
      return [floorAt(add(v.feet, ahead))];
    case "here": {
      // the way it faces first, then the sides, then behind
      const order = [ahead, ...SIDES.filter((d) => !same(d, ahead) && !same(d, { x: -ahead.x, y: 0, z: -ahead.z })), { x: -ahead.x, y: 0, z: -ahead.z }];
      return order.map((d) => floorAt(add(v.feet, d)));
    }
    case "on":
      return [{ cell: up(where.target), ref: where.target, face: { x: 0, y: 1, z: 0 } }];
    case "wall": {
      // a cell beside the body (at its feet or its head) with a wall behind it, the torch on the wall's face
      const out: Candidate[] = [];
      for (const dy of [1, 0]) {
        for (const d of [ahead, ...SIDES.filter((s) => !same(s, ahead))]) {
          const cell = add(v.feet, { x: d.x, y: dy, z: d.z });
          for (const w of SIDES) out.push({ cell, ref: add(cell, w), face: { x: -w.x || 0, y: 0, z: -w.z || 0 } });
        }
      }
      return out;
    }
  }
}

const WORDS: Record<Where["kind"], string> = { here: "beside it", ahead: "ahead of it", wall: "on the wall", on: "on top of it" };

export function planPut(item: string, where: Where, v: PutView, vet: (cell: Pos, against: Pos) => string | null = () => null): Plan {
  if (where.kind === "wall" && !isTorch(item)) return { ok: false, reason: "not_allowed", detail: "only a torch goes on a wall" };
  let refused: string | null = null;
  let far = false;
  let any = false;
  for (const c of candidates(item, where, v)) {
    if (same(c.cell, v.feet) || same(c.cell, up(v.feet))) continue; // the body's own column
    if (!free(v, c.cell) || !v.solid(c.ref)) continue;
    if (item === "chest" && nextToChest(v, c.cell)) continue; // two chests side by side are one double chest
    if (reach(v, c.ref, c.face) > PUT_REACH) {
      far = true;
      continue;
    }
    let head: Pos | undefined;
    if (isBed(item)) {
      head = bedHead(v, c.cell);
      if (!free(v, head) || !v.solid(down(head)) || !v.solid(down(c.cell))) continue;
    }
    any = true;
    const no = vet(c.cell, c.ref) ?? (head ? vet(head, down(head)) : null);
    if (no) {
      refused ??= no;
      continue;
    }
    return { ok: true, spot: { ...c, head }, where: where.kind === "on" ? `on top of ${itemWords(v.nameAt(where.target) ?? "it")}` : WORDS[where.kind] };
  }
  if (refused) return { ok: false, reason: "refused", detail: refused };
  if (far && !any) return { ok: false, reason: "too_far", detail: "that is too far to reach from here" };
  return { ok: false, reason: "no_room", detail: where.kind === "wall" ? "no wall within reach to put it on" : where.kind === "on" ? "nothing free on top of that" : "no free ground there to set it on" };
}
