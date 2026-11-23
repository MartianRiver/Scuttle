import assert from "node:assert/strict";
import { test } from "node:test";
import { endFields } from "../src/api/events";
import { findBank, waypoint } from "../src/behaviors/bank";
import type { Cell, Grid } from "../src/behaviors/hazard";
import { NoDigMap } from "../src/behaviors/no-dig";
import { MIN_GAP_MS, PERIOD_MS, ProgressGate } from "../src/behaviors/progress";
import { FORGET_REFUSED_MS, nearestRefused, nothingToDig, REFUSED_RADIUS, undoneWords } from "../src/behaviors/refused";
import { gained } from "../src/behaviors/run-report";
import { activityWords, stuckWords } from "../src/behaviors/stuck";
import { nearNaturalLeaves } from "../src/lib/movement";
import { standingIn } from "../src/senses/standing";
import { baseLog, pickTrees, type TreeProbe } from "../src/senses/trees";

// ---- trees ----

type Names = Record<string, string>; // "x,y,z" -> block name; anything else is air
const at = (names: Names) => (p: { x: number; y: number; z: number }) => names[`${p.x},${p.y},${p.z}`] ?? "air";
const column = (x: number, z: number, y0: number, y1: number, name = "oak_log"): Names => {
  const out: Names = {};
  for (let y = y0; y <= y1; y++) out[`${x},${y},${z}`] = name;
  return out;
};
// leaves around the top of a trunk
const crown = (x: number, z: number, y: number, persistent: boolean): Names => {
  const out: Names = {};
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) out[`${x + dx},${y},${z + dz}`] = persistent ? "oak_leaves[persistent]" : "oak_leaves";
  return out;
};
const probeOf = (names: Names, visible: (p: { x: number; y: number; z: number }) => boolean = () => true): TreeProbe => ({
  nameAt: (p) => at(names)(p),
  naturalLeafAt: (p) => at(names)(p) === "oak_leaves",
  visible,
});

test("baseLog walks down to the lowest log of the column", () => {
  const names = column(5, 5, 68, 72);
  assert.deepEqual(baseLog({ x: 5, y: 71, z: 5 }, at(names)), { x: 5, y: 68, z: 5 });
  assert.deepEqual(baseLog({ x: 5, y: 68, z: 5 }, at(names)), { x: 5, y: 68, z: 5 });
  // a stripped log under it is not part of the tree
  const odd = { ...column(5, 5, 69, 72), "5,68,5": "stripped_oak_log" };
  assert.deepEqual(baseLog({ x: 5, y: 72, z: 5 }, at(odd)), { x: 5, y: 69, z: 5 });
});

test("nearNaturalLeaves: natural leaves above or beside, none far off", () => {
  const near = (dx: number, dy: number, dz: number) => dx === 2 && dy === 4 && dz === -1;
  assert.ok(nearNaturalLeaves(near));
  assert.ok(!nearNaturalLeaves((dx, dy, dz) => dy === 7 || dx === 4 || dy === -2));
});

test("pickTrees: a grown tree is listed once on its base, a cabin and a tree under placed leaves are not", () => {
  const names: Names = {
    ...column(10, 0, 68, 72), // a tree
    ...crown(10, 0, 71, false),
    ...column(10, 0, 68, 72), // (the crown overwrote nothing: leaves only at y 71 off the trunk cell)
    ...column(0, 8, 68, 72), // a bare trunk under persistent leaves: placed
    ...crown(0, 8, 71, true),
    ...column(-9, 0, 68, 70, "stripped_oak_log"), // stripped
  };
  names["10,71,0"] = "oak_log"; // the trunk goes through its own crown
  names["0,71,8"] = "oak_log";
  // every log of everything, nearest first as findBlocks would give them
  const logs = Object.entries(names)
    .filter(([, n]) => n === "oak_log")
    .map(([k]) => {
      const [x, y, z] = k.split(",").map(Number);
      return { x, y, z };
    })
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const picked = pickTrees(logs, probeOf(names));
  assert.deepEqual(picked, [{ x: 10, y: 68, z: 0 }]);
});

test("pickTrees: nearest three, a thick trunk is one tree, what the eye does not reach is left out, the test count is capped", () => {
  const names: Names = {};
  const trees = [[4, 0], [8, 0], [12, 0], [16, 0]];
  for (const [x, z] of trees) Object.assign(names, column(x, z, 68, 71), crown(x, z, 70, false), { [`${x},70,${z}`]: "oak_log" });
  // a 2 by 2 trunk is one tree
  Object.assign(names, column(0, 10, 68, 71), column(1, 10, 68, 71), column(0, 11, 68, 71), column(1, 11, 68, 71), crown(0, 10, 70, false));
  for (const [x, z] of [[0, 10], [1, 10], [0, 11], [1, 11]]) names[`${x},70,${z}`] = "oak_log";
  const logs = Object.entries(names)
    .filter(([, n]) => n === "oak_log")
    .map(([k]) => {
      const [x, y, z] = k.split(",").map(Number);
      return { x, y, z };
    })
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const all = pickTrees(logs, probeOf(names), 10);
  assert.equal(all.length, 5, "four single trunks and one thick one");
  assert.equal(pickTrees(logs, probeOf(names)).length, 3, "three by default");
  const hidden = pickTrees(logs, probeOf(names, (p) => p.x !== 4), 10);
  assert.ok(!hidden.some((p) => p.x === 4 && p.z === 0), "the one behind a wall is not listed");
  let tests = 0;
  const counting = probeOf(names, () => (tests++, false));
  assert.deepEqual(pickTrees(logs, counting, 3, 2), []);
  assert.ok(tests <= 2);
});

// ---- standing ----

test("standingIn: dry, wet feet, head under, lava", () => {
  assert.equal(standingIn("air", "air"), undefined);
  assert.equal(standingIn("grass_block", "air"), undefined);
  assert.equal(standingIn("water", "air"), "water");
  assert.equal(standingIn("water", "water"), "deep_water");
  assert.equal(standingIn("bubble_column", "water"), "deep_water");
  assert.equal(standingIn("seagrass", "air"), "water");
  assert.equal(standingIn("lava", "air"), "lava");
  assert.equal(standingIn("lava", "water"), "lava");
  assert.equal(standingIn(null, "air"), undefined, "unloaded is not known");
});

// ---- the way out of the water ----

// a world of cells by name: "s" solid, "w" water, "." air; each row of a layer is z, each char x
function grid(layers: Record<number, string[]>): Grid {
  return (x, y, z): Cell => {
    const row = layers[y]?.[z];
    const c = row?.[x];
    if (c === undefined) return y <= Math.min(...Object.keys(layers).map(Number)) ? { solid: true, fluid: null, fire: false } : { solid: false, fluid: null, fire: false };
    return { solid: c === "s", fluid: c === "w" ? "water" : null, fire: false };
  };
}

test("findBank: the nearest shore by swimming, flush or one step up, and the way to it", () => {
  // a pool 3 deep, the bank flush with the surface on the left, 2 high water to the right
  const pool = grid({
    64: ["swwwwwwwwwwwww", "swwwwwwwwwwwww", "swwwwwwwwwwwww"],
    65: ["swwwwwwwwwwwww", "swwwwwwwwwwwww", "swwwwwwwwwwwww"],
    66: ["swwwwwwwwwwwww", "swwwwwwwwwwwww", "swwwwwwwwwwwww"],
    67: ["..............", "..............", ".............."],
  });
  // floor at 63 is solid by default (below the lowest layer)
  const r = findBank(pool, { x: 10.5, y: 65, z: 1.5 });
  assert.ok(r, "a bank is found");
  assert.deepEqual(r!.bank, { x: 0, y: 67, z: 1 }, "the flush bank at x 0 (a block that is solid at the water's level)");
  assert.ok(r!.path.length >= 10 && r!.path.length < 20);
  assert.deepEqual(r!.path.at(-1), r!.bank);
  // heading: the first cell more than a block away sideways
  const w = waypoint(r!, { x: 10.5, y: 65, z: 1.5 });
  assert.ok(Math.abs(w.x + 0.5 - 10.5) > 1.2 || Math.abs(w.z + 0.5 - 1.5) > 1.2);
  assert.deepEqual(waypoint(r!, { x: 0.9, y: 66, z: 1.5 }), r!.bank, "next to the bank it is the bank");
});

test("findBank: not in water, a walled pit, and a shore beyond the radius all give nothing", () => {
  const dry = grid({ 66: ["...", "...", "..."] });
  assert.equal(findBank(dry, { x: 1.5, y: 67, z: 1.5 }), null);
  // a pit of water one deep with walls 3 high: nothing to stand on beside the water
  const walls = ["sssss", "sswss", "sssss"];
  const pit = grid({ 64: walls, 65: ["sssss", "sswss", "sssss"], 66: ["sssss", "sssss", "sssss"], 67: ["sssss", "sssss", "sssss"], 68: ["sssss", "sssss", "sssss"] });
  assert.equal(findBank(pit, { x: 2.5, y: 65, z: 1.5 }), null);
  const lake = grid({ 65: [".".repeat(0) + "w".repeat(60), "w".repeat(60)], 66: ["w".repeat(60), "w".repeat(60)], 67: ["w".repeat(60), "w".repeat(60)] });
  assert.equal(findBank(lake, { x: 30.5, y: 66, z: 0.5 }, 10), null, "a bank 30 away is out of a radius of 10");
});

test("findBank: a ledge one step above the water counts, two does not", () => {
  // water at 65 and 66 on the right, a block of land at 67 on the left (a ledge one up from the surface)
  const ledge1 = grid({
    65: ["swww", "swww"],
    66: ["swww", "swww"],
    67: ["s...", "s..."], // the left column is solid at 67: the standing cell is at 68
    68: ["....", "...."],
  });
  const r = findBank(ledge1, { x: 3.5, y: 66, z: 0.5 });
  assert.deepEqual(r?.bank, { x: 0, y: 68, z: 0 });
  const ledge2 = grid({
    65: ["swww", "swww"],
    66: ["swww", "swww"],
    67: ["ss..", "ss.."],
    68: ["ss..", "ss.."], // two high above the water: no bank
    69: ["....", "...."],
  });
  assert.equal(findBank(ledge2, { x: 3.5, y: 66, z: 0.5 }), null);
});

// ---- refused places ----

test("a refused place fades after 30 minutes and is merged with its neighbours", () => {
  const map = new NoDigMap();
  const t0 = 1_000_000;
  map.add({ x: 10, z: 10, r: REFUSED_RADIUS, reason: "reverted" }, t0);
  map.add({ x: 15, z: 12, r: REFUSED_RADIUS, reason: "reverted" }, t0 + 1000); // overlaps: one place
  assert.equal(map.size, 1);
  assert.ok(map.covers({ x: 10, y: 68, z: 10 }));
  assert.equal(map.forget(FORGET_REFUSED_MS, t0 + FORGET_REFUSED_MS - 1000), 0, "still there just short of 30 minutes");
  assert.equal(map.forget(FORGET_REFUSED_MS, t0 + 1000 + FORGET_REFUSED_MS + 1), 1);
  assert.equal(map.size, 0);
});

test("nearestRefused goes by the edge, and the words are counts and bands, never numbers", () => {
  const zones = [
    { x: 100, z: 0, r: 12, reason: "reverted" as const, at: 0 },
    { x: 0, z: -30, r: 12, reason: "reverted" as const, at: 0 },
    { x: -400, z: 0, r: 12, reason: "reverted" as const, at: 0 },
    { x: 0, z: 200, r: 12, reason: "reverted" as const, at: 0 },
  ];
  const near = nearestRefused(zones, { x: 0, z: 0 });
  assert.deepEqual(near.map((z) => z.x + "," + z.z), ["0,-30", "100,0", "0,200"]);
  assert.equal(undoneWords(3, "trees", { x: 0, z: 0 }, zones), "three digs undone near the trees, a short walk north");
  assert.equal(undoneWords(1, "stone", { x: 0, z: -20 }, zones), "one dig undone near the stone, here".replace(", here", ", right here"));
  assert.equal(undoneWords(3, "ore", { x: 0, z: 0 }, []), "three digs undone near the ore");
  for (const n of [1, 2, 3, 4, 9]) assert.doesNotMatch(undoneWords(n, "trees", { x: 5, z: 7 }, zones), /\d/);
  assert.doesNotMatch(nothingToDig("natural stone", true), /\d/);
  assert.match(nothingToDig("natural stone", false), /^no natural stone it may dig/);
});

// ---- what a run reports ----

test("gained: net of what it started with, counts what was stashed, biggest four, names only", () => {
  const got = gained({ stick: 2, oak_log: 1 }, { oak_log: 6, stick: 2, wooden_axe: 1, dirt: 1, apple: 3, coal: 2 }, { oak_log: 6 });
  assert.deepEqual(got, { oak_log: 11, apple: 3, coal: 2, dirt: 1 });
  assert.equal(Object.keys(got).length, 4);
  assert.deepEqual(gained({ oak_log: 5 }, { oak_log: 3 }, {}), {}, "a loss is not a gain");
  assert.deepEqual(gained({}, {}, {}), {});
});

test("endFields: words with no digits, a short line, item counts of a few items", () => {
  assert.deepEqual(endFields({ detail: "three digs undone near the trees, a fair way south-west", got: { oak_log: 4 } }), {
    detail: "three digs undone near the trees, a fair way south-west",
    got: { oak_log: 4 },
  });
  assert.equal(endFields({ detail: "at 12 64 -30 in the water" }).detail, "at - in the water");
  assert.equal(endFields({ detail: "x".repeat(500) }).detail?.length, 120);
  assert.deepEqual(endFields({ detail: "  ", got: {} }), {});
  assert.deepEqual(endFields({}), {});
  const got = endFields({ got: { a: 1, b: 5, c: 3, d: 2, e: 9, "bad name": 4, f: 0, g: 1.5 } }).got;
  assert.deepEqual(got, { e: 9, b: 5, c: 3, d: 2 });
});

test("progress gate: a step change and every 15 s, but a flapping step is held back", () => {
  const g = new ProgressGate();
  assert.ok(g.offer("gathering wood", 0), "the first step");
  assert.ok(!g.offer("gathering wood", 1000), "same step soon after");
  assert.ok(!g.offer("crafting tools", MIN_GAP_MS - 1), "a change inside the gap waits");
  assert.ok(g.offer("crafting tools", MIN_GAP_MS), "and goes out once the gap has passed");
  assert.ok(!g.offer("crafting tools", MIN_GAP_MS + PERIOD_MS - 1));
  assert.ok(g.offer("crafting tools", MIN_GAP_MS + PERIOD_MS), "the same step again after the period");
  // a two-minute task polled every second makes a handful of lines, not dozens
  const run = new ProgressGate();
  const steps = ["gathering wood", "gathering wood", "eating bread", "gathering wood", "crafting tools", "stashing wood"];
  let lines = 0;
  for (let t = 0; t < 120_000; t += 1000) if (run.offer(steps[Math.min(5, Math.floor(t / 20_000))], t)) lines++;
  assert.ok(lines >= 6 && lines <= 12, `${lines} lines`);
});

test("what a stuck walk says: the activity, water or not, never a name or a number", () => {
  assert.equal(activityWords("walking to home"), "walking to home");
  assert.equal(activityWords("walking to the crafting table"), "walking to the crafting table");
  assert.equal(activityWords("walking to Sam2"), "walking to a player");
  assert.equal(activityWords("bringing oak_log to Sam2"), "bringing items to a player");
  assert.equal(activityWords("guarding Sam2"), "guarding a player");
  assert.equal(activityWords("idle"), "walking");
  assert.equal(activityWords("crafting tools"), "crafting tools");
  assert.equal(stuckWords("no_bank", "walking to home", true), "in deep water while walking to home, no way out found");
  assert.equal(stuckWords("no_bank", "walking to home", false), "in the water while walking to home, no way out found");
  assert.equal(stuckWords("twice", "walking to home"), "stuck in the water twice while walking to home, the way on crosses water");
  assert.equal(stuckWords("dry", "stashing wood"), "no progress while stashing wood");
  for (const kind of ["dry", "no_bank", "twice"] as const) assert.doesNotMatch(stuckWords(kind, "walking to Sam2 9"), /\d|Sam/);
});
