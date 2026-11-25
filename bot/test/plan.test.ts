import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlueprint, type Blueprint } from "../src/build/blueprint";
import { fencePerimeter, platform, wall } from "../src/build/generators";
import { audit, buildOrder, makePlan, MAX_JOB_CELLS, remaining, type Plan } from "../src/build/plan";

function bp(input: unknown): Blueprint {
  const r = parseBlueprint(input);
  assert.ok(r.ok, r.ok ? "" : r.problems.join("; "));
  return r.value;
}
function gen(r: ReturnType<typeof wall>): Blueprint {
  assert.ok(r.ok, r.ok ? "" : r.problems.join("; "));
  return r.value;
}
function plan(b: Blueprint, origin = { x: 100, y: 64, z: -20 }, facing: "north" | "east" | "south" | "west" = "north", cap?: number): Plan {
  const r = makePlan(b, origin, facing, cap);
  assert.ok(r.ok, r.ok ? "" : r.problems.join("; "));
  return r.plan;
}
const k = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;
const world = (cells: Array<[{ x: number; y: number; z: number }, string]>) => {
  const m = new Map(cells.map(([p, n]) => [k(p), n]));
  return (p: { x: number; y: number; z: number }) => (m.has(k(p)) ? m.get(k(p))! : "air");
};

// a 3x3 pad with a post in the middle, a torch on top, and a roof arm sticking out from the post's top
const tower = () =>
  bp({
    name: "tower",
    size: { x: 3, y: 3, z: 3 },
    palette: { s: "stone", l: "oak_log", t: "torch" },
    cells: [
      ...[0, 1, 2].flatMap((x) => [0, 1, 2].map((z) => ({ x, y: 0, z, p: "s" }))),
      { x: 1, y: 1, z: 1, p: "l" },
      { x: 2, y: 1, z: 1, p: "l" },
      { x: 1, y: 2, z: 1, p: "t" },
    ],
  });

test("cells are placed in world coordinates from the origin", () => {
  const p = plan(gen(platform(3, 2, "oak_planks")));
  assert.equal(p.cells.length, 6);
  assert.deepEqual(p.min, { x: 100, y: 64, z: -20 });
  assert.deepEqual(p.max, { x: 102, y: 64, z: -19 });
  assert.ok(p.cells.every((c) => c.x >= 100 && c.x <= 102 && c.z >= -20 && c.z <= -19 && c.y === 64));
});

test("facing turns the footprint and the origin stays its lowest corner", () => {
  const p = plan(gen(platform(3, 2, "oak_planks")), { x: 0, y: 10, z: 0 }, "east");
  assert.deepEqual(p.max, { x: 1, y: 10, z: 2 });
  assert.ok(p.cells.every((c) => c.x >= 0 && c.x <= 1 && c.z >= 0 && c.z <= 2));
  assert.equal(p.facing, "east");
});

test("order goes layer by layer, foundation first", () => {
  const p = plan(tower());
  const ys = p.cells.map((c) => c.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.equal(p.cells[p.cells.length - 1].block, "torch");
  assert.deepEqual(p.unsupported, []);
});

test("the same blueprint in any cell order gives the same sequence", () => {
  const a = tower();
  const shuffled: Blueprint = { ...a, cells: [...a.cells].reverse() };
  const mid = [...a.cells.slice(4), ...a.cells.slice(0, 4)];
  const base = plan(a).cells.map(k);
  assert.deepEqual(plan(shuffled).cells.map(k), base);
  assert.deepEqual(plan({ ...a, cells: mid }).cells.map(k), base);
  assert.deepEqual(plan(a).cells.map(k), base);
});

test("a cell comes after something that holds it", () => {
  const { ordered } = buildOrder(plan(tower()).cells.map((c) => ({ ...c, x: c.x - 100, y: c.y - 64, z: c.z + 20 })));
  const placed = new Set<string>();
  for (const c of ordered) {
    const held = c.y === 0 || ["0,-1,0", "0,1,0", "1,0,0", "-1,0,0", "0,0,1", "0,0,-1"].some((d) => {
      const [dx, dy, dz] = d.split(",").map(Number);
      return placed.has(`${c.x + dx},${c.y + dy},${c.z + dz}`);
    });
    assert.ok(held, `${k(c)} placed with nothing to hold it`);
    placed.add(k(c));
  }
});

test("a cell off the side of a layer waits for its neighbour, and a torch holds nothing", () => {
  const b = bp({
    name: "arm",
    size: { x: 4, y: 2, z: 1 },
    palette: { s: "stone", t: "torch" },
    cells: [
      { x: 0, y: 0, z: 0, p: "s" },
      { x: 0, y: 1, z: 0, p: "s" },
      { x: 1, y: 1, z: 0, p: "s" },
      { x: 2, y: 1, z: 0, p: "t" },
      { x: 3, y: 1, z: 0, p: "s" },
    ],
  });
  const p = plan(b, { x: 0, y: 0, z: 0 });
  assert.deepEqual(p.cells.map((c) => c.x + "," + c.y), ["0,0", "0,1", "1,1", "2,1", "3,1"]);
  // x=3 hangs off a torch: nothing to be placed against
  assert.deepEqual(p.unsupported.map(k), ["3,1,0"]);
});

test("a floating cell is flagged and goes last in its layer", () => {
  const b = bp({
    name: "float",
    size: { x: 3, y: 3, z: 1 },
    palette: { s: "stone" },
    cells: [
      { x: 0, y: 0, z: 0, p: "s" },
      { x: 2, y: 2, z: 0, p: "s" },
    ],
  });
  const p = plan(b, { x: 0, y: 0, z: 0 });
  assert.deepEqual(p.unsupported.map(k), ["2,2,0"]);
  assert.equal(k(p.cells[1]), "2,2,0");
});

test("materials are totalled by block", () => {
  const p = plan(tower());
  assert.deepEqual(p.materials, { stone: 9, oak_log: 2, torch: 1 });
  const f = plan(gen(fencePerimeter(19, 19, "oak_fence", ["north", "east", "south", "west"])));
  assert.deepEqual(f.materials, { oak_fence: 68, oak_fence_gate: 4 });
  assert.equal(Object.values(f.materials).reduce((a, b) => a + b, 0), f.cells.length);
});

test("one job has a volume cap", () => {
  assert.equal(plan(gen(platform(32, 32, "stone"))).cells.length, 1024);
  assert.equal(MAX_JOB_CELLS, 1024);
  const f = makePlan(gen(fencePerimeter(19, 19, "oak_fence")), { x: 0, y: 64, z: 0 }, "north", 50);
  assert.ok(!f.ok);
  assert.match(f.ok ? "" : f.problems.join(), /72 blocks is over the 50/);
});

test("the origin must be whole and the build must fit the world's height", () => {
  const b = gen(wall(3, 4, "stone"));
  const bad = (o: { x: number; y: number; z: number }) => {
    const r = makePlan(b, o, "north");
    assert.equal(r.ok, false);
    return r.ok ? "" : r.problems.join();
  };
  assert.match(bad({ x: 0.5, y: 64, z: 0 }), /whole/);
  assert.match(bad({ x: 0, y: 318, z: 0 }), /fit/);
  assert.match(bad({ x: 0, y: -65, z: 0 }), /fit/);
  assert.ok(makePlan(b, { x: 0, y: 316, z: 0 }, "north").ok);
});

test("audit of a half-built plan: done, wrong, unknown", () => {
  const p = plan(gen(wall(4, 2, "stone_bricks")), { x: 0, y: 70, z: 0 });
  const at = (x: number, y: number) => ({ x, y: 70 + y, z: 0 });
  const nameAt = (q: { x: number; y: number; z: number }) => (k(q) === k(at(3, 1)) ? null : world([
    [at(0, 0), "stone_bricks"],
    [at(1, 0), "stone_bricks"],
    [at(2, 0), "cobblestone"],
    [at(0, 1), "stone_bricks"],
  ])(q));
  const a = audit(p, nameAt);
  assert.equal(a.total, 8);
  assert.equal(a.done, 3);
  assert.equal(a.unknown.length, 1);
  assert.deepEqual(a.wrong.map((w) => `${w.x},${w.y}:${w.have}`).sort(), ["1,71:air", "2,70:cobblestone", "2,71:air", "3,70:air"]);
  assert.ok(a.wrong.every((w) => w.block === "stone_bricks"));
});

test("a finished plan audits clean, and a wall torch counts as a torch", () => {
  const p = plan(tower());
  const full = new Map(p.cells.map((c) => [k(c), c.block === "torch" ? "wall_torch" : c.block]));
  const a = audit(p, (q) => full.get(k(q)) ?? "air");
  assert.equal(a.done, p.cells.length);
  assert.deepEqual([a.wrong, a.unknown, remaining(p, (q) => full.get(k(q)) ?? "air")], [[], [], []]);
});

test("a resumed job keeps the plan's order", () => {
  const p = plan(gen(fencePerimeter(7, 5, "oak_fence", ["south"])));
  const built = new Set(p.cells.slice(0, 9).map(k));
  built.delete(k(p.cells[4])); // one of the early cells is missing again
  const nameAt = (q: { x: number; y: number; z: number }) => (built.has(k(q)) ? p.cells.find((c) => k(c) === k(q))!.block : "air");
  const left = remaining(p, nameAt);
  assert.equal(left.length, p.cells.length - 8);
  assert.deepEqual(left.map(k), p.cells.filter((c) => !built.has(k(c))).map(k));
  assert.equal(k(left[0]), k(p.cells[4]));
  // and an unloaded cell is still to do
  assert.equal(remaining(p, () => null).length, p.cells.length);
});
