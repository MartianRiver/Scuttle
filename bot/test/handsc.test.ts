import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { endFields, EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { digStatus, numberWords, type Facing, type Grid } from "../src/behaviors/dig-down-plan";
import { shortWords } from "../src/behaviors/harvest-plan";
import { describeLevel } from "../src/behaviors/place";
import { addTunnelCell, beginStair, forgetStair, inWay, noteOre, oreKnown, stairLeads, wayEnd, wayFacing } from "../src/behaviors/stair";
import {
  planTunnelStep, sawWords, stopWords, tunnelLength, tunnelStatus, wallOres, TUNNEL_DEFAULT, TUNNEL_MAX, type Rules,
} from "../src/behaviors/tunnel-plan";
import { buildIntent } from "../src/mcp/skills";
import { coverDepth, type Over } from "../src/senses/cover";

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

// ---- the tunnel plan ----

// rock from x 1 on, floor at y 64, the body at (0, 65, 0) in the open; `extra` overrides cells by "x,y,z"
function rock(extra: Record<string, string> = {}): Grid {
  const name = (p: { x: number; y: number; z: number }): string => {
    const hit = extra[`${p.x},${p.y},${p.z}`];
    if (hit) return hit;
    if (p.y <= 64) return "stone";
    if (p.y >= 65 && p.y <= 68 && p.x >= 1) return "stone";
    return "air";
  };
  return { name, solid: (p) => !["air", "water", "lava", "cobweb"].includes(name(p)) };
}
const east: Facing = { dx: 1, dz: 0 };
const cur = { x: 0, y: 65, z: 0 };
const rules: Rules = { canBreak: (n) => n !== "bedrock", missingTool: () => null };

test("a tunnel step digs the head cell then the feet cell and ends in the feet cell", () => {
  const p = planTunnelStep(rock(), cur, east, rules);
  assert.equal(p.kind, "step");
  if (p.kind === "step") {
    assert.deepEqual(p.dig, [{ x: 1, y: 66, z: 0 }, { x: 1, y: 65, z: 0 }]);
    assert.deepEqual(p.to, { x: 1, y: 65, z: 0 });
  }
  // open ground ahead needs no digging
  const open = planTunnelStep(rock({ "1,65,0": "air", "1,66,0": "air" }), cur, east, rules);
  assert.equal(open.kind === "step" && open.dig.length, 0);
});

test("a hole or a drop in the floor ahead blocks it, and so does liquid under it", () => {
  assert.deepEqual(planTunnelStep(rock({ "1,64,0": "air" }), cur, east, rules), { kind: "blocked", detail: "a drop ahead" });
  assert.deepEqual(planTunnelStep(rock({ "1,64,0": "water" }), cur, east, rules), { kind: "blocked", detail: "water below" });
  assert.deepEqual(planTunnelStep(rock({ "1,64,0": "magma_block" }), cur, east, rules), { kind: "blocked", detail: "something hot or prickly below" });
});

test("liquid ahead, beside, over or in the cells stops it before it breaks in, in words", () => {
  assert.deepEqual(planTunnelStep(rock({ "2,65,0": "water" }), cur, east, rules), { kind: "blocked", detail: "water ahead" });
  assert.deepEqual(planTunnelStep(rock({ "2,66,0": "lava" }), cur, east, rules), { kind: "blocked", detail: "lava ahead" });
  assert.deepEqual(planTunnelStep(rock({ "1,65,1": "water" }), cur, east, rules), { kind: "blocked", detail: "water behind the wall" });
  assert.deepEqual(planTunnelStep(rock({ "1,67,0": "lava" }), cur, east, rules), { kind: "blocked", detail: "lava behind the wall" });
  assert.deepEqual(planTunnelStep(rock({ "1,65,0": "water" }), cur, east, rules), { kind: "blocked", detail: "water ahead" });
});

test("a build in the way or near it refuses, sand or gravel overhead and unbreakable rock block", () => {
  assert.equal(planTunnelStep(rock({ "1,65,0": "oak_planks" }), cur, east, rules).kind, "refused");
  assert.equal(planTunnelStep(rock({ "4,66,0": "crafting_table" }), cur, east, rules).kind, "refused");
  assert.equal(planTunnelStep(rock({ "1,67,0": "gravel" }), cur, east, rules).kind, "blocked");
  assert.deepEqual(planTunnelStep(rock({ "1,65,0": "bedrock" }), cur, east, rules), { kind: "blocked", detail: "rock it cannot break is in the way" });
  const dark: Grid = { name: () => null, solid: () => false };
  assert.equal(planTunnelStep(dark, cur, east, rules).kind, "blocked");
  // a cobweb is not dug, and not walked into either
  assert.equal(planTunnelStep(rock({ "1,65,0": "cobweb" }), cur, east, rules).kind, "blocked");
});

test("gravel in the head cell with nothing over it is dug, and gravel over that is not", () => {
  assert.equal(planTunnelStep(rock({ "1,66,0": "gravel", "1,67,0": "air", "1,68,0": "air" }), cur, east, rules).kind, "step");
  assert.equal(planTunnelStep(rock({ "1,66,0": "gravel", "1,67,0": "gravel" }), cur, east, rules).kind, "blocked");
});

test("stone it has no pickaxe for ends no_tool, with the tool in words, and dirt needs none", () => {
  const bare: Rules = { canBreak: () => true, missingTool: (n) => (n === "dirt" ? null : n === "iron_ore" ? "a stone pickaxe or better" : "a pickaxe") };
  assert.deepEqual(planTunnelStep(rock(), cur, east, bare), { kind: "no_tool", detail: "it needs a pickaxe" });
  assert.deepEqual(planTunnelStep(rock({ "1,65,0": "iron_ore", "1,66,0": "dirt" }), cur, east, bare), { kind: "no_tool", detail: "it needs a stone pickaxe or better" });
  assert.equal(planTunnelStep(rock({ "1,65,0": "dirt", "1,66,0": "dirt" }), cur, east, bare).kind, "step");
});

test("the walls show ore with an open face, never what is deeper in the rock", () => {
  const g = rock({ "1,66,1": "coal_ore", "1,64,0": "iron_ore", "2,65,0": "diamond_ore", "1,65,3": "gold_ore", "1,67,0": "deepslate_coal_ore" });
  const opened = [{ x: 1, y: 66, z: 0 }, { x: 1, y: 65, z: 0 }];
  const found = wallOres(g, opened).map((o) => `${o.name}@${o.pos.x},${o.pos.y},${o.pos.z}`).sort();
  assert.deepEqual(found, ["coal_ore@1,66,1", "deepslate_coal_ore@1,67,0", "diamond_ore@2,65,0", "iron_ore@1,64,0"]);
  assert.deepEqual(wallOres(rock(), opened), []);
});

test("the length is a count or a band, held to the cap", () => {
  assert.equal(tunnelLength(undefined), TUNNEL_DEFAULT);
  assert.equal(tunnelLength(6), 6);
  assert.equal(tunnelLength(500), TUNNEL_MAX);
  assert.equal(tunnelLength(0), 1);
  assert.equal(tunnelLength("near"), 8);
  assert.equal(tunnelLength("far"), TUNNEL_MAX);
  assert.equal(tunnelLength("a fair way"), 24);
});

test("the words a tunnel ends with carry no digit and survive the way out", () => {
  assert.equal(stopWords(["iron_ore"]), "iron ore in the wall");
  assert.equal(stopWords(["coal_ore", "iron_ore", "coal_ore"]), "coal ore and iron ore in the wall");
  assert.equal(stopWords(["coal_ore", "iron_ore", "gold_ore"]), "coal ore, iron ore and gold ore in the wall");
  const saw = sawWords(["coal_ore", "iron_ore", "coal_ore", "coal_ore"]);
  assert.equal(saw, "three coal ore, iron ore");
  assert.equal(sawWords(["deepslate_iron_ore", "coal_ore"]), "coal ore, deepslate iron ore");
  for (const s of [saw, stopWords(["diamond_ore"])]) assert.equal(endFields({ saw: s, detail: s }).saw, s);
  for (let n = 0; n <= TUNNEL_MAX; n++) assert.ok(!/\d/.test(tunnelStatus(n)), tunnelStatus(n));
  assert.equal(tunnelStatus(0), "tunnelling");
  assert.equal(tunnelStatus(1), "tunnelling, one block");
  assert.equal(tunnelStatus(6), "tunnelling, six blocks");
  assert.equal(tunnelStatus(21), "tunnelling, twenty-one blocks");
  for (let n = 0; n <= TUNNEL_MAX; n++) assert.ok(!/\d/.test(numberWords(n)) && numberWords(n) !== "many", String(n));
  assert.equal(numberWords(TUNNEL_MAX + 1), "many");
  assert.equal(digStatus(4), "digging down, four steps");
});

// ---- the way it dug ----

const west: Facing = { dx: -1, dz: 0 };
const south: Facing = { dx: 0, dz: 1 };

test("a tunnel goes on from the end of the way, and a stair's foot is its first end", () => {
  forgetStair();
  assert.equal(wayEnd(), null);
  beginStair({ x: 16, y: 68, z: 0 }, west);
  beginStair({ x: 16, y: 68, z: 0 }, west);
  assert.deepEqual(wayEnd(), { x: 16, y: 68, z: 0 });
  assert.deepEqual(wayFacing(), west);
  addTunnelCell({ x: 12, y: 64, z: 1 }, south);
  addTunnelCell({ x: 12, y: 64, z: 2 }, south);
  addTunnelCell({ x: 12, y: 64, z: 2 }, south);
  assert.deepEqual(wayEnd(), { x: 12, y: 64, z: 2 });
  assert.deepEqual(wayFacing(), south);
  // a body in the tunnel, level with the top, is a few blocks along a way that leads back
  assert.equal(stairLeads({ x: 12, y: 64, z: 2 }), "up");
  assert.equal(stairLeads({ x: 0, y: 68, z: 9 }), "down");
  // on it, beside it or in the pit under its foot is in the way; the next field over is not
  assert.equal(inWay({ x: 12, y: 64, z: 2 }), true);
  assert.equal(inWay({ x: 16, y: 67, z: 1 }), true);
  assert.equal(inWay({ x: 12, y: 63, z: 3 }), true);
  assert.equal(inWay({ x: 30, y: 68, z: 0 }), false);
  forgetStair();
  assert.equal(inWay({ x: 12, y: 64, z: 2 }), false);
});

test("ore it has told of is not told again, and a new way forgets it", () => {
  beginStair({ x: 0, y: 65, z: 0 }, east);
  assert.equal(oreKnown("1,65,1"), false);
  noteOre("1,65,1");
  assert.equal(oreKnown("1,65,1"), true);
  beginStair({ x: 0, y: 65, z: 0 }, east);
  assert.equal(oreKnown("1,65,1"), false);
  forgetStair();
});

// ---- the wire ----

test("parseFrame: tunnel takes a cardinal dir, a count to 32 or a band, and through", () => {
  assert.ok(ok({ intent: "tunnel" }));
  assert.ok(ok({ intent: "tunnel", dir: "east", length: 12, through: true }));
  assert.ok(ok({ intent: "tunnel", length: "a fair way" }));
  assert.ok(ok({ intent: "tunnel", length: 32 }));
  assert.ok(!ok({ intent: "tunnel", length: 33 }));
  assert.ok(!ok({ intent: "tunnel", length: 0 }));
  assert.ok(!ok({ intent: "tunnel", length: "100" }));
  assert.ok(!ok({ intent: "tunnel", dir: "north-east" }));
  assert.ok(!ok({ intent: "tunnel", dir: "down" }));
  assert.ok(!ok({ intent: "tunnel", through: "yes" }));
  assert.ok(!ok({ intent: "tunnel", x: 5 })); // no coordinates
});

test("the adapter builds tunnel and refuses what the body would", () => {
  assert.deepEqual(buildIntent("tunnel", {}), { ok: true, fields: { intent: "tunnel" } });
  assert.deepEqual(buildIntent("tunnel", { dir: "south", length: 8, through: false }), { ok: true, fields: { intent: "tunnel", dir: "south", length: 8, through: false } });
  assert.equal(buildIntent("tunnel", { dir: "north-east" }).ok, false);
  assert.equal(buildIntent("tunnel", { length: 40 }).ok, false);
  assert.equal(buildIntent("tunnel", { length: "a mile" }).ok, false);
  assert.equal(buildIntent("tunnel", { handle: "b1kq" }).ok, false);
  assert.equal(buildIntent("explore", { dir: "east", through: true }).ok, false);
});

test("a tunnel runs like a task and is busy beside the others", () => {
  const log = new EventLog();
  const body = {
    inGame: () => true, fighting: () => false, danger: () => false, busy: () => false, runAction: () => new Promise(() => {}), vitals: () => ({ health: 20, food: 20 }),
  } as unknown as BodyControl;
  const d = createDispatcher(body, log);
  assert.equal(d.handle({ intent: "tunnel", dir: "east" }).kind, "accepted");
  assert.deepEqual(d.handle({ intent: "climb_up" }), { kind: "rejected", reason: "busy" });
  assert.equal(log.since(0).events[0].kind, "tunnel:east");
});

// ---- collect that ends short, and where it is ----

test("the words for a short collect say what held it back, undone digs first", () => {
  assert.equal(shortWords({ builds: 0, undone: 0 }), "no more in reach");
  assert.equal(shortWords({ builds: 2, undone: 0 }), "the rest is under a build");
  assert.equal(shortWords({ builds: 0, undone: 1 }), "the rest is where digs are undone");
  assert.equal(shortWords({ builds: 3, undone: 1 }), "the rest is where digs are undone");
  for (const w of [shortWords({ builds: 0, undone: 0 }), shortWords({ builds: 1, undone: 0 }), shortWords({ builds: 0, undone: 1 })]) {
    assert.equal(endFields({ detail: w }).detail, w);
  }
});

const col = (...c: Over[]) => c;

test("under rock is more than two solid blocks over the head, and the depth is to the top of them", () => {
  assert.equal(coverDepth(col("open", "open")), null);
  assert.equal(coverDepth(col("rock", "rock", "open", "open")), null);
  // dirt dirt dirt grass over a stair eight down: the top rock is index 3 + the two cells of the body
  assert.equal(coverDepth(col("rock", "rock", "rock", "rock", "rock", "rock", "open", "open")), 8);
  assert.equal(coverDepth(col("rock", "rock", "rock", "open", "open")), 5);
});

test("a roof or a tree is not rock", () => {
  assert.equal(coverDepth(col("rock", "made", "rock", "rock", "open")), null);
  assert.equal(coverDepth(col("foliage", "foliage", "foliage", "foliage", "open")), null);
  assert.equal(coverDepth(col("foliage", "foliage", "rock", "foliage", "open")), null);
});

test("where says underground with how far down, for a stair at any height, and keeps the height rule for caves", () => {
  const home = { x: 100, y: 68, z: 100 };
  const at = (y: number) => ({ x: 0, y, z: 0 });
  assert.equal(describeLevel(at(60), home), "on the surface");
  assert.equal(describeLevel(at(40), home), "underground");
  assert.equal(describeLevel(at(60), home, undefined, 8), "underground, several blocks down");
  assert.equal(describeLevel(at(68), home, undefined, 2), "underground, a block or two down");
  assert.equal(describeLevel(at(-10), home, undefined, 40), "deep underground, a long way down");
  assert.equal(describeLevel({ x: 100, y: 60, z: 100 }, home, undefined, 4), "at home, underground, a few blocks down");
  assert.equal(describeLevel(at(68), home), "on the surface");
  assert.equal(describeLevel(at(60), home, "the_nether", 8), "in the Nether");
});

test("act's schema takes the tunnel arguments", async () => {
  const { TOOLS } = await import("../src/mcp/tools");
  const act = TOOLS.find((t) => t.name === "act")!;
  for (const k of ["dir", "length", "through"]) assert.ok(k in act.shape, k);
});
