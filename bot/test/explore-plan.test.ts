import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aimPoint, arrived, blockedWords, budgetMs, EDGE, kindsIn, legTo, LEASH, mergeKinds, noKinds, sawWords, tooFar,
} from "../src/behaviors/explore-plan";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("a compass point and a band lead to a point inside the band, north being -z", () => {
  const e = aimPoint({ x: 100, z: 100 }, "east");
  assert.ok(near(e.x, 100 + EDGE["a short walk"] - 2) && near(e.z, 100));
  const n = aimPoint({ x: 0, z: 0 }, "north", "near");
  assert.ok(near(n.x, 0) && near(n.z, -14));
  const ne = aimPoint({ x: 0, z: 0 }, "north-east", "far");
  assert.ok(near(Math.hypot(ne.x, ne.z), 126) && ne.x > 0 && ne.z < 0);
});

test("past 160 blocks from home is too far", () => {
  const home = { x: 4, z: -28 };
  assert.equal(tooFar({ x: 4 + LEASH, z: -28 }, home), false);
  assert.equal(tooFar({ x: 4 + LEASH + 1, z: -28 }, home), true);
  assert.equal(tooFar(aimPoint({ x: 60, z: 60 }, "east", "far"), home), true); // 60 + 126 east and 88 south of home
  assert.equal(tooFar(aimPoint({ x: 40, z: 60 }, "east"), home), false);
});

test("legs: toward the goal, at most one leg, turned for a detour", () => {
  const goal = { x: 100, z: 0 };
  const a = legTo({ x: 0, z: 0 }, goal);
  assert.ok(near(a.x, 14) && near(a.z, 0));
  const close = legTo({ x: 95, z: 0 }, goal);
  assert.ok(near(close.x, 100)); // never past the goal
  const b = legTo({ x: 0, z: 0 }, goal, 90); // a quarter turn: +x becomes +z
  assert.ok(near(b.x, 0) && near(b.z, 14));
  assert.ok(arrived({ x: 98, z: 1 }, goal) && !arrived({ x: 90, z: 0 }, goal));
});

test("the time it gets grows with the band and is capped", () => {
  assert.ok(budgetMs("near") < budgetMs("a short walk") && budgetMs("a short walk") < budgetMs("far"));
  assert.ok(budgetMs("far") <= 6 * 60_000);
});

test("what stopped a walk, in words with no number", () => {
  assert.equal(blockedWords("north", ["open", "wall", "wall"]), "a cliff to the north");
  assert.equal(blockedWords("east", ["water", "water", "water", "water"]), "the sea to the east");
  assert.equal(blockedWords("east", ["open", "water", "open"]), "water to the east");
  assert.equal(blockedWords("south-west", ["lava"]), "lava to the south-west");
  assert.equal(blockedWords("west", ["drop"]), "a drop to the west");
  assert.equal(blockedWords("west", ["open", "open"]), "no way through to the west");
  for (const a of ["wall", "water", "lava", "drop", "open"] as const) assert.ok(!/\d/.test(blockedWords("north-east", [a])));
});

test("the kinds in a look, and only the new ones are told", () => {
  const home = kindsIn({ blocks: [{ what: "oak_log" }, { what: "chest" }], near: [] });
  assert.equal(home.trees, true);
  const out = kindsIn({
    blocks: [{ what: "oak_log" }, { what: "coal_ore" }, { what: "coal_ore" }, { what: "water" }, { what: "oak_door" }, { what: "oak_trapdoor" }, { what: "stripped_oak_log" }],
    near: [{ k: "player" }, {}],
    stone: "close north",
  });
  assert.deepEqual(out, { trees: true, stone: true, ores: ["coal ore"], water: true, lava: false, doors: true, players: true });
  assert.equal(sawWords(home, mergeKinds(home, out)), "stone, coal ore, water, doors, players");
  assert.equal(sawWords(home, home), "");
  assert.equal(sawWords(noKinds(), noKinds()), "");
  assert.ok(!/\d/.test(sawWords(noKinds(), kindsIn({ blocks: [{ what: "iron_ore" }], near: [] }))));
});
