import assert from "node:assert/strict";
import { test } from "node:test";
import { isFalling, isLiquid, isMade, madeBlocksNear, isNaturalStone, isStandHazard, safeToDig, standOk, type NameAt, type Pos } from "../src/behaviors/dig-safety";

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

// a hollow 5x5 hut, 4 high, floor at y, built from planks and cobblestone
function hut(cx: number, y: number, cz: number): Array<[Pos, string]> {
  const out: Array<[Pos, string]> = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      out.push([{ x: cx + dx, y, z: cz + dz }, "oak_planks"]);
      out.push([{ x: cx + dx, y: y + 4, z: cz + dz }, "oak_planks"]);
    }
  }
  return out;
}

test("a shaft under a house is refused, however deep, up to 12 blocks", () => {
  const w = grid(hut(10, 82, 10)); // roof 12 over the target at 70
  assert.equal(safeToDig(T, grid(hut(10, 78, 10))), false); // floor 8 over
  assert.equal(safeToDig(T, w), false); // floor 12 over
  assert.equal(safeToDig(T, grid(hut(10, 83, 10))), true); // floor 13 over
});

test("under a roof, a bridge or a hut's edge column counts; one block aside too, two does not", () => {
  const roof = (dx: number) => grid([[at(dx, 9, 0), "oak_slab"]]);
  assert.equal(safeToDig(T, roof(0)), false);
  assert.equal(safeToDig(T, roof(1)), false);
  assert.equal(safeToDig(T, roof(-1)), false);
  assert.equal(safeToDig(T, roof(2)), true);
});

test("a hut off to the side doesn't stop a dig more than 3 away and 1 off the column", () => {
  assert.equal(safeToDig(T, grid(hut(16, 70, 10))), true); // nearest wall at x 14
  assert.equal(safeToDig(T, grid(hut(16, 74, 10))), true);
  assert.equal(safeToDig(T, grid(hut(13, 70, 10))), false); // wall at x 11, inside the cube
});

test("mineshaft planks and rail next to a natural stone face stop the dig (accepted false positive)", () => {
  const shaft: Array<[Pos, string]> = [[at(2, 0, 0), "oak_planks"], [at(2, -1, 0), "rail"], [at(2, 1, 0), "oak_fence"]];
  assert.equal(safeToDig(T, grid(shaft)), false);
  // the same face dug from further along the wall, 4 blocks off, is fine
  assert.equal(safeToDig(at(0, 0, 4), grid(shaft)), true);
});

test("the wider made list", () => {
  const made = [
    "cobblestone_wall", "stone_brick_wall", "white_concrete", "oak_button", "stone_pressure_plate", "redstone_wire", "redstone_torch",
    "redstone_lamp", "repeater", "comparator", "observer", "piston", "dispenser", "hopper", "lever", "iron_bars", "white_terracotta",
    "tinted_glass", "red_stained_glass", "blue_stained_glass_pane", "lectern", "composter", "cauldron", "grindstone", "stonecutter",
    "smithing_table", "loom", "cartography_table", "fletching_table", "enchanting_table", "brewing_stand", "beacon",
    "stripped_oak_log", "stripped_birch_wood", "spruce_planks", "hay_block", "potted_oak_sapling", "red_banner", "white_wall_banner", "farmland",
  ];
  for (const name of made) assert.ok(isMade(name), name);
  const natural = [
    "oak_log", "oak_leaves", "dirt", "grass_block", "stone", "deepslate", "andesite", "coal_ore", "redstone_ore", "iron_ore", "diamond_ore",
    "sand", "gravel", "white_concrete_powder", "terracotta", "smooth_basalt", "amethyst_block", "oak_sapling", "air", "bedrock",
  ];
  for (const name of natural) assert.ok(!isMade(name), name);
});

test("allowMade lifts the made-block and under-a-build rules and nothing else", () => {
  const house = grid([[at(2, 0, 0), "oak_planks"], [at(0, 6, 0), "oak_slab"]]);
  assert.equal(safeToDig(T, house), false);
  assert.equal(safeToDig(T, house, undefined, { allowMade: true }), true);

  // lava beside the player-approved block still refuses
  const lava = grid([[at(1, 0, 0), "lava"], [at(2, 0, 0), "oak_planks"]]);
  assert.equal(safeToDig(T, lava, undefined, { allowMade: true }), false);
  // so do water, falling blocks over it, unloaded ground and a bad standing spot
  assert.equal(safeToDig(T, grid([[at(0, 1, 0), "water"]]), undefined, { allowMade: true }), false);
  assert.equal(safeToDig(T, grid([[at(0, 2, 0), "gravel"]]), undefined, { allowMade: true }), false);
  assert.equal(safeToDig(T, grid([], [at(0, 0, 1)]), undefined, { allowMade: true }), false);
  assert.equal(safeToDig(T, grid(), at(0, 1, 0), { allowMade: true }), false);
});

test("allowMade with a test approves only the blocks it names", () => {
  const w = grid([[at(2, 0, 0), "oak_planks"], [at(-2, 0, 0), "chest"]]);
  const onlyPlanks = (p: Pos) => p.x === T.x + 2;
  assert.equal(safeToDig(T, w, undefined, { allowMade: onlyPlanks }), false); // the chest still counts
  assert.equal(safeToDig(T, w, undefined, { allowMade: (p) => p.x === T.x + 2 || p.x === T.x - 2 }), true);
});

test("madeBlocksNear lists what makes safeToDig refuse: beside it and above in its column", () => {
  const w = grid([[at(2, 1, 0), "chest"], [at(0, 9, 1), "oak_planks"], [at(5, 0, 0), "chest"]]);
  assert.deepEqual(madeBlocksNear(T, w).map(key).sort(), [key(at(0, 9, 1)), key(at(2, 1, 0))].sort());
  assert.equal(madeBlocksNear(T, grid()).length, 0);
});
