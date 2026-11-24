import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pos } from "../src/behaviors/dig-safety";
import {
  canMineCoal, canMineIron, coalToMine, furnaceUsable, fuelFor, ironPlan, isCandidate, rawToMine, smeltWaitMs, stashCoalAmount, toSmelt, xrayMode,
  type Cell, type CellAt,
} from "../src/behaviors/ore-plan";

const held = (o: Record<string, number>) => (name: string) => o[name] ?? 0;

test("coal breaks with any pickaxe, iron ore needs stone or better", () => {
  assert.equal(canMineCoal(held({})), false);
  assert.equal(canMineIron(held({})), false);
  assert.equal(canMineIron(held({ stick: 4, stone_axe: 1 })), false);
  for (const p of ["wooden_pickaxe", "golden_pickaxe"]) {
    assert.equal(canMineCoal(held({ [p]: 1 })), true, p);
    assert.equal(canMineIron(held({ [p]: 1 })), false, p);
  }
  for (const p of ["stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"]) {
    assert.equal(canMineCoal(held({ [p]: 1 })), true, p);
    assert.equal(canMineIron(held({ [p]: 1 })), true, p);
  }
});

test("iron tools are made only when none at iron level or better is held", () => {
  assert.deepEqual(ironPlan(held({ stone_pickaxe: 1 })), { pickaxe: true, sword: true, ingots: 5 });
  assert.deepEqual(ironPlan(held({ stone_pickaxe: 1, iron_sword: 1 })), { pickaxe: true, sword: false, ingots: 3 });
  assert.deepEqual(ironPlan(held({ iron_pickaxe: 1 })), { pickaxe: false, sword: true, ingots: 2 });
  assert.deepEqual(ironPlan(held({ diamond_pickaxe: 1, netherite_sword: 1 })), { pickaxe: false, sword: false, ingots: 0 });
  assert.equal(ironPlan(held({ stone_sword: 1 })).sword, true);
});

test("coal and raw iron are topped up to what is wanted, never past", () => {
  assert.equal(coalToMine(0), 8);
  assert.equal(coalToMine(5), 3);
  assert.equal(coalToMine(8), 0);
  assert.equal(coalToMine(20), 0);
  const plan = ironPlan(held({ stone_pickaxe: 1 }));
  assert.equal(rawToMine(plan, 0, 0), 5);
  assert.equal(rawToMine(plan, 2, 1), 2);
  assert.equal(rawToMine(plan, 3, 4), 0);
});

test("smelting covers what the tools lack in ingots, as far as the raw iron goes", () => {
  const plan = ironPlan(held({ stone_pickaxe: 1 }));
  assert.equal(toSmelt(plan, 0, 5), 5);
  assert.equal(toSmelt(plan, 0, 3), 3);
  assert.equal(toSmelt(plan, 2, 5), 3);
  assert.equal(toSmelt(plan, 5, 5), 0);
  assert.equal(toSmelt(plan, 0, 0), 0);
});

test("fuel, the stash and the wait follow the numbers of the game", () => {
  assert.equal(fuelFor(1), 1);
  assert.equal(fuelFor(5), 1);
  assert.equal(fuelFor(8), 1);
  assert.equal(fuelFor(9), 2);
  assert.equal(stashCoalAmount(8), 4);
  assert.equal(stashCoalAmount(4), 0);
  assert.equal(stashCoalAmount(2), 0);
  assert.equal(smeltWaitMs(5), 65_000);
});

test("a furnace is used only when empty, or stocked with coal alone", () => {
  const free = { input: null, fuel: null, output: null };
  assert.equal(furnaceUsable(free), true);
  assert.equal(furnaceUsable({ ...free, fuel: "coal" }), true);
  assert.equal(furnaceUsable({ ...free, fuel: "oak_planks" }), false);
  assert.equal(furnaceUsable({ ...free, fuel: "charcoal" }), false);
  assert.equal(furnaceUsable({ ...free, input: "beef" }), false);
  assert.equal(furnaceUsable({ ...free, output: "iron_ingot" }), false);
});

// a block of stone with the listed cells put in it; unlisted cells are solid, ones in `gone` unloaded
const T: Pos = { x: 5, y: 40, z: 5 };
const key = (p: Pos) => `${p.x},${p.y},${p.z}`;
function cells(put: Array<[Pos, Cell]> = [], gone: Pos[] = []): CellAt {
  const m = new Map(put.map(([p, c]) => [key(p), c]));
  const off = new Set(gone.map(key));
  return (p) => (off.has(key(p)) ? null : (m.get(key(p)) ?? "solid"));
}
const at = (dx: number, dy: number, dz: number): Pos => ({ x: T.x + dx, y: T.y + dy, z: T.z + dz });

test("ore buried in rock is not a candidate; one with a face in the open is", () => {
  assert.equal(isCandidate(T, cells(), false), false);
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    assert.equal(isCandidate(T, cells([[at(dx, dy, dz), "air"]]), false), true, `air at ${dx},${dy},${dz}`);
  }
});

test("a diagonal gap, liquid or unloaded ground does not expose ore", () => {
  assert.equal(isCandidate(T, cells([[at(1, 1, 0), "air"]]), false), false);
  assert.equal(isCandidate(T, cells([[at(1, 0, 0), "liquid"]]), false), false);
  assert.equal(isCandidate(T, cells([], [at(0, 1, 0)]), false), false);
});

test("with xray on, buried ore is a candidate too", () => {
  assert.equal(isCandidate(T, cells(), true), true);
  assert.equal(isCandidate(T, cells([[at(1, 0, 0), "liquid"]]), true), true);
});

test("xray is read only when started with --testworld", () => {
  assert.equal(xrayMode(["node", "x", "--testworld"], { SCUTTLE_XRAY: "1" }), "on");
  assert.equal(xrayMode(["node", "x", "--live"], { SCUTTLE_XRAY: "1" }), "ignored");
  assert.equal(xrayMode(["node", "x"], { SCUTTLE_XRAY: "1" }), "ignored");
  assert.equal(xrayMode(["node", "x", "--testworld"], {}), "off");
  assert.equal(xrayMode(["node", "x", "--testworld"], { SCUTTLE_XRAY: "0" }), "off");
  assert.equal(xrayMode(["node", "x", "--testworld"], { SCUTTLE_XRAY: "true" }), "off");
});
