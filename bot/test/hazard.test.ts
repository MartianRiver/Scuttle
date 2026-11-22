import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, findCell, findEscape, type Cell, type Grid } from "../src/behaviors/hazard";

const air: Cell = { solid: false, fluid: null, fire: false };
const stone: Cell = { solid: true, fluid: null, fire: false };
const lava: Cell = { solid: false, fluid: "lava", fire: false };
const water: Cell = { solid: false, fluid: "water", fire: false };
const calm = { inLava: false, inFire: false, headInWater: false, feetInWater: false, oxygen: 20, burning: false };

// stone floor at y = 0, anything else is what the test puts in
const world = (cells: Record<string, Cell>): Grid => (x, y, z) => cells[`${x},${y},${z}`] ?? (y <= 0 ? stone : air);

test("what the body stands in decides the hazard, lava first", () => {
  assert.equal(classify(calm), null);
  assert.equal(classify({ ...calm, inLava: true, inFire: true }), "lava");
  assert.equal(classify({ ...calm, inFire: true }), "fire");
  assert.equal(classify({ ...calm, burning: true }), "burning");
});

test("drowning only once the air is low, wading and short dives are fine", () => {
  assert.equal(classify({ ...calm, headInWater: true, oxygen: 20 }), null);
  assert.equal(classify({ ...calm, headInWater: true, oxygen: 15 }), null);
  assert.equal(classify({ ...calm, headInWater: true, oxygen: 9 }), "drowning");
  assert.equal(classify({ ...calm, headInWater: false, oxygen: 3 }), null);
});

test("the way out of lava is the nearest dry floor, not the far one", () => {
  const g = world({ "0,1,0": lava, "1,1,0": lava, "2,1,0": lava, "-3,1,0": air });
  // lava from x 0 to 2 on a stone floor at y 0: the floor at -3 is nearer than the one at 3
  const target = findCell("lava", (x, y, z) => (y === 0 && x >= 0 && x <= 2 && z === 0 ? stone : g(x, y, z)), { x: 0.5, y: 1, z: 0.5 });
  assert.ok(target);
  assert.ok(target.x < 0 || target.x > 2, "not a lava cell");
});

test("a cell with lava under it is not somewhere to stand", () => {
  const g: Grid = (x, y, z) => (y === 0 ? (x === 1 ? { ...lava } : stone) : y === 1 ? air : air);
  const cell = findCell("lava", g, { x: 0.5, y: 1, z: 0.5 }, 3);
  assert.ok(cell && cell.x !== 1);
});

test("burning heads for water and nothing else", () => {
  const g = world({ "4,1,0": water });
  assert.deepEqual(findCell("burning", g, { x: 0, y: 1, z: 0 }), { x: 4, y: 1, z: 0 });
  assert.equal(findCell("burning", world({}), { x: 0, y: 1, z: 0 }), null);
});

test("drowning heads up to dry land, through the water above", () => {
  const cells: Record<string, Cell> = {};
  for (let y = 1; y <= 5; y++) cells[`0,${y},0`] = water;
  const g = world(cells);
  const target = findCell("drowning", g, { x: 0, y: 1, z: 0 }, 4);
  assert.ok(target && !(target.x === 0 && target.z === 0), "standing room beside the pool");
});

test("a rescue from the water goes on until the body is out, not just until it has air", () => {
  const afloat = { ...calm, headInWater: false, feetInWater: true, oxygen: 20 };
  assert.equal(classify(afloat, null), null);
  assert.equal(classify(afloat, "drowning"), "drowning");
  assert.equal(classify({ ...afloat, feetInWater: false }, "drowning"), null);
});

test("out of fire, water within reach wins over dry floor, else dry floor", () => {
  const withPool = world({ "3,1,0": water });
  assert.deepEqual(findEscape("fire", withPool, { x: 0, y: 1, z: 0 }), { x: 3, y: 1, z: 0 });
  const dry = findEscape("lava", world({}), { x: 0, y: 1, z: 0 });
  assert.ok(dry && dry.y === 1);
});
