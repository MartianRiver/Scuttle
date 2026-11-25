import { test } from "node:test";
import assert from "node:assert/strict";
import { dropOf, type Loot } from "../src/behaviors/block-drop";

const loot: Record<string, string[]> = {
  stone: ["cobblestone"],
  deepslate: ["cobbled_deepslate"],
  grass_block: ["dirt"],
  dirt: ["dirt"],
  gravel: ["flint", "gravel"],
  coal_ore: ["coal"],
  weird: ["a", "b"],
};
const lookup: Loot = (b) => loot[b] ?? null;

test("with a loot table a block is what it drops, or itself when it can drop itself", () => {
  assert.equal(dropOf("stone", lookup), "cobblestone");
  assert.equal(dropOf("deepslate", lookup), "cobbled_deepslate");
  assert.equal(dropOf("grass_block", lookup), "dirt");
  assert.equal(dropOf("dirt", lookup), "dirt");
  assert.equal(dropOf("gravel", lookup), "gravel");
  assert.equal(dropOf("coal_ore", lookup), "coal");
  assert.equal(dropOf("weird", lookup), "weird", "several drops and none its own: no replacement is claimed");
});

test("without one the short table answers, and a block not on it is itself", () => {
  assert.equal(dropOf("stone"), "cobblestone");
  assert.equal(dropOf("deepslate"), "cobbled_deepslate");
  assert.equal(dropOf("grass_block"), "dirt");
  assert.equal(dropOf("netherrack"), "netherrack");
  assert.equal(dropOf("oak_planks", () => null), "oak_planks");
});
