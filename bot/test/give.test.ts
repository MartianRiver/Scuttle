import assert from "node:assert/strict";
import { test } from "node:test";
import { keptSlot, planToss, type Stack } from "../src/behaviors/give-plan";

const s = (name: string, count: number, slot: number): Stack => ({ name, count, slot });

test("throws the count asked for from the fullest stack, leaving the rest", () => {
  assert.deepEqual(planToss([s("oak_log", 20, 10)], "oak_log", 12, null), [{ slot: 10, count: 12 }]);
});

test("no count means everything it holds, capped at 64", () => {
  assert.deepEqual(planToss([s("oak_log", 20, 10)], "oak_log", undefined, null), [{ slot: 10, count: 20 }]);
  const many = [s("cobblestone", 64, 9), s("cobblestone", 64, 10), s("cobblestone", 30, 11)];
  const plan = planToss(many, "cobblestone", undefined, null);
  assert.equal(plan.reduce((n, t) => n + t.count, 0), 64);
});

test("spreads over stacks, whole stacks first", () => {
  const stacks = [s("oak_log", 5, 9), s("oak_log", 30, 12), s("oak_log", 10, 40)];
  assert.deepEqual(planToss(stacks, "oak_log", 38, null), [
    { slot: 12, count: 30 },
    { slot: 40, count: 8 },
  ]);
});

test("asking for more than it holds gives what it holds", () => {
  assert.deepEqual(planToss([s("oak_log", 3, 9), s("oak_log", 4, 10)], "oak_log", 50, null), [
    { slot: 10, count: 4 },
    { slot: 9, count: 3 },
  ]);
});

test("nothing of that item, or nothing asked, is an empty plan", () => {
  assert.deepEqual(planToss([s("oak_log", 20, 10)], "diamond", 5, null), []);
  assert.deepEqual(planToss([], "oak_log", undefined, null), []);
  assert.deepEqual(planToss([s("oak_log", 20, 10)], "oak_log", 0, null), []);
});

test("only held gear is kept: stackable goods in the hand are fair to give", () => {
  assert.equal(keptSlot({ slot: 36, stackSize: 1 }), 36); // a sword
  assert.equal(keptSlot({ slot: 36, stackSize: 64 }), null); // logs picked up into the selected slot
  assert.equal(keptSlot({ slot: 36, stackSize: 16 }), null);
  assert.equal(keptSlot(null), null);
  assert.equal(keptSlot(undefined), null);
});

test("never throws the kept stack: its only sword stays", () => {
  assert.deepEqual(planToss([s("iron_sword", 1, 36)], "iron_sword", 1, 36), []);
  assert.deepEqual(planToss([s("iron_sword", 1, 36)], "iron_sword", undefined, 36), []);
});

test("a kept stack of the same item stays; only the other stacks go", () => {
  const stacks = [s("oak_log", 64, 36), s("oak_log", 8, 12)];
  assert.deepEqual(planToss(stacks, "oak_log", 30, 36), [{ slot: 12, count: 8 }]);
  assert.deepEqual(planToss(stacks, "oak_log", undefined, 36), [{ slot: 12, count: 8 }]);
});

test("a spare sword in another slot can go, the kept one cannot", () => {
  const stacks = [s("iron_sword", 1, 36), s("iron_sword", 1, 20)];
  assert.deepEqual(planToss(stacks, "iron_sword", 2, 36), [{ slot: 20, count: 1 }]);
});

test("with nothing kept, a hotbar stack is as free as any", () => {
  assert.deepEqual(planToss([s("oak_log", 10, 37)], "oak_log", 4, null), [{ slot: 37, count: 4 }]);
});

test("does not touch the input", () => {
  const stacks = [s("oak_log", 5, 9), s("oak_log", 30, 12)];
  planToss(stacks, "oak_log", 10, null);
  assert.deepEqual(stacks, [s("oak_log", 5, 9), s("oak_log", 30, 12)]);
});
