import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { endFields, EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { findRouteBack, wayOut } from "../src/behaviors/bank";
import { chooseFacing, depthWords, digStatus, facingsFrom, planStep, MAX_STEPS, type Facing, type Grid, type StepPlan } from "../src/behaviors/dig-down-plan";
import type { Cell, Grid as WaterGrid } from "../src/behaviors/hazard";
import { bestTool, holdsPin, idleHold, pinHand } from "../src/behaviors/idle-hand";
import { mobsWords } from "../src/behaviors/reflex-words";
import { compose, waterLines, type RawEntity, type RawSense } from "../src/senses/compose";
import { wakeReason } from "../src/mcp/wait";
import { FakeBody, connected } from "./mcp-fake";
import { TOOLS } from "../src/mcp/tools";
import { buildIntent } from "../src/mcp/skills";

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

test("parseFrame: dig_down takes only to: stone, climb_up takes nothing", () => {
  assert.ok(ok({ intent: "dig_down" }));
  assert.ok(ok({ intent: "dig_down", to: "stone" }));
  assert.ok(!ok({ intent: "dig_down", to: "diamond" }));
  assert.ok(!ok({ intent: "dig_down", depth: 5 }));
  assert.ok(ok({ intent: "climb_up" }));
  assert.ok(!ok({ intent: "climb_up", to: "stone" }));
  assert.ok(ok({ intent: "go_to", handle: "stair" }));
});

test("the adapter builds dig_down and climb_up and refuses stray arguments", () => {
  assert.deepEqual(buildIntent("dig_down", {}), { ok: true, fields: { intent: "dig_down" } });
  assert.deepEqual(buildIntent("dig_down", { to: "stone" }), { ok: true, fields: { intent: "dig_down", to: "stone" } });
  assert.equal(buildIntent("climb_up", { to: "stone" }).ok, false);
  assert.equal(buildIntent("dig_down", { dir: "north" }).ok, false);
});

// ---- the dispatcher: why it was refused, and how a reflex ended ----

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
    handleLabel: () => null,
    observe: () => ({ health: 20, food: 20, weather: "clear", where: "x", held: null, inv: {}, near: [], blocks: [] }),
    runTask: async () => {},
    runAction: () => new Promise(() => {}),
    knowsItem: () => true,
    recipe: () => null,
    stash: () => ({ items: {}, fresh: true, looked: "just now" }),
    equip: () => true,
    canExplore: () => true,
    say: () => "sent",
    announce: () => {},
    stop: () => {},
    interrupt: () => {},
    ...over,
  };
}

test("in_danger carries what the danger is, with no number", () => {
  const d = createDispatcher(stub({ danger: () => true, dangerWhy: () => "a zombie is close" }), new EventLog());
  assert.deepEqual(d.handle({ intent: "dig_down" }), { kind: "rejected", reason: "in_danger", detail: "a zombie is close" });
  const wet = createDispatcher(stub({ danger: () => true, dangerWhy: () => "in deep water, swimming out" }), new EventLog());
  assert.deepEqual(wet.handle({ intent: "climb_up" }), { kind: "rejected", reason: "in_danger", detail: "in deep water, swimming out" });
  // a body that cannot say still refuses
  const mute = createDispatcher(stub({ danger: () => true }), new EventLog());
  assert.deepEqual(mute.handle({ intent: "dig_down" }), { kind: "rejected", reason: "in_danger" });
  assert.ok(!/\d/.test(endFields({ detail: "5 zombies" }).detail ?? ""));
});

test("a reflex's end is one reflex_ended event", () => {
  const log = new EventLog();
  const d = createDispatcher(stub(), log);
  d.reflexEnded("mobs", true);
  d.reflexEnded("drowning", false, "no way out of the water found");
  const [a, b] = log.since(0).events;
  assert.equal(a.event, "reflex_ended");
  assert.deepEqual({ what: a.what, ok: a.ok, detail: a.detail }, { what: "mobs", ok: true, detail: undefined });
  assert.deepEqual({ what: b.what, ok: b.ok, detail: b.detail }, { what: "drowning", ok: false, detail: "no way out of the water found" });
});

test("dig_down and climb_up run like tasks", () => {
  const log = new EventLog();
  const d = createDispatcher(stub(), log);
  const r = d.handle({ intent: "dig_down" });
  assert.equal(r.kind, "accepted");
  assert.deepEqual(d.handle({ intent: "climb_up" }), { kind: "rejected", reason: "busy" });
  assert.equal(log.since(0).events[0].kind, "dig_down:stone");
});

test("wake reasons: reflex_ended wakes", () => {
  const ev = (event: string, f: object = {}) => ({ seq: 1, ts: 0, event, ...f });
  assert.equal(wakeReason(ev("reflex_ended", { what: "mobs", ok: true })), "reflex_ended");
  assert.equal(wakeReason(ev("reflex_ended", { what: "drowning", ok: false }), "t1"), "reflex_ended");
});

test("the mcp act tool passes the detail of an in_danger refusal through, with a neutral hint", async () => {
  const fake = await FakeBody.start();
  const client = await connected(fake);
  try {
    fake.reply = (m) => ({ type: "rejected", id: m.id, reason: "in_danger", detail: "in deep water, swimming out" });
    const act = TOOLS.find((t) => t.name === "act")!;
    const { out } = await act.run({ client }, { action: "dig_down", rationale: "r" });
    assert.equal(out.accepted, false);
    assert.equal(out.reason, "in_danger");
    assert.equal(out.detail, "in deep water, swimming out");
    assert.ok(!/mobs are on the body/.test(String(out.hint)));
    assert.ok(/reflex/.test(String(out.hint)));
  } finally {
    client.close();
    await fake.close();
  }
});

test("mobsWords names what is close, with no number", () => {
  assert.equal(mobsWords(["zombie"]), "a zombie is close");
  assert.equal(mobsWords(["zombie", "zombie"]), "a zombie is close");
  assert.equal(mobsWords(["enderman"]), "an enderman is close");
  assert.equal(mobsWords(["cave_spider", "skeleton"]), "a cave spider and a skeleton are close");
  assert.equal(mobsWords(["a", "b", "c"]), "several mobs are close");
  assert.equal(mobsWords([]), "mobs are close");
});

// ---- fish ----

const fish = (what: string, dx: number, handle = ""): RawEntity => ({ handle, what, kind: "other", dx, dy: 0, dz: 0, water: true });
const base = (over: Partial<RawSense>): RawSense => ({
  health: 20, food: 20, armor: 0, time: "day", weather: "clear", where: "x", held: null, items: [], tools: [], entities: [], blocks: [], refused: [], places: null, ...over,
});

test("seven cod are one line with a count and the nearest band", () => {
  const school = Array.from({ length: 7 }, (_, i) => fish("cod", 5 + i, i === 0 ? "e1kq" : ""));
  const o = compose(base({ entities: school }));
  assert.deepEqual(o.near, [{ h: "e1kq", what: "cod x7", d: "close" }]);
});

test("fish carry no handle when something else is near, and come last", () => {
  const cow: RawEntity = { handle: "e9kq", what: "cow", kind: "other", dx: 30, dy: 0, dz: 0 };
  const o = compose(base({ entities: [fish("cod", 2, ""), fish("cod", 3, ""), fish("salmon", 6, ""), cow] }));
  assert.deepEqual(o.near.map((e) => e.what), ["cow", "cod x2", "salmon"]);
  assert.ok(o.near.slice(1).every((e) => e.h === undefined));
  assert.equal(o.near[0].h, "e9kq");
  assert.deepEqual(o.near[2], { what: "salmon", dir: "east", d: "close" });
  assert.deepEqual(waterLines([fish("squid", 3, "e1aa")], true), [{ h: "e1aa", what: "squid", dir: "east", d: "here" }]);
});

// ---- the way back from the water ----

function water(layers: Record<number, string[]>): WaterGrid {
  return (x, y, z): Cell => {
    const c = layers[y]?.[z]?.[x];
    if (c === undefined) return y <= Math.min(...Object.keys(layers).map(Number)) ? { solid: true, fluid: null, fire: false } : { solid: false, fluid: null, fire: false };
    return { solid: c === "s", fluid: c === "w" ? "water" : null, fire: false };
  };
}

test("findRouteBack heads for the shore nearest the ground it knew, beyond the quick look", () => {
  // a pool 40 wide with a shore at each end; the body is in the middle, its footing was on the right
  const row = "s" + "w".repeat(40) + "s";
  const g = water({ 64: [row], 65: [row], 66: [row], 67: ["." .repeat(42)] });
  const from = { x: 20.5, y: 65, z: 0.5 };
  const toRight = findRouteBack(g, from, { x: 41, y: 67, z: 0 });
  assert.ok(toRight);
  assert.ok(toRight!.bank.x >= 40, `bank at ${toRight!.bank.x}`);
  const toLeft = findRouteBack(g, from, { x: 0, y: 67, z: 0 });
  assert.ok(toLeft!.bank.x <= 1);
  assert.equal(findRouteBack(g, { x: 0.5, y: 67, z: 0.5 }, { x: 41, y: 67, z: 0 }), null, "on dry ground there is no way back to find");
  // wayOut prefers the nearest bank, or the footing when asked to
  assert.ok(wayOut(g, { x: 3.5, y: 65, z: 0.5 }, { x: 41, y: 67, z: 0 }, "bank")!.bank.x <= 1);
  assert.ok(wayOut(g, { x: 3.5, y: 65, z: 0.5 }, { x: 41, y: 67, z: 0 }, "footing")!.bank.x >= 40);
});

// ---- the stair ----

// ground: dirt from y 61 to 64, stone from 60 down, air over; `extra` overrides cells by "x,y,z"
function ground(extra: Record<string, string> = {}): Grid {
  const name = (p: { x: number; y: number; z: number }): string => {
    const hit = extra[`${p.x},${p.y},${p.z}`];
    if (hit) return hit;
    return p.y <= 60 ? "stone" : p.y <= 64 ? "dirt" : "air";
  };
  return { name, solid: (p) => !["air", "water", "lava"].includes(name(p)) };
}
const east: Facing = { dx: 1, dz: 0 };
const can = () => true;

function walkDown(g: Grid, start = { x: 0, y: 65, z: 0 }, f: Facing = east): { steps: number; end: StepPlan; ys: number[] } {
  let cur = start;
  const ys: number[] = [];
  for (let i = 0; i <= MAX_STEPS + 2; i++) {
    const plan = planStep(g, cur, f, can);
    if (plan.kind !== "step") return { steps: i, end: plan, ys };
    cur = plan.to;
    ys.push(cur.y);
  }
  throw new Error("it never stopped");
}

test("a stair through dirt goes down a block a step and stops on stone", () => {
  const { steps, end, ys } = walkDown(ground());
  assert.equal(end.kind, "stop");
  assert.equal(steps, 4);
  assert.deepEqual(ys, [64, 63, 62, 61]);
  const first = planStep(ground(), { x: 0, y: 65, z: 0 }, east, can);
  assert.equal(first.kind, "step");
  if (first.kind === "step") assert.deepEqual(first.dig.map((p) => p.y), [66, 65, 64]);
});

test("water or lava beside the way stops it, and says where", () => {
  const side = walkDown(ground({ "2,64,1": "water" }));
  assert.deepEqual(side.end, { kind: "blocked", detail: "water behind the wall" });
  const below = walkDown(ground({ "1,63,0": "lava" }));
  assert.deepEqual(below.end, { kind: "blocked", detail: "lava below" });
  const ahead = walkDown(ground({ "3,63,0": "water" }));
  assert.equal(ahead.end.kind, "blocked");
});

test("a player's build refuses it at once, and a hollow below blocks it", () => {
  const built = planStep(ground({ "2,62,1": "crafting_table" }), { x: 0, y: 65, z: 0 }, east, can);
  assert.equal(built.kind, "refused");
  const planks = planStep(ground({ "1,64,0": "oak_planks" }), { x: 0, y: 65, z: 0 }, east, can);
  assert.equal(planks.kind, "refused");
  const hollow = planStep(ground({ "1,63,0": "air" }), { x: 0, y: 65, z: 0 }, east, can);
  assert.deepEqual(hollow, { kind: "blocked", detail: "a hollow below" });
  const sand = planStep(ground({ "1,65,0": "dirt", "1,66,0": "gravel" }), { x: 0, y: 65, z: 0 }, east, can);
  assert.equal(sand.kind, "blocked");
  const rock = planStep(ground({ "1,64,0": "bedrock" }), { x: 0, y: 65, z: 0 }, east, (n) => n !== "bedrock");
  assert.equal(rock.kind, "blocked");
});

test("it stops at stone it is standing on or about to walk into, and unloaded ground is not known", () => {
  assert.equal(planStep(ground(), { x: 0, y: 61, z: 0 }, east, can).kind, "stop");
  assert.equal(planStep(ground({ "1,62,0": "stone" }), { x: 0, y: 62, z: 0 }, east, can).kind, "stop");
  // stone where the step would land: walk on level onto it, and the next look finds it underfoot
  const level = planStep(ground({ "1,61,0": "stone" }), { x: 0, y: 62, z: 0 }, east, can);
  assert.equal(level.kind, "step");
  assert.equal(level.kind === "step" && level.level, true);
  const dark: Grid = { name: () => null, solid: () => false };
  assert.equal(planStep(dark, { x: 0, y: 65, z: 0 }, east, can).kind, "blocked");
});

test("it faces the way that is clear, the first of the preference on a tie", () => {
  const g = ground({ "2,64,0": "water" }); // east has water behind the wall
  const prefer = [east, { dx: 0, dz: 1 } as Facing, { dx: -1, dz: 0 } as Facing, { dx: 0, dz: -1 } as Facing];
  const c = chooseFacing(g, { x: 0, y: 65, z: 0 }, prefer, can);
  assert.deepEqual(c.facing, { dx: 0, dz: 1 });
  assert.ok(c.steps >= 3);
  const all = chooseFacing(ground({ "2,64,0": "water", "0,64,2": "water", "-2,64,0": "water", "0,64,-2": "water" }), { x: 0, y: 65, z: 0 }, prefer, can);
  assert.equal(all.steps, 0);
  assert.equal(all.first.kind, "blocked");
});

test("facings come nearest the way the body looks first", () => {
  assert.deepEqual(facingsFrom(0)[0], { dx: 0, dz: -1 }); // yaw 0 faces north
  assert.deepEqual(facingsFrom(Math.PI / 2)[0], { dx: -1, dz: 0 });
  assert.deepEqual(facingsFrom(Math.PI)[0], { dx: 0, dz: 1 });
  assert.equal(facingsFrom(1).length, 4);
});

test("the words for a dig carry no digit", () => {
  for (let n = 0; n <= MAX_STEPS; n++) assert.ok(!/\d/.test(digStatus(n)), digStatus(n));
  assert.equal(digStatus(4), "digging down, four steps");
  for (const d of [0, 1, 3, 7, 11, 30]) assert.ok(!/\d/.test(depthWords(d)));
});

// ---- the idle hand ----

test("the idle body holds a weapon with a hostile in view, else the best pickaxe, else the best axe", () => {
  const kit = ["stone_pickaxe", "iron_pickaxe", "wooden_axe", "stone_sword", "oak_sapling"];
  assert.equal(idleHold(kit, false), "iron_pickaxe");
  assert.equal(idleHold(kit, true), "stone_sword");
  assert.equal(idleHold(["wooden_axe", "stone_axe", "oak_sapling"], false), "stone_axe");
  assert.equal(idleHold(["oak_sapling", "dirt"], false), null);
  assert.equal(idleHold(["diamond_pickaxe", "netherite_pickaxe", "iron_pickaxe"], false), "netherite_pickaxe");
  assert.equal(bestTool(["wooden_pickaxe"], "axe"), null);
});

test("an equip order is not fought: the pin holds while the item is in hand or the order is new", () => {
  pinHand("oak_sapling", 1_000);
  assert.equal(holdsPin("oak_sapling", 100_000), true); // it is in the hand
  assert.equal(holdsPin("iron_pickaxe", 1_500), true); // the swap has not landed yet
  assert.equal(holdsPin("iron_pickaxe", 100_000), false); // something else took the hand: the pin is dropped
  assert.equal(holdsPin("oak_sapling", 100_001), false);
});
