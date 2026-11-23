import assert from "node:assert/strict";
import { test } from "node:test";
import { isFalling, isLiquid, isMade, isNaturalStone, isStandHazard, safeToDig, standOk, type NameAt, type Pos } from "../src/behaviors/dig-safety";

const T: Pos = { x: 10, y: 70, z: 10 };
const key = (p: Pos) => `${p.x},${p.y},${p.z}`;

// a world of stone with whatever is listed put into it; `unloaded` cells read as null
function grid(put: Array<[Pos, string]> = [], unloaded: Pos[] = []): NameAt {
  const m = new Map(put.map(([p, n]) => [key(p), n]));
  const gone = new Set(unloaded.map(key));
  return (p) => (gone.has(key(p)) ? null : (m.get(key(p)) ?? "stone"));
}
const at = (dx: number, dy: number, dz: number): Pos => ({ x: T.x + dx, y: T.y + dy, z: T.z + dz });

test("plain stone is fine to dig", () => {
  assert.equal(safeToDig(T, grid()), true);
  assert.equal(safeToDig(T, grid([[at(1, 0, 0), "air"], [at(0, 1, 0), "air"], [at(0, 2, 0), "air"]])), true);
});

test("lava or water in any of the six neighbours stops it", () => {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    for (const liquid of ["lava", "water", "flowing_lava", "flowing_water"]) {
      assert.equal(safeToDig(T, grid([[at(dx, dy, dz), liquid]])), false, `${liquid} at ${dx},${dy},${dz}`);
    }
  }
});

test("lava behind the target, one cell further, is not a neighbour", () => {
  assert.equal(safeToDig(T, grid([[at(2, 0, 0), "lava"]])), true);
  assert.equal(safeToDig(T, grid([[at(1, 1, 0), "lava"]])), true); // diagonal
});

test("gravel, sand or a falling block over the target stops it, one or two up", () => {
  for (const name of ["gravel", "sand", "red_sand", "white_concrete_powder", "anvil"]) {
    assert.equal(safeToDig(T, grid([[at(0, 1, 0), name]])), false, `${name} above`);
    assert.equal(safeToDig(T, grid([[at(0, 2, 0), name]])), false, `${name} two above`);
  }
  assert.equal(safeToDig(T, grid([[at(0, 3, 0), "gravel"]])), true);
  assert.equal(safeToDig(T, grid([[at(0, -1, 0), "gravel"]])), true); // under it falls nowhere
});

test("anything a player makes within 3 blocks stops it, 4 is far enough", () => {
  for (const name of ["torch", "wall_torch", "oak_planks", "crafting_table", "furnace", "chest", "glass", "oak_door", "red_bed", "oak_fence", "oak_stairs", "stone_slab", "white_wool", "stone_bricks", "cobblestone", "mossy_cobblestone"]) {
    assert.equal(safeToDig(T, grid([[at(3, 0, 0), name]])), false, name);
  }
  assert.equal(safeToDig(T, grid([[at(-3, 3, 3), "torch"]])), false); // the corner of the cube
  assert.equal(safeToDig(T, grid([[at(4, 0, 0), "torch"]])), true);
  assert.equal(safeToDig(T, grid([[at(0, -4, 0), "crafting_table"]])), true);
});

test("a block the world has not loaded is not known to be safe, further out it doesn't matter", () => {
  assert.equal(safeToDig(T, grid([], [at(0, 0, 1)])), false);
  assert.equal(safeToDig(T, grid([], [at(0, 2, 0)])), false);
  assert.equal(safeToDig(T, grid([], [at(3, 3, 3)])), true);
});

test("the standing spot is beside the target at its level or one under, never in its column", () => {
  const w = grid();
  assert.equal(safeToDig(T, w, at(1, 0, 0)), true);
  assert.equal(safeToDig(T, w, at(0, -1, 1)), true); // target at the head
  assert.equal(safeToDig(T, w, at(2, 0, 1)), true);
  assert.equal(safeToDig(T, w, at(0, 1, 0)), false); // standing on it: digging down
  assert.equal(safeToDig(T, w, at(0, -1, 0)), false); // standing under it: digging up
  assert.equal(safeToDig(T, w, at(1, 1, 0)), false); // target would be the floor
  assert.equal(safeToDig(T, w, at(1, -2, 0)), false); // target would be the roof
  assert.equal(safeToDig(T, w, at(3, 0, 0)), false); // out of reach
  assert.equal(standOk(T, at(1, 0, 0)), true);
});

test("name helpers", () => {
  assert.ok(isNaturalStone("stone") && isNaturalStone("granite"));
  assert.ok(!isNaturalStone("cobblestone") && !isNaturalStone("deepslate") && !isNaturalStone("stone_bricks"));
  assert.ok(isLiquid("lava") && !isLiquid("lava_cauldron") && !isLiquid("stone"));
  assert.ok(isFalling("sand") && !isFalling("sandstone"));
  assert.ok(!isMade("stone") && !isMade("bedrock") && !isMade("oak_log") && !isMade("dirt") && !isMade("coal_ore"));
  assert.ok(isStandHazard("water") && isStandHazard("fire") && isStandHazard("magma_block") && !isStandHazard("air"));
});
