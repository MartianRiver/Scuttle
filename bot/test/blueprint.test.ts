import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS, DIRS, MAX_PROBLEMS, PALETTE_ALLOWLIST, faceTo, mirror, parseBlueprint, rotate, type Blueprint } from "../src/build/blueprint";

const good = () => ({
  name: "corner",
  size: { x: 3, y: 2, z: 2 },
  palette: { a: "cobblestone", t: "torch" },
  cells: [
    { x: 0, y: 0, z: 0, p: "a" },
    { x: 1, y: 0, z: 0, p: "a" },
    { x: 2, y: 0, z: 0, p: "a" },
    { x: 0, y: 0, z: 1, p: "a" },
    { x: 0, y: 1, z: 0, p: "t" },
  ],
});

function value(input: unknown): Blueprint {
  const r = parseBlueprint(input);
  assert.ok(r.ok, r.ok ? "" : r.problems.join("; "));
  return r.value;
}
const problems = (input: unknown, limits = DEFAULT_LIMITS): string[] => {
  const r = parseBlueprint(input, limits);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.problems;
};
const sorted = (bp: Blueprint) => [...bp.cells].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.p.localeCompare(b.p));
const same = (a: Blueprint, b: Blueprint) => assert.deepEqual({ ...a, cells: sorted(a) }, { ...b, cells: sorted(b) });

test("a good blueprint parses and keeps its facing", () => {
  const bp = value({ ...good(), facing: "east" });
  assert.equal(bp.cells.length, 5);
  assert.equal(bp.facing, "east");
  assert.equal(value(good()).facing, undefined);
});

test("bad input comes back as words, never a throw", () => {
  for (const junk of [null, undefined, 4, "x", [], [good()], {}, { ...good(), cells: null }, { ...good(), cells: [{ x: 1 }] }, { ...good(), cells: [null, 3, []] }, { ...good(), palette: [] }, { ...good(), size: 5 }]) {
    const p = problems(junk);
    assert.ok(p.length > 0 && p.every((s) => typeof s === "string" && s.length > 0));
  }
});

test("a palette block must be on the allowlist", () => {
  for (const block of ["tnt", "air", "minecraft:stone", "oak_slab", "oak_stairs", "lava", "chest", "wall_torch", 5, null]) {
    const p = problems({ ...good(), palette: { a: block } });
    assert.match(p.join(" "), /not a block Scuttle builds with/);
  }
  assert.ok(PALETTE_ALLOWLIST.includes("stone_bricks") && !PALETTE_ALLOWLIST.includes("air") && !PALETTE_ALLOWLIST.includes("nether_brick_fence"));
});

test("palette keys are short and cannot reach the prototype", () => {
  assert.ok(problems({ ...good(), palette: { a: "stone", constructor: "stone" } }).length > 0);
  assert.ok(problems({ ...good(), palette: { a: "stone", "bad key": "stone" } }).length > 0);
  assert.ok(problems({ ...good(), palette: {} }).length > 0);
});

test("cells: unknown palette key, outside the size, duplicate, not whole numbers", () => {
  const withCell = (cell: unknown) => ({ ...good(), cells: [cell] });
  assert.match(problems(withCell({ x: 0, y: 0, z: 0, p: "zz" })).join(), /not a palette key/);
  assert.match(problems(withCell({ x: 3, y: 0, z: 0, p: "a" })).join(), /inside the size/);
  assert.match(problems(withCell({ x: -1, y: 0, z: 0, p: "a" })).join(), /inside the size/);
  assert.match(problems(withCell({ x: 0.5, y: 0, z: 0, p: "a" })).join(), /whole number/);
  assert.match(problems(withCell({ x: "0", y: 0, z: 0, p: "a" })).join(), /whole number/);
  assert.match(problems(withCell({ x: 0, y: 0, z: 0 })).join(), /not a palette key/);
  const dup = { ...good(), cells: [{ x: 0, y: 0, z: 0, p: "a" }, { x: 0, y: 0, z: 0, p: "t" }] };
  assert.match(problems(dup).join(), /already filled/);
});

test("size and cell caps", () => {
  assert.match(problems({ ...good(), size: { x: 33, y: 1, z: 1 } }).join(), /size\.x/);
  assert.match(problems({ ...good(), size: { x: 0, y: 1, z: 1 } }).join(), /size\.x/);
  assert.match(problems({ ...good(), size: { x: 1.5, y: 1, z: 1 } }).join(), /size\.x/);
  const big = { ...good(), size: { x: 32, y: 32, z: 32 }, cells: Array.from({ length: 5000 }, (_, i) => ({ x: i % 32, y: Math.floor(i / 32) % 32, z: 0, p: "a" })) };
  assert.match(problems(big).join(), /5000 cells/);
  assert.match(problems(good(), { maxSize: 2, maxCells: 4096 }).join(), /size\.x/);
  assert.match(problems(good(), { maxSize: 32, maxCells: 3 }).join(), /5 cells/);
  assert.ok(parseBlueprint({ ...good(), size: { x: 32, y: 32, z: 32 } }).ok);
});

test("unknown keys are refused and world positions are named", () => {
  assert.match(problems({ ...good(), extra: 1 }).join(), /unknown key "extra"/);
  assert.match(problems({ ...good(), origin: { x: 1, y: 2, z: 3 } }).join(), /world position/);
  assert.match(problems({ ...good(), pos: [1, 2, 3] }).join(), /world position/);
  assert.match(problems({ ...good(), size: { x: 3, y: 2, z: 2, w: 1 } }).join(), /size: unknown key "w"/);
  assert.match(problems({ ...good(), cells: [{ x: 0, y: 0, z: 0, p: "a", f: "north" }] }).join(), /cell 0: unknown key "f"/);
  assert.match(problems({ ...good(), cells: [{ x: 120, y: 64, z: -300, p: "a" }] }).join(), /inside the size/);
});

test("name and facing are checked", () => {
  assert.ok(problems({ ...good(), name: "" }).length > 0);
  assert.ok(problems({ ...good(), name: "a/../b" }).length > 0);
  assert.match(problems({ ...good(), facing: "up" }).join(), /facing/);
});

test("the problem list is capped", () => {
  const cells = Array.from({ length: 100 }, () => ({ x: 9, y: 9, z: 9, p: "?" }));
  assert.ok(problems({ ...good(), cells }).length <= MAX_PROBLEMS);
});

test("every allowlisted name is a block and an item in 26.3", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const md = require("minecraft-data")("26.3");
  for (const n of PALETTE_ALLOWLIST) {
    assert.ok(md.blocksByName[n], `${n} is not a block`);
    assert.ok(md.itemsByName[n], `${n} is not an item`);
  }
});

test("one clockwise turn takes the north edge to the east edge", () => {
  const bp = value({ name: "n", size: { x: 3, y: 1, z: 2 }, palette: { a: "stone" }, cells: [{ x: 1, y: 0, z: 0, p: "a" }], facing: "north" });
  const r = rotate(bp, 1);
  assert.deepEqual(r.size, { x: 2, y: 1, z: 3 });
  assert.deepEqual(r.cells, [{ x: 1, y: 0, z: 1, p: "a" }]);
  assert.equal(r.facing, "east");
  assert.deepEqual(rotate(bp, 2).cells, [{ x: 1, y: 0, z: 1, p: "a" }]);
  assert.deepEqual(rotate(bp, 2).size, bp.size);
});

test("four turns are the identity on an asymmetric, non-square shape", () => {
  const bp = value({ ...good(), facing: "south" });
  let r = bp;
  const seen: Blueprint[] = [];
  for (let i = 0; i < 4; i++) {
    r = rotate(r, 1);
    seen.push(r);
  }
  same(r, bp);
  for (const mid of seen.slice(0, 3)) assert.notDeepEqual(sorted(mid), sorted(bp));
  assert.deepEqual(seen[0].size, { x: 2, y: 2, z: 3 });
  same(rotate(bp, 4), bp);
  same(rotate(bp, -1), seen[2]);
  assert.deepEqual(new Set(seen.map((s) => s.facing)), new Set(["west", "north", "east", "south"]));
});

test("mirror twice is the identity, and once flips left and right", () => {
  const bp = value({ ...good(), facing: "east" });
  same(mirror(mirror(bp)), bp);
  const m = mirror(bp);
  assert.ok(m.cells.some((c) => c.x === 2 && c.z === 1 && c.p === "a"));
  assert.equal(m.facing, "west");
  assert.deepEqual(m.size, bp.size);
});

test("every cell stays inside the size after any turn or mirror", () => {
  const bp = value(good());
  for (let t = 0; t < 4; t++) for (const b of [rotate(bp, t), mirror(rotate(bp, t))]) {
    for (const c of b.cells) assert.ok(c.x >= 0 && c.x < b.size.x && c.y >= 0 && c.y < b.size.y && c.z >= 0 && c.z < b.size.z);
    assert.equal(new Set(b.cells.map((c) => `${c.x},${c.y},${c.z}`)).size, b.cells.length);
  }
});

test("faceTo turns from the blueprint's own facing, north when it has none", () => {
  const bp = value(good());
  assert.equal(faceTo(bp, "north").facing, "north");
  same(faceTo(bp, "north"), { ...bp, facing: "north" });
  same(faceTo(bp, "east"), { ...rotate(bp, 1), facing: "east" });
  const south = value({ ...good(), facing: "south" });
  same(faceTo(south, "west"), { ...rotate(south, 1), facing: "west" });
  for (const d of DIRS) assert.equal(faceTo(faceTo(bp, d), "north").size.x, bp.size.x);
});
