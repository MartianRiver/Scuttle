import assert from "node:assert/strict";
import { test } from "node:test";
import { collectKind, sameKindRun, toolWords, trunkLogs } from "../src/behaviors/harvest-plan";

const grid = (cells: Record<string, string>) => (p: { x: number; y: number; z: number }) => cells[`${p.x},${p.y},${p.z}`] ?? "air";
const column = (x: number, z: number, y0: number, y1: number, name = "oak_log") =>
  Object.fromEntries(Array.from({ length: y1 - y0 + 1 }, (_, i) => [`${x},${y0 + i},${z}`, name]));

test("collect takes natural kinds only", () => {
  assert.equal(collectKind("oak_log"), "log");
  assert.equal(collectKind("stripped_oak_log"), null);
  assert.equal(collectKind("stone"), "stone");
  assert.equal(collectKind("iron_ore"), "ore");
  assert.equal(collectKind("deepslate_coal_ore"), "ore");
  assert.equal(collectKind("gravel"), "soft");
  for (const made of ["cobblestone", "oak_planks", "chest", "crafting_table", "furnace", "glass", "stone_bricks", "oak_door"]) {
    assert.equal(collectKind(made), null, made);
  }
});

test("the tool a block asks for, in words", () => {
  const all = ["wooden_pickaxe", "golden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
  assert.equal(toolWords(all), "a pickaxe");
  assert.equal(toolWords(all.slice(2)), "a stone pickaxe or better");
  assert.equal(toolWords(all.slice(3)), "an iron pickaxe or better");
  assert.equal(toolWords(["diamond_pickaxe", "netherite_pickaxe"]), "a diamond pickaxe or better");
  assert.equal(toolWords(undefined), null);
  assert.equal(toolWords([]), null);
});

test("a tree is its trunk from the base up and nothing that stands against it", () => {
  const world = grid({ ...column(10, 10, 68, 72), ...column(12, 10, 68, 70), ...column(13, 10, 68, 70, "stripped_oak_log") });
  const logs = trunkLogs({ x: 10, y: 70, z: 10 }, world); // pointed at from the middle of the trunk: the base is found
  assert.equal(logs.length, 5);
  assert.deepEqual(logs[0], { x: 10, y: 68, z: 10 });
  assert.ok(logs.every((p) => p.x === 10 && p.z === 10));
});

test("a 2 by 2 trunk is one tree", () => {
  const world = grid({ ...column(5, 5, 68, 71), ...column(6, 5, 68, 71), ...column(5, 6, 68, 70), ...column(6, 6, 68, 71) });
  const logs = trunkLogs({ x: 5, y: 68, z: 5 }, world);
  assert.equal(logs.length, 15);
  assert.equal(new Set(logs.map((p) => `${p.x},${p.z}`)).size, 4);
});

test("a cabin wall touching the trunk is not part of it", () => {
  const wall = Object.assign({}, ...[6, 7, 8].map((x) => column(x, 5, 68, 70))); // a row of posts beside the trunk
  const world = grid({ ...column(5, 5, 68, 72), ...wall });
  assert.equal(trunkLogs({ x: 5, y: 68, z: 5 }, world).length, 5);
});

test("a run of the same block: the one pointed at first, no more than asked, only the same kind", () => {
  const world = grid({ "0,0,0": "stone", "1,0,0": "stone", "2,0,0": "stone", "0,1,0": "stone", "0,0,1": "granite", "9,0,0": "stone" });
  assert.deepEqual(sameKindRun({ x: 0, y: 0, z: 0 }, world, 1), [{ x: 0, y: 0, z: 0 }]);
  const three = sameKindRun({ x: 0, y: 0, z: 0 }, world, 3);
  assert.equal(three.length, 3);
  assert.deepEqual(three[0], { x: 0, y: 0, z: 0 });
  const all = sameKindRun({ x: 0, y: 0, z: 0 }, world, 16);
  assert.equal(all.length, 4); // not the granite, not the stone nine blocks away
  assert.deepEqual(sameKindRun({ x: 0, y: 0, z: 0 }, () => null, 3), []);
});
