import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseFood, noFoodStep, planRestock, restockable, shouldEat, type Carried, type FoodTable } from "../src/behaviors/food";

// the registry's numbers for the foods used here
const table: FoodTable = {
  bread: { points: 5, saturation: 6 },
  cookie: { points: 2, saturation: 0.4 },
  apple: { points: 4, saturation: 2.4 },
  cooked_beef: { points: 8, saturation: 12.8 },
  cooked_porkchop: { points: 8, saturation: 12.8 },
  baked_potato: { points: 5, saturation: 6 },
  beef: { points: 3, saturation: 1.8 },
  rotten_flesh: { points: 4, saturation: 0.8 },
  spider_eye: { points: 2, saturation: 3.2 },
  poisonous_potato: { points: 2, saturation: 1.2 },
  pufferfish: { points: 1, saturation: 0.2 },
  pufferfish_bucket: { points: 1, saturation: 0.2 },
  salmon_bucket: { points: 2, saturation: 0.4 },
  chicken: { points: 2, saturation: 1.2 },
  suspicious_stew: { points: 6, saturation: 7.2 },
  chorus_fruit: { points: 4, saturation: 2.4 },
  golden_apple: { points: 4, saturation: 9.6 },
  enchanted_golden_apple: { points: 4, saturation: 9.6 },
};
const have = (...names: string[]): Carried[] => names.map((name) => ({ name, count: 1 }));

test("prefers the smallest food that still fills most of the gap", () => {
  // gap 6: cookie (2) is too little, bread (5) and cooked beef (8) both fill it, bread wastes less
  assert.equal(chooseFood(have("cooked_beef", "bread", "cookie"), table, 14, 20), "bread");
  // gap 6: apple (4 of 6) still counts as most of it, and is the smaller
  assert.equal(chooseFood(have("bread", "apple"), table, 14, 20), "apple");
});

test("when nothing fills most of the gap it takes the biggest, saturation breaking ties", () => {
  assert.equal(chooseFood(have("cookie", "bread", "beef"), table, 2, 20), "bread");
  assert.equal(chooseFood(have("bread", "cooked_beef"), table, 2, 20), "cooked_beef");
});

test("overshoot: with only big food it takes the smallest of it", () => {
  assert.equal(chooseFood(have("cooked_beef", "cooked_porkchop"), table, 17, 15), "cooked_beef");
  assert.equal(chooseFood(have("cooked_beef", "bread"), table, 17, 15), "bread");
});

test("ties go to the higher saturation", () => {
  const t: FoodTable = { a: { points: 5, saturation: 1 }, b: { points: 5, saturation: 6 } };
  assert.equal(chooseFood(have("a", "b"), t, 14, 20), "b");
});

test("harmful foods are never chosen, whatever the hunger", () => {
  const bad = have("spider_eye", "poisonous_potato", "pufferfish", "chicken", "suspicious_stew", "chorus_fruit");
  for (const food of [0, 3, 6, 10, 14]) assert.equal(chooseFood(bad, table, food, 4), null);
  assert.equal(chooseFood([...bad, ...have("cookie")], table, 6, 20), "cookie");
});

test("fish buckets are in the registry as food but are not food", () => {
  assert.equal(chooseFood(have("pufferfish_bucket", "salmon_bucket"), table, 3, 20), null);
  assert.equal(restockable("salmon_bucket", table), false);
});

test("rotten flesh: 6 or below and nothing else, not at 7", () => {
  assert.equal(chooseFood(have("rotten_flesh"), table, 6, 20), "rotten_flesh");
  assert.equal(chooseFood(have("rotten_flesh"), table, 7, 20), null);
  assert.equal(chooseFood(have("rotten_flesh", "cookie"), table, 3, 20), "cookie");
  assert.equal(chooseFood([{ name: "rotten_flesh", count: 0 }], table, 3, 20), null);
});

test("golden apples only when hurt, or starving", () => {
  assert.equal(chooseFood(have("golden_apple"), table, 10, 20), null);
  assert.equal(chooseFood(have("golden_apple"), table, 10, 11), null);
  assert.equal(chooseFood(have("golden_apple"), table, 10, 10), "golden_apple");
  assert.equal(chooseFood(have("golden_apple", "bread"), table, 10, 10), "bread");
  assert.equal(chooseFood(have("enchanted_golden_apple"), table, 4, 20), "enchanted_golden_apple");
});

test("only rotten flesh and a golden apple at full health: the apple beats the flesh once starving", () => {
  assert.equal(chooseFood(have("rotten_flesh", "golden_apple"), table, 10, 20), null);
  assert.equal(chooseFood(have("rotten_flesh", "golden_apple"), table, 5, 20), "golden_apple");
});

test("shouldEat: hungry below 15, or hurt and below 18", () => {
  assert.equal(shouldEat(14, 20), true);
  assert.equal(shouldEat(15, 20), false);
  assert.equal(shouldEat(17, 19), true);
  assert.equal(shouldEat(18, 19), false);
  assert.equal(shouldEat(17, 20), false);
});

test("restock takes the best food first and stops near 40 points", () => {
  const chest: Carried[] = [{ name: "bread", count: 20 }, { name: "cooked_beef", count: 3 }, { name: "rotten_flesh", count: 9 }, { name: "spider_eye", count: 4 }];
  assert.deepEqual(planRestock([], chest, table), [{ name: "cooked_beef", count: 3 }, { name: "bread", count: 4 }]);
});

test("restock counts what is carried, and never takes rotten flesh, golden apples or buckets", () => {
  const chest: Carried[] = [{ name: "rotten_flesh", count: 9 }, { name: "golden_apple", count: 2 }, { name: "salmon_bucket", count: 1 }, { name: "cookie", count: 3 }];
  assert.deepEqual(planRestock(have("rotten_flesh"), chest, table), [{ name: "cookie", count: 3 }]);
  assert.deepEqual(planRestock([{ name: "bread", count: 8 }], [{ name: "bread", count: 5 }], table), []);
  assert.deepEqual(planRestock([{ name: "bread", count: 6 }], [{ name: "bread", count: 5 }], table), [{ name: "bread", count: 2 }]);
});

test("restock caps the item count and merges split stacks", () => {
  assert.deepEqual(planRestock([], [{ name: "cookie", count: 64 }], table), [{ name: "cookie", count: 16 }]);
  assert.deepEqual(planRestock([], [{ name: "bread", count: 3 }, { name: "bread", count: 2 }], table), [{ name: "bread", count: 5 }]);
});

test("no_food: once per episode, cleared by being able to eat or by food coming back up", () => {
  assert.deepEqual(noFoodStep(false, 12, false), { emit: true, next: true });
  assert.deepEqual(noFoodStep(true, 11, false), { emit: false, next: true });
  assert.deepEqual(noFoodStep(true, 11, true), { emit: false, next: false });
  assert.deepEqual(noFoodStep(true, 15, false), { emit: false, next: false });
  assert.deepEqual(noFoodStep(false, 15, false), { emit: false, next: false });
  // a second episode after the first ended reports again
  assert.deepEqual(noFoodStep(false, 14, false), { emit: true, next: true });
});
