import assert from "node:assert/strict";
import { test } from "node:test";
import { craftsFor, describe, pickRecipe, shortOf, type Counts, type RecipeLite } from "../src/behaviors/craft-plan";

const WOODS = ["poplar", "cherry", "oak", "birch"];
const planksRecipes = (makes: number, per: number, extra: Counts = {}, table = false): RecipeLite[] =>
  WOODS.map((w) => ({ table, makes, needs: { [`${w}_planks`]: per, ...extra } }));
const held = (c: Counts) => (n: string) => c[n] ?? 0;

const TABLE = planksRecipes(1, 4);
const PICK = planksRecipes(1, 3, { stick: 2 }, true);
const STONE_PICK: RecipeLite[] = ["cobbled_deepslate", "blackstone", "cobblestone"].map((m) => ({ table: true, makes: 1, needs: { [m]: 3, stick: 2 } }));

test("crafts round up to whole batches", () => {
  assert.equal(craftsFor(16, 4), 4);
  assert.equal(craftsFor(5, 4), 2);
  assert.equal(craftsFor(1, 1), 1);
});

test("a recipe the held items cover wins, whatever its place in the registry", () => {
  const pick = pickRecipe(TABLE, held({ birch_planks: 6 }), 1)!;
  assert.equal(pick.fits, true);
  assert.deepEqual(pick.recipe.needs, { birch_planks: 4 });
  // three batches need 12, which six do not cover, so it does not fit
  assert.equal(pickRecipe(TABLE, held({ birch_planks: 6 }), 3)!.fits, false);
  assert.equal(pickRecipe(TABLE, held({ birch_planks: 12 }), 3)!.fits, true);
});

test("a recipe needing no table comes before one that does", () => {
  const rs: RecipeLite[] = [{ table: true, makes: 1, needs: { coal: 1 } }, { table: false, makes: 1, needs: { coal: 1 } }];
  assert.equal(pickRecipe(rs, held({ coal: 1 }), 1)!.recipe.table, false);
});

test("nothing fits: the least short is told, then the plain materials", () => {
  const some = pickRecipe(TABLE, held({ cherry_planks: 2 }), 1)!;
  assert.equal(some.fits, false);
  assert.deepEqual(some.recipe.needs, { cherry_planks: 4 });
  const none = pickRecipe(TABLE, held({}), 1)!;
  assert.deepEqual(none.recipe.needs, { oak_planks: 4 }); // not poplar, which the registry lists first
  const stone = pickRecipe(STONE_PICK, held({ stick: 2 }), 1)!;
  assert.deepEqual(stone.recipe.needs, { cobblestone: 3, stick: 2 }); // not cobbled_deepslate
  assert.equal(pickRecipe([], held({}), 1), null);
});

test("crafting_table: any planks named plainly when nothing fits", () => {
  const a = describe("crafting_table", pickRecipe(TABLE, held({}), 1)!, held({}), 0);
  assert.deepEqual(a, { item: "crafting_table", makes: 1, needs: { planks: 4 }, table: false, have: { planks: 0 }, missing: { planks: 4 } });
  const b = describe("crafting_table", pickRecipe(TABLE, held({ cherry_planks: 3 }), 1)!, held({ cherry_planks: 3 }), 3);
  assert.deepEqual(b.missing, { planks: 1 });
  assert.deepEqual(b.have, { planks: 3 });
});

test("a recipe that fits is told with the kind it fits on", () => {
  const h = held({ birch_planks: 4, stick: 2 });
  const a = describe("wooden_pickaxe", pickRecipe(PICK, h, 1)!, h, 4);
  assert.deepEqual(a.needs, { birch_planks: 3, stick: 2 });
  assert.deepEqual(a.missing, {});
  assert.equal(a.table, true);
});

test("stone_pickaxe says what is missing", () => {
  const h = held({ stick: 1, cobblestone: 1 });
  const a = describe("stone_pickaxe", pickRecipe(STONE_PICK, h, 1)!, h, 0);
  assert.deepEqual(a.needs, { cobblestone: 3, stick: 2 });
  assert.deepEqual(a.missing, { cobblestone: 2, stick: 1 });
});

test("missing for several batches scales the need", () => {
  const h = held({ oak_log: 1 });
  const rs: RecipeLite[] = [{ table: false, makes: 4, needs: { oak_log: 1 } }];
  const a = describe("oak_planks", pickRecipe(rs, h, 4)!, h, 0, 4);
  assert.deepEqual(a.missing, { oak_log: 3 });
  assert.deepEqual(shortOf(rs[0], h, 4), { oak_log: 3 });
});
