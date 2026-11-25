import assert from "node:assert/strict";
import { test } from "node:test";
import { endFields } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import {
  clearRadius, endWords, inBox, isGroundPlant, nextTree, packNearlyFull, pickLeaves, rankGot, stashPlan, stopWhy, survey, sweepList, timeWords, wantedDrop, MAX_MS,
  type Box, type Drop, type Tally,
} from "../src/behaviors/clear-plan";
import { buildIntent } from "../src/mcp/skills";

const box: Box = { x: 0, y: 68, z: 0, r: 9 };
const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

// ---- the square ----

test("the radius is a whole number from 3 to 16 and defaults to 9", () => {
  assert.equal(clearRadius(undefined), 9);
  assert.equal(clearRadius(1), 3);
  assert.equal(clearRadius(40), 16);
  assert.equal(clearRadius(12), 12);
});

test("a cell is in the square by its sides and its height, and a margin widens only the sides", () => {
  assert.ok(inBox(box, { x: 9, y: 68, z: -9 }));
  assert.ok(!inBox(box, { x: 10, y: 68, z: 0 }));
  assert.ok(inBox(box, { x: 12, y: 68, z: 0 }, 3));
  assert.ok(!inBox(box, { x: 0, y: 40, z: 0 }), "far under the table is not the site");
  assert.ok(!inBox(box, { x: 0, y: 95, z: 0 }), "nor is the sky");
});

test("survey: whole trunks in the square are inside, edge trees stay, logs that are no tree are counted", () => {
  const columns = (b: { x: number; y: number; z: number }) => (b.x === 9 && b.z === 9 ? [b, { ...b, x: 10 }, { ...b, z: 10 }, { ...b, x: 10, z: 10 }] : [b]);
  const picked = [{ x: 2, y: 68, z: 2 }, { x: 12, y: 68, z: 0 }, { x: 9, y: 68, z: 9 }, { x: 40, y: 68, z: 0 }];
  const bases = [...picked, { x: -5, y: 68, z: -5 }, { x: -5, y: 68, z: -5 }, { x: 30, y: 68, z: 0 }];
  const s = survey(box, picked, bases, columns);
  assert.deepEqual(s.inside.map((t) => t.base), [{ x: 2, y: 68, z: 2 }]);
  assert.equal(s.edge, 2, "the tree 3 out and the thick trunk with a column out; the one 40 away is not at the edge");
  assert.equal(s.notNatural, 1, "a post counted once, a log far outside not at all");
});

test("a thick trunk's other columns are not counted as separate logs that are no tree", () => {
  const columns = (b: { x: number; y: number; z: number }) => (b.x === 0 ? [b, { ...b, x: 1 }] : [b]);
  const s = survey(box, [], [{ x: 0, y: 68, z: 0 }, { x: 1, y: 68, z: 0 }], columns);
  assert.equal(s.notNatural, 1);
});

test("the next tree is the nearest to the body, ties by position, and does not change the list", () => {
  const trees = [{ base: { x: 5, y: 68, z: 0 } }, { base: { x: -2, y: 68, z: 1 } }, { base: { x: 2, y: 68, z: 1 } }];
  assert.deepEqual(nextTree(trees, { x: 0, y: 68, z: 0 })?.base, { x: -2, y: 68, z: 1 });
  assert.deepEqual(nextTree(trees, { x: 6, y: 68, z: 0 })?.base, { x: 5, y: 68, z: 0 });
  assert.equal(trees.length, 3);
  assert.equal(nextTree([], { x: 0, y: 0, z: 0 }), undefined);
});

// ---- drops ----

test("what is wanted off the ground is what a tree gives: logs, saplings, apples, sticks", () => {
  for (const n of ["oak_log", "birch_sapling", "cherry_sapling", "mangrove_propagule", "apple", "stick"]) assert.ok(wantedDrop(n), n);
  for (const n of ["stripped_oak_log", "diamond", "golden_apple", "oak_planks", "cobblestone"]) assert.ok(!wantedDrop(n), n);
});

test("the sweep list: in the square and its ring, wanted, not tried to death, not on a canopy, nearest first", () => {
  const d = (id: number, x: number, y: number, z: number, name: string | undefined = "oak_log"): Drop => ({ id, name, pos: { x, y, z } });
  const drops = [d(1, 12, 68, 0), d(2, 14, 68, 0), d(3, 1, 68, 0), d(4, 2, 68, 0, "diamond"), d(5, 3, 80, 0), d(6, 0, 68, 5, "apple"), d(7, 4, 68, 0, undefined)];
  const tries = new Map([[1, 2]]);
  const ids = sweepList(drops, box, { x: 0, y: 68, z: 0 }, tries).map((x) => x.id);
  assert.deepEqual(ids, [3, 7, 6], "1 is out of tries, 2 is past the ring, 4 is not wanted, 5 is far up");
});

// ---- leaves ----

test("leaves of a felled tree go, except those a standing log claims and cells that are not leaves", () => {
  const columns = [{ x: 0, y: 68, z: 0 }];
  const leaves = new Set(["0,71,0", "1,71,1", "3,71,0", "-3,71,-3", "0,69,0", "4,71,0", "6,72,0"]);
  const leafAt = (p: { x: number; y: number; z: number }) => leaves.has(`${p.x},${p.y},${p.z}`);
  const stands = new Set(["5,68,0"]);
  const logAt = (p: { x: number; y: number; z: number }) => stands.has(`${p.x},${p.y},${p.z}`);
  const got = pickLeaves(columns, leafAt, logAt).map((p) => `${p.x},${p.y},${p.z}`).sort();
  // 4,71,0 is within 4 sideways of the column (out of its reach); 3,71,0 is 2 from the standing log at 5; 6,72,0 is out too
  assert.deepEqual(got, ["-3,71,-3", "0,69,0", "0,71,0", "1,71,1"].sort());
});

// ---- the ground ----

test("small plants are flowers, mushrooms, saplings and the like; grass, ferns and logs are not", () => {
  for (const n of ["poppy", "dandelion", "red_tulip", "sunflower", "rose_bush", "lilac", "peony", "brown_mushroom", "oak_sapling", "sweet_berry_bush", "leaf_litter", "pink_petals", "wildflowers"]) assert.ok(isGroundPlant(n), n);
  for (const n of ["short_grass", "tall_grass", "fern", "oak_log", "oak_leaves", "wither_rose", "dirt", "potted_poppy", "flower_pot"]) assert.ok(!isGroundPlant(n), n);
});

// ---- the pack ----

test("the pack is nearly full at two free slots or fewer", () => {
  assert.ok(packNearlyFull(2));
  assert.ok(!packNearlyFull(3));
});

test("the stash plan takes every log and stick, spare saplings and apples past a day's, and nothing else", () => {
  const plan = stashPlan({ oak_log: 30, birch_log: 3, stick: 8, oak_sapling: 9, birch_sapling: 3, apple: 20, bread: 30, wooden_axe: 1, stripped_oak_log: 5, cobblestone: 64 });
  assert.deepEqual(plan, [
    { item: "oak_log", count: 30 },
    { item: "stick", count: 8 },
    { item: "oak_sapling", count: 5 },
    { item: "apple", count: 4 },
    { item: "birch_log", count: 3 },
  ]);
});

// ---- stopping ----

test("stopping: the server undoing digs, three trees in a row that gave nothing, the clock; otherwise carry on", () => {
  assert.equal(stopWhy({ elapsedMs: 0, stuckInARow: 0, undone: 0 }), null);
  assert.equal(stopWhy({ elapsedMs: 1000, stuckInARow: 2, undone: 2 }), null);
  assert.equal(stopWhy({ elapsedMs: 0, stuckInARow: 0, undone: 3 }), "protected");
  assert.equal(stopWhy({ elapsedMs: 0, stuckInARow: 3, undone: 0 }), "stuck");
  assert.equal(stopWhy({ elapsedMs: MAX_MS, stuckInARow: 0, undone: 0 }), "time");
});

// ---- the words ----

test("rankGot keeps a kind of log, then the saplings, apples and sticks, before a second log or the rest", () => {
  const got = rankGot({ oak_log: 40, birch_log: 12, oak_sapling: 2, birch_sapling: 1, apple: 1, stick: 9, poppy: 30 });
  assert.deepEqual(Object.keys(got), ["oak_log", "oak_sapling", "birch_sapling", "apple"]);
  assert.deepEqual(rankGot({ poppy: 3 }), { poppy: 3 });
  assert.deepEqual(rankGot({ oak_log: 0 }), {});
});

test("time in words, no digit", () => {
  assert.equal(timeWords(20_000), "under a minute");
  assert.equal(timeWords(60_000), "about a minute");
  assert.equal(timeWords(3 * 60_000 + 10_000), "about three minutes");
});

const tally = (o: Partial<Tally> = {}): Tally => ({ felled: 6, edge: 2, notNatural: 0, refused: 1, unreachable: 0, tall: 0, plants: 12, ms: 190_000, ...o });

test("the end words say trees, plants, what was left and the time", () => {
  assert.equal(endWords(tally()), "felled six trees, cleared twelve plants, left two at the edge, one refused; about three minutes");
  assert.equal(endWords(tally({ felled: 0, edge: 0, refused: 0, plants: 0, ms: 5000 })), "felled none; under a minute");
  assert.equal(endWords(tally({ felled: 1, edge: 0, refused: 0, plants: 1, ended: "ran out of time" })), "felled one tree, cleared one plant; ran out of time; about three minutes");
});

test("the end words never carry a digit and always fit a detail, whatever the counts", () => {
  const full = tally({ felled: 99, edge: 99, notNatural: 99, refused: 99, unreachable: 99, tall: 99, plants: 150, ms: 20 * 60_000, ended: "three trees in a row would not come down" });
  for (const t of [full, tally(), tally({ felled: 32, tall: 4 })]) {
    const w = endWords(t);
    assert.ok(w.length <= 120, `${w.length}: ${w}`);
    assert.ok(!/\d/.test(w), w);
    assert.equal(endFields({ detail: w }).detail, w, "survives the way out unchanged");
    assert.ok(/^felled /.test(w) && /minute/.test(w));
  }
});

// ---- the wire ----

test("parseFrame: clear_trees takes a whole radius from 3 to 16 and nothing else", () => {
  assert.ok(ok({ intent: "clear_trees" }));
  assert.ok(ok({ intent: "clear_trees", radius: 3 }));
  assert.ok(ok({ intent: "clear_trees", radius: 16 }));
  assert.ok(!ok({ intent: "clear_trees", radius: 2 }));
  assert.ok(!ok({ intent: "clear_trees", radius: 17 }));
  assert.ok(!ok({ intent: "clear_trees", radius: 9.5 }));
  assert.ok(!ok({ intent: "clear_trees", radius: "9" }));
  assert.ok(!ok({ intent: "clear_trees", x: 1 }));
  assert.ok(!ok({ intent: "clear_trees", center: "home" }));
});

test("act clear_trees: radius goes through, nothing else does", () => {
  assert.deepEqual(buildIntent("clear_trees", {}), { ok: true, fields: { intent: "clear_trees" } });
  assert.deepEqual(buildIntent("clear_trees", { radius: 12 }), { ok: true, fields: { intent: "clear_trees", radius: 12 } });
  assert.equal(buildIntent("clear_trees", { radius: 40 }).ok, false);
  assert.equal(buildIntent("clear_trees", { radius: 2 }).ok, false);
  assert.equal(buildIntent("clear_trees", { dir: "north" }).ok, false);
  assert.equal(buildIntent("tunnel", { radius: 5 }).ok, false);
});
