import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, driftBudget, findCell, findEscape, findLanding, pathSafe, type Cell, type Grid } from "../src/behaviors/hazard";

const air: Cell = { solid: false, fluid: null, fire: false };
const stone: Cell = { solid: true, fluid: null, fire: false };
const lava: Cell = { solid: false, fluid: "lava", fire: false };
const water: Cell = { solid: false, fluid: "water", fire: false };
const fire: Cell = { solid: false, fluid: null, fire: true };
const cobweb: Cell = { solid: false, fluid: null, fire: false, soft: true };
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

// a trench one wide and `deep` down at x = 1, the floor at y 0 everywhere else
const trench = (deep: number, extra: Record<string, Cell> = {}): Grid => (x, y, z) => {
  const k = `${x},${y},${z}`;
  if (k in extra) return extra[k];
  if (x === 1) return y <= -deep ? stone : air;
  return y <= 0 ? stone : air;
};

test("a straight walk across a deep trench is not safe, across a shallow one it is", () => {
  assert.equal(pathSafe(trench(8), { x: 0.5, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0 }), false);
  assert.equal(pathSafe(trench(3), { x: 0.5, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0 }), true);
  assert.equal(pathSafe(trench(8), { x: 0.5, y: 1, z: 0.5 }, { x: -3, y: 1, z: 0 }), true);
});

test("water or a cobweb at the bottom makes a deep drop safe, lava under a step does not", () => {
  assert.equal(pathSafe(trench(8, { "1,-7,0": water }), { x: 0.5, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0 }), true);
  assert.equal(pathSafe(trench(8, { "1,-7,0": cobweb }), { x: 0.5, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0 }), true);
  assert.equal(pathSafe(world({ "1,0,0": lava }), { x: 0.5, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0 }), false);
});

test("steps up and down are followed, a wall ends the check", () => {
  // one block up at x 2, then a drop of 3 back down at x 4: all walkable
  const g = world({ "2,1,0": stone, "3,1,0": stone });
  assert.equal(pathSafe(g, { x: 0.5, y: 1, z: 0.5 }, { x: 5, y: 1, z: 0 }), true);
  const wall = trench(8, { "1,1,0": stone, "1,2,0": stone, "1,3,0": stone });
  assert.equal(pathSafe(wall, { x: 0.5, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0 }), true);
});

test("out of fire, water across a deep trench loses to dry floor on the near side", () => {
  // fire under the body, water across the trench at x 2, dry floor behind at x -1
  const g = trench(8, { "0,1,0": fire, "2,1,0": water });
  const out = findEscape("fire", g, { x: 0.5, y: 1, z: 0.5 });
  assert.ok(out);
  assert.ok(out.x <= 0, `stays on the near side, got ${JSON.stringify(out)}`);
  // without the trench the water wins
  assert.deepEqual(findEscape("fire", world({ "0,1,0": fire, "2,1,0": water }), { x: 0.5, y: 1, z: 0.5 }), { x: 2, y: 1, z: 0 });
});

test("out of lava a drop is better than staying when it is the only way", () => {
  // a lava pool from x -3 to 0 walled at -4, the only floor beyond a deep trench at x 1
  const g: Grid = (x, y, z) => {
    if (x === 1) return y <= -8 ? stone : air;
    if (x >= -3 && x <= 0 && y === 1) return lava;
    if (x <= -4) return stone;
    return y <= 0 ? stone : air;
  };
  assert.ok(findEscape("lava", g, { x: 0.5, y: 1, z: 0.5 }));
});

test("the drift budget grows with the height of the fall", () => {
  assert.ok(driftBudget(10, 0) > 1.5 && driftBudget(10, 0) < 2.5);
  assert.ok(driftBudget(20, 0) > 3 && driftBudget(20, 0) < 4);
  assert.ok(driftBudget(20, -1) < driftBudget(20, 0), "already falling fast leaves less time");
});

// open air over a stone floor at y 0, the body falling at height `h`
const sky = (extra: Record<string, Cell> = {}): Grid => (x, y, z) => extra[`${x},${y},${z}`] ?? (y <= 0 ? stone : air);

test("a hurtful fall steers to water in reach, not to water out of reach", () => {
  const pool = { "2,0,0": water };
  assert.deepEqual(findLanding(sky(pool), { x: 0.5, y: 16, z: 0.5 }, 0, 0), { x: 2, y: 1, z: 0 });
  assert.equal(findLanding(sky({ "5,0,0": water }), { x: 0.5, y: 6, z: 0.5 }, 0, -0.5), null);
});

test("a harmless fall or one already over water is left alone", () => {
  assert.equal(findLanding(sky({ "1,0,0": water }), { x: 0.5, y: 3.5, z: 0.5 }, 0, 0), null);
  assert.equal(findLanding(sky({ "0,0,0": water, "1,0,0": water }), { x: 0.5, y: 16, z: 0.5 }, 0, 0), null);
  // what has already been fallen counts: 2 blocks to go after 5 fallen is a 7-block fall
  const edge = { x: 0.99, y: 3, z: 0.5 };
  assert.equal(findLanding(sky({ "1,0,0": water }), edge, 0, -0.8), null);
  assert.deepEqual(findLanding(sky({ "1,0,0": water }), edge, 5, -0.8), { x: 1, y: 1, z: 0 });
});

test("the nearest soft landing wins, cobwebs count", () => {
  const g = sky({ "1,0,0": cobweb, "3,0,0": water });
  assert.deepEqual(findLanding(g, { x: 0.5, y: 16, z: 0.5 }, 0, 0), { x: 1, y: 1, z: 0 });
});
