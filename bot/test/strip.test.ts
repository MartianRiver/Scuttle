// The strip mine's pure parts: the stair through rock, torch pacing, the upkeep warnings, and the new wire shapes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { chooseFacing, planStep, type Facing, type Grid, type StepOpts } from "../src/behaviors/dig-down-plan";
import { planPut } from "../src/behaviors/put-plan";
import { TorchPacer, withTorchNote } from "../src/behaviors/torch-plan";
import { PackEpisode, roomFor, WearWatch, WEAR_AT, isWatchedTool } from "../src/behaviors/upkeep-plan";
import { buildIntent, skillsTable } from "../src/mcp/skills";
import { wakeReason } from "../src/mcp/wait";
import { LIGHT_SWAP } from "../src/lib/light";
import { compose, OBSERVATION_MAX_CHARS, type RawSense } from "../src/senses/compose";

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;
const east: Facing = { dx: 1, dz: 0 };
const canBreak = (n: string) => n !== "bedrock";
const through: StepOpts = { through: true, missingTool: () => null };

// open ground to y 64 as its top, rock under it from y 63 down, deepslate under y 0; `extra` overrides cells
function ground(extra: Record<string, string> = {}): Grid {
  const name = (p: { x: number; y: number; z: number }): string => {
    const hit = extra[`${p.x},${p.y},${p.z}`];
    if (hit) return hit;
    if (p.y >= 64) return "air";
    if (p.y < 0) return "deepslate";
    return p.y >= 63 ? "dirt" : "stone";
  };
  return { name, solid: (p) => !["air", "water", "lava", "cobweb"].includes(name(p)) };
}

test("through: a stair step digs stone and deepslate where the stone mode stops", () => {
  const down = { x: 0, y: 40, z: 0 };
  const g = ground({ "0,39,0": "stone", "0,40,0": "air", "0,41,0": "air", "0,42,0": "air", "0,43,0": "air" });
  assert.equal(planStep(g, down, east, canBreak).kind, "stop"); // stone under it: the old stop
  const p = planStep(g, down, east, canBreak, through);
  assert.equal(p.kind, "step");
  if (p.kind === "step") {
    assert.deepEqual(p.dig, [{ x: 1, y: 41, z: 0 }, { x: 1, y: 40, z: 0 }, { x: 1, y: 39, z: 0 }]);
    assert.deepEqual(p.to, { x: 1, y: 39, z: 0 });
    assert.equal(p.level, false);
  }
  // below y 0 it is deepslate all the same
  const deep = planStep(ground(), { x: 0, y: -20, z: 0 }, east, canBreak, through);
  assert.equal(deep.kind, "step");
});

test("through: a pickaxe the rock needs, bedrock, and a cave opened into each stop with their words", () => {
  const cur = { x: 0, y: 30, z: 0 };
  const need = planStep(ground(), cur, east, canBreak, { through: true, missingTool: (n) => (n === "stone" ? "a wooden pickaxe or better" : null) });
  assert.deepEqual(need, { kind: "no_tool", detail: "it needs a wooden pickaxe or better" });
  // the same rule is not asked of the stone mode, which never digs stone
  assert.equal(planStep(ground(), { x: 0, y: 64, z: 0 }, east, canBreak, { missingTool: () => "x" }).kind, "step");

  const bed = planStep(ground({ "1,29,0": "bedrock" }), cur, east, canBreak, through);
  assert.deepEqual(bed, { kind: "refused", detail: "bedrock is in the way" });

  // under rock, a dug column that is already open is a cave
  const cave = planStep(ground({ "1,30,0": "air" }), cur, east, canBreak, through);
  assert.deepEqual(cave, { kind: "blocked", detail: "a cave opens ahead" });
  // at the surface, with open sky over the feet, the same open cell is just the air over the ground
  const top = planStep(ground({ "1,66,0": "air" }), { x: 0, y: 64, z: 0 }, east, canBreak, through);
  assert.equal(top.kind, "step");
});

test("through: lava and gravel keep their stops all the way down", () => {
  const cur = { x: 0, y: 30, z: 0 };
  assert.deepEqual(planStep(ground({ "1,28,0": "lava" }), cur, east, canBreak, through), { kind: "blocked", detail: "lava below" });
  const gravel = planStep(ground({ "1,32,0": "gravel" }), cur, east, canBreak, through);
  assert.deepEqual(gravel, { kind: "blocked", detail: "sand or gravel overhead" });
  assert.deepEqual(planStep(ground({ "1,28,0": "air", "1,27,0": "air" }), cur, east, canBreak, through).kind, "blocked");
});

test("through: the facing probe sees the first step too", () => {
  const chosen = chooseFacing(ground(), { x: 0, y: 30, z: 0 }, [east], canBreak, through);
  assert.equal(chosen.steps, 3);
  const wall = chooseFacing(ground({ "1,29,0": "bedrock" }), { x: 0, y: 30, z: 0 }, [east], canBreak, through);
  assert.equal(wall.steps, 0);
  assert.equal(wall.first.kind, "refused");
});

// ---- torches ----

test("a torch is due at the start only when it is dark, then every eight blocks", () => {
  const dark = new TorchPacer(3);
  assert.equal(dark.due(), true);
  dark.placed();
  assert.equal(dark.due(), false);
  const lit = new TorchPacer(12);
  assert.equal(lit.due(), false);
  const at: number[] = [];
  for (let i = 1; i <= 24; i++) {
    lit.step();
    if (lit.due()) {
      at.push(i);
      lit.placed();
    }
  }
  assert.deepEqual(at, [8, 16, 24]);
  assert.equal(new TorchPacer(null).due(), false); // light not known: not guessed
});

test("a torch that could not be set stays due for the next block", () => {
  const p = new TorchPacer(15);
  for (let i = 0; i < 8; i++) p.step();
  assert.equal(p.due(), true);
  p.step(); // no wall within reach here: nothing placed
  assert.equal(p.due(), true);
  p.placed();
  assert.equal(p.due(), false);
});

test("out of torches is said once, with the dark stretch behind it, in words", () => {
  const p = new TorchPacer(15);
  assert.equal(p.words(), null);
  for (let i = 0; i < 8; i++) p.step();
  p.outOfTorches();
  assert.equal(p.due(), false); // it stops asking
  for (let i = 0; i < 6; i++) p.step();
  assert.equal(p.words(), "out of torches fourteen blocks back");
  assert.equal(withTorchNote("ran out of length", p), "ran out of length, out of torches fourteen blocks back");
  assert.equal(withTorchNote("pack full", null), "pack full");
  assert.ok(!/\d/.test(p.words() ?? ""));
});

test("a torch in a one-wide tunnel goes on the wall behind the body, never in its column or the next cell", () => {
  // a tunnel along x at y 10 and 11, rock all round; the body at x 5 facing east, the next column x 6 still rock
  const open = (x: number, y: number, z: number) => z === 0 && x <= 5 && x >= 0 && (y === 10 || y === 11);
  const nameAt = (p: { x: number; y: number; z: number }) => (open(p.x, p.y, p.z) ? "air" : "stone");
  const view = {
    eye: { x: 5.5, y: 11.62, z: 0.5 },
    feet: { x: 5, y: 10, z: 0 },
    facing: { dx: 1, dz: 0 },
    nameAt,
    solid: (p: { x: number; y: number; z: number }) => !open(p.x, p.y, p.z),
    occupied: () => false,
  };
  const plan = planPut("torch", { kind: "wall" }, view);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.deepEqual(plan.spot.cell, { x: 4, y: 11, z: 0 }); // behind, at head height
    assert.ok(plan.spot.ref.z !== 0 && plan.spot.ref.x === 4, "set against a side wall");
  }
});

// ---- upkeep ----

test("room for a drop: a partial stack or an empty slot, drops taken in turn", () => {
  const stacks = [{ name: "cobblestone", count: 64, stackSize: 64 }, { name: "dirt", count: 10, stackSize: 64 }];
  assert.equal(roomFor(["cobblestone"], stacks, 0), false);
  assert.equal(roomFor(["dirt"], stacks, 0), true);
  assert.equal(roomFor(["cobblestone"], stacks, 1), true);
  // one empty slot takes the first of two different drops and not the second
  assert.equal(roomFor(["cobblestone", "diamond"], stacks, 1), false);
  // a slot taken by the first drop has room for more of it
  assert.equal(roomFor(["cobblestone", "cobblestone"], stacks, 1), true);
  assert.equal(roomFor([], stacks, 0), true);
});

test("pack_full is news once an episode, and again after a slot frees", () => {
  const e = new PackEpisode();
  assert.equal(e.note(), true);
  assert.equal(e.note(), false);
  e.clear();
  assert.equal(e.note(), true);
});

test("tool_worn is told once per tool, and again for a fresh one of the same kind", () => {
  const w = new WearWatch();
  assert.equal(w.check(null), null);
  assert.equal(w.check({ name: "iron_pickaxe", left: WEAR_AT + 1 }), null);
  assert.equal(w.check({ name: "iron_pickaxe", left: WEAR_AT }), "iron_pickaxe");
  assert.equal(w.check({ name: "iron_pickaxe", left: 4 }), null);
  assert.equal(w.check({ name: "iron_sword", left: 8 }), "iron_sword");
  assert.equal(w.check({ name: "iron_pickaxe", left: 100 }), null); // a new one in hand
  assert.equal(w.check({ name: "iron_pickaxe", left: 9 }), "iron_pickaxe");
  assert.ok(isWatchedTool("diamond_pickaxe") && isWatchedTool("stone_sword") && !isWatchedTool("iron_axe") && !isWatchedTool("shears"));
});

test("wait wakes on pack_full and tool_worn", () => {
  const ev = (event: string, f: object = {}) => ({ seq: 1, ts: 0, event, ...f });
  assert.equal(wakeReason(ev("pack_full")), "pack_full");
  assert.equal(wakeReason(ev("tool_worn", { item: "iron_pickaxe", left: "a few uses left" })), "tool_worn");
});

// ---- the wire ----

test("parseFrame: go_to takes a handle or a whole cell, never both, and dig_down a y", () => {
  assert.ok(ok({ intent: "go_to", handle: "stair" }));
  assert.ok(ok({ intent: "go_to", x: 12, y: -50, z: -300 }));
  assert.ok(!ok({ intent: "go_to", x: 12, y: -50 }));
  assert.ok(!ok({ intent: "go_to", x: 12.5, y: 3, z: 1 }));
  assert.ok(!ok({ intent: "go_to", x: "12", y: 3, z: 1 }));
  assert.ok(!ok({ intent: "go_to", handle: "stair", x: 1, y: 2, z: 3 }));
  assert.ok(!ok({ intent: "go_to", x: 1, y: 99999, z: 3 }));
  assert.ok(!ok({ intent: "go_to" }));
  assert.ok(ok({ intent: "dig_down", to: -50 }));
  assert.ok(ok({ intent: "dig_down", to: "stone", torches: true }));
  assert.ok(!ok({ intent: "dig_down", to: 1.5 }));
  assert.ok(!ok({ intent: "dig_down", to: "-50" }));
  assert.ok(!ok({ intent: "dig_down", torches: "yes" }));
  assert.ok(ok({ intent: "tunnel", dir: "east", length: 32, torches: true }));
  assert.ok(!ok({ intent: "tunnel", torches: 1 }));
});

test("the adapter builds go_to, dig_down to a y and torches", () => {
  assert.deepEqual(buildIntent("go_to", { x: 1, y: -2, z: 3 }), { ok: true, fields: { intent: "go_to", x: 1, y: -2, z: 3 } });
  assert.deepEqual(buildIntent("go_to", { handle: "stair" }), { ok: true, fields: { intent: "go_to", handle: "stair" } });
  assert.equal(buildIntent("go_to", {}).ok, false);
  assert.equal(buildIntent("go_to", { x: 1, y: 2 }).ok, false);
  assert.equal(buildIntent("go_to", { handle: "stair", x: 1, y: 2, z: 3 }).ok, false);
  assert.equal(buildIntent("go_to", { x: 1.5, y: 2, z: 3 }).ok, false);
  assert.deepEqual(buildIntent("dig_down", { to: -50, torches: true }), { ok: true, fields: { intent: "dig_down", to: -50, torches: true } });
  assert.equal(buildIntent("dig_down", { to: "diamond" }).ok, false);
  assert.equal(buildIntent("dig_down", { to: 2.5 }).ok, false);
  assert.deepEqual(buildIntent("tunnel", { dir: "north", length: 16, torches: true }), { ok: true, fields: { intent: "tunnel", dir: "north", length: 16, torches: true } });
  assert.equal(buildIntent("place", { item: "torch", torches: true }).ok, false);
});

test("skills say what the new endings mean", () => {
  const t = JSON.stringify(skillsTable());
  for (const w of ["at the depth asked", "pack full", "out of torches", "no_torches", "bedrock", "sixty-four", "pack_full", "tool_worn", "strip_mine"]) assert.ok(t.includes(w), w);
});

// ---- the dispatcher ----

function stub(over: Partial<BodyControl> = {}): BodyControl {
  return {
    inGame: () => true,
    fighting: () => false,
    danger: () => false,
    busy: () => false,
    canSee: () => true,
    vitals: () => ({ health: 20, food: 20 }),
    comeTo: async () => {},
    follow: () => {},
    guard: async () => {},
    give: async () => {},
    goTo: async () => {},
    goToPoint: async () => {},
    carries: () => 5,
    handleLabel: () => null,
    observe: () => ({ pos: { x: 0, y: 0, z: 0 }, health: 20, food: 20, weather: "clear", where: "x", held: null, inv: {}, near: [], blocks: [] }),
    runTask: async () => {},
    runAction: () => new Promise(() => {}),
    knowsItem: () => true,
    recipe: () => null,
    stash: () => ({ items: {}, fresh: true, looked: "just now" }),
    equip: () => true,
    placementOn: () => true,
    canExplore: () => true,
    say: () => "sent",
    stop: () => {},
    interrupt: () => {},
    ...over,
  };
}

test("torches asked for with none carried is rejected at once, and fine with some", () => {
  const none = createDispatcher(stub({ carries: () => 0 }), new EventLog());
  assert.deepEqual(none.handle({ intent: "dig_down", to: -50, torches: true }), { kind: "rejected", reason: "no_torches" });
  assert.deepEqual(none.handle({ intent: "tunnel", torches: true }), { kind: "rejected", reason: "no_torches" });
  assert.equal(none.handle({ intent: "tunnel" }).kind, "accepted"); // not asked for
  const some = createDispatcher(stub(), new EventLog());
  assert.equal(some.handle({ intent: "dig_down", to: -50, torches: true }).kind, "accepted");
});

test("go_to a cell runs the walk, and its refusal ends the run with words", async () => {
  const log = new EventLog();
  const walked: number[][] = [];
  const err = Object.assign(new Error("refused"), { detail: "something a player built is too close to there" });
  const d = createDispatcher(stub({ goToPoint: async (x, y, z) => { walked.push([x, y, z]); throw err; } }), log);
  assert.equal(d.handle({ intent: "go_to", x: 3, y: -50, z: 9 }).kind, "accepted");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(walked, [[3, -50, 9]]);
  const end = log.since(0).events.find((e) => e.event === "task_failed");
  assert.equal(end?.reason, "refused");
  assert.equal(end?.detail, "something a player built is too close to there");
});

// ---- the observation ----

test("the local view is never trimmed, whatever the lists hold", () => {
  const blocks = Array.from({ length: 40 }, (_, i) => ({ handle: `b${i}kq`, what: "diamond_ore", dx: i + 3, dy: 0, dz: 2 }));
  const o = compose(
    {
      pos: { x: -1203, y: -50, z: 4410 },
      biome: "dripstone_caves",
      under: "deepslate",
      light: 0,
      health: 20, food: 20, armor: 0, time: null, weather: "clear", where: "underground", held: "iron_pickaxe",
      items: [], tools: [], entities: [], blocks, refused: [], places: null,
    } as RawSense,
    OBSERVATION_MAX_CHARS
  );
  assert.deepEqual(o.pos, { x: -1203, y: -50, z: 4410 });
  assert.equal(o.biome, "dripstone_caves");
  assert.equal(o.under, "deepslate");
  assert.equal(o.light, 0); // zero is a reading, not a missing one
  assert.ok(o.more && o.more.blocks > 0);
  assert.ok(JSON.stringify(o).length <= OBSERVATION_MAX_CHARS);
});

// ---- block light ----

test("light: the swap blockLightAt applies is what prismarine-chunk's BitArray needs (drop it when this fails)", async () => {
  const BitArray = (await import("prismarine-chunk/src/pc/common/BitArrayNoSpan")).default ?? require("prismarine-chunk/src/pc/common/BitArrayNoSpan");
  const { SmartBuffer } = await import("smart-buffer");
  const buf = Buffer.alloc(2048);
  const setNibble = (i: number, v: number) => (buf[i >> 1] |= v << ((i & 1) * 4)); // the server's layout: low nibble first
  const at = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x;
  setNibble(at(7, 9, 10), 14);
  setNibble(at(3, 2, 1), 9);
  setNibble(at(12, 15, 15), 5);
  const arr = new BitArray({ bitsPerValue: 4, capacity: 4096 });
  arr.readBuffer(SmartBuffer.fromBuffer(buf));
  assert.equal(arr.get(at(7, 9, 10)), 0, "unswapped, the reading is wrong");
  assert.equal(arr.get(at(7 ^ LIGHT_SWAP, 9, 10)), 14);
  assert.equal(arr.get(at(3 ^ LIGHT_SWAP, 2, 1)), 9);
  assert.equal(arr.get(at(12 ^ LIGHT_SWAP, 15, 15)), 5);
});
