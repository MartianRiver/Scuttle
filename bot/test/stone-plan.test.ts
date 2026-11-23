import assert from "node:assert/strict";
import { test } from "node:test";
import { canMineStone, KEEP_COBBLE, stashAmount, toolPlan } from "../src/behaviors/stone-plan";

const held = (o: Record<string, number>) => (name: string) => o[name] ?? 0;

test("any pickaxe that mines stone will do, nothing else", () => {
  assert.equal(canMineStone(held({})), false);
  assert.equal(canMineStone(held({ stick: 4, oak_planks: 12, wooden_axe: 1 })), false);
  for (const p of ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe"]) assert.equal(canMineStone(held({ [p]: 1 })), true, p);
});

test("stone tools are made only when none at stone level or better is held", () => {
  assert.deepEqual(toolPlan(held({ wooden_pickaxe: 1 })), { pickaxe: true, sword: true, sticks: 3, cobble: 5 });
  assert.deepEqual(toolPlan(held({ stone_pickaxe: 1 })), { pickaxe: false, sword: true, sticks: 1, cobble: 2 });
  assert.deepEqual(toolPlan(held({ iron_pickaxe: 1, stone_sword: 1 })), { pickaxe: false, sword: false, sticks: 0, cobble: 0 });
  assert.equal(toolPlan(held({ wooden_sword: 1 })).sword, true);
});

test("the stash gets all but the spare and what a tool still owed needs", () => {
  assert.equal(KEEP_COBBLE, 4);
  assert.equal(stashAmount(11, 0), 7);
  assert.equal(stashAmount(11, 5), 2);
  assert.equal(stashAmount(4, 0), 0);
  assert.equal(stashAmount(3, 0), 0);
});
