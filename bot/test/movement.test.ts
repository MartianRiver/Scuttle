import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainLogName } from "../src/lib/movement";

test("plain logs pass, stripped logs and other wood do not", () => {
  for (const name of ["oak_log", "dark_oak_log", "pale_oak_log", "mangrove_log"]) assert.ok(isPlainLogName(name), name);
  for (const name of ["stripped_oak_log", "oak_wood", "oak_planks", "crimson_stem", "log", "oak_leaves"]) {
    assert.ok(!isPlainLogName(name), name);
  }
});
