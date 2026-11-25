import assert from "node:assert/strict";
import { test } from "node:test";
import type { Blueprint, Parsed } from "../src/build/blueprint";
import { fenceLine, fencePerimeter, path, platform, stairsUp, wall } from "../src/build/generators";

function made(r: Parsed): Blueprint {
  assert.ok(r.ok, r.ok ? "" : r.problems.join("; "));
  return r.value;
}
const refused = (r: Parsed): string => {
  assert.equal(r.ok, false);
  return r.ok ? "" : r.problems.join("; ");
};
const count = (bp: Blueprint, block: string) => bp.cells.filter((c) => bp.palette[c.p] === block).length;
const gates = (bp: Blueprint) => bp.cells.filter((c) => bp.palette[c.p].endsWith("_gate")).map((c) => `${c.x},${c.z}`).sort();

test("path and platform are flat and full", () => {
  const p = made(path(5, 3, "cobblestone"));
  assert.deepEqual(p.size, { x: 3, y: 1, z: 5 });
  assert.equal(p.cells.length, 15);
  const f = made(platform(4, 6, "oak_planks"));
  assert.deepEqual(f.size, { x: 4, y: 1, z: 6 });
  assert.equal(f.cells.length, 24);
  assert.ok(f.cells.every((c) => c.y === 0));
});

test("wall is one block thick", () => {
  const w = made(wall(5, 3, "stone_bricks"));
  assert.deepEqual(w.size, { x: 5, y: 3, z: 1 });
  assert.equal(w.cells.length, 15);
  assert.ok(w.cells.every((c) => c.z === 0));
  assert.equal(made(wall(4, 2, "glass")).cells.length, 8);
});

test("steps rise one block per step, filled to the ground", () => {
  const s = made(stairsUp(3, 2, "cobblestone"));
  assert.deepEqual(s.size, { x: 2, y: 3, z: 3 });
  assert.equal(s.cells.length, 2 * (1 + 2 + 3));
  for (const c of s.cells) assert.ok(c.y <= c.z);
  for (let z = 0; z < 3; z++) assert.equal(Math.max(...s.cells.filter((c) => c.z === z).map((c) => c.y)), z);
});

test("a 19x19 fence with a gate on each side: 72 cells, 68 posts, 4 gates, none on a corner", () => {
  const f = made(fencePerimeter(19, 19, "oak_fence", ["north", "east", "south", "west"]));
  assert.equal(f.cells.length, 72);
  assert.equal(count(f, "oak_fence"), 68);
  assert.equal(count(f, "oak_fence_gate"), 4);
  assert.deepEqual(gates(f), ["0,9", "18,9", "9,0", "9,18"]);
});

test("a perimeter with no gates, and with only some", () => {
  const plain = made(fencePerimeter(5, 4, "birch_fence"));
  assert.equal(plain.cells.length, 14);
  assert.deepEqual(plain.palette, { f: "birch_fence" });
  const two = made(fencePerimeter(6, 4, "oak_fence", ["north", "east"]));
  // even sides: the floor of the half
  assert.deepEqual(gates(two), ["2,0", "5,1"]);
  assert.equal(two.cells.length, 2 * 6 + 2 * 2);
  const corners = two.cells.filter((c) => (c.x === 0 || c.x === 5) && (c.z === 0 || c.z === 3));
  assert.ok(corners.every((c) => two.palette[c.p] === "oak_fence"));
});

test("a 3x3 perimeter still has a gate that is not a corner", () => {
  const f = made(fencePerimeter(3, 3, "oak_fence", ["north", "south", "east", "west"]));
  assert.equal(f.cells.length, 8);
  assert.deepEqual(gates(f), ["0,1", "1,0", "1,2", "2,1"]);
});

test("a fence line, with gates every n and never at an end", () => {
  const plain = made(fenceLine(6, "spruce_fence"));
  assert.equal(plain.cells.length, 6);
  assert.deepEqual(plain.size, { x: 6, y: 1, z: 1 });
  const g = made(fenceLine(12, "oak_fence", 5));
  assert.equal(g.cells.length, 12);
  assert.deepEqual(gates(g), ["4,0", "9,0"]);
  assert.deepEqual(gates(made(fenceLine(5, "oak_fence", 4))), ["3,0"]);
  assert.equal(made(fenceLine(1, "oak_fence")).cells.length, 1);
});

test("out-of-range arguments are refused with words", () => {
  assert.match(refused(path(0, 3, "stone")), /length must be a whole number from 1 to 32/);
  assert.match(refused(path(33, 3, "stone")), /length/);
  assert.match(refused(path(2.5, 3, "stone")), /length/);
  assert.match(refused(path(Number.NaN, 3, "stone")), /length/);
  assert.match(refused(platform(4, 0, "stone")), /d must be/);
  assert.match(refused(wall(5, 17, "stone")), /height must be a whole number from 1 to 16/);
  assert.match(refused(stairsUp(17, 2, "stone")), /height/);
  assert.match(refused(fencePerimeter(2, 5, "oak_fence")), /w must be a whole number from 3 to 32/);
  assert.match(refused(fencePerimeter(5, 5, "oak_fence", ["up" as never])), /not a side/);
  assert.match(refused(fencePerimeter(5, 5, "oak_fence", ["north", "north"])), /named twice/);
  assert.match(refused(fenceLine(10, "oak_fence", 2)), /gateEvery/);
  assert.match(refused(fenceLine(6, "oak_fence", 6)), /no gate inside a line of 6; use 5 or less/);
  assert.match(refused(wall(Number.POSITIVE_INFINITY, 2, "stone")), /length/);
});

test("materials are checked against the family", () => {
  assert.match(refused(path(3, 3, "oak_fence")), /not a block Scuttle lays a path with/);
  assert.match(refused(path(3, 3, "tnt")), /tnt/);
  assert.match(refused(path(3, 3, "glass")), /path/);
  assert.match(refused(wall(3, 3, "torch")), /wall/);
  assert.match(refused(fenceLine(3, "cobblestone")), /not a fence/);
  assert.match(refused(fencePerimeter(5, 5, "oak_fence_gate")), /not a fence/);
  assert.match(refused(fenceLine(3, "nether_brick_fence")), /not a fence/);
  assert.match(refused(path(3, 3, undefined as never)), /that is not/);
});

test("a build too big for the cell cap is refused by the parser", () => {
  assert.match(refused(stairsUp(16, 32, "stone")), /4352 cells/);
});

test("every fence has a matching gate in the allowlist", () => {
  for (const wood of ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak", "bamboo"]) {
    assert.ok(fenceLine(5, `${wood}_fence`, 3).ok, wood);
  }
});
