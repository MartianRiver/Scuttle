import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { planPut, type PutView } from "../src/behaviors/put-plan";
import { readSheep, shearRefusal } from "../src/behaviors/shear-plan";
import { overheadOf, skyNow, SCAN } from "../src/lib/cell-light";
import { check, handsPlaceable, isSapling, PLACEABLE, placeable, SAPLINGS, type Op, type Pos, type World } from "../src/lib/policy";

// ---- the allowlist: saplings and nothing else ----

test("allowlist: against every item in the game, the hands set down what they did before plus these saplings", () => {
  const items = (createRequire(__filename)("minecraft-data")("26.3").itemsArray as Array<{ name: string }>).map((i) => i.name);
  // the rule as it stood before saplings: the stair's fill and the fixtures
  const before = (n: string) => (PLACEABLE as readonly string[]).includes(n) || /^(crafting_table|furnace|chest|torch|\w+_bed)$/.test(n);
  const was = items.filter((n) => before(n) && n !== "stone").sort();
  const now = items.filter((n) => handsPlaceable(n)).sort();
  assert.deepEqual(now, [...was, ...SAPLINGS].sort());
  assert.deepEqual(items.filter((n) => placeable(n)).sort(), [...items.filter(before), ...SAPLINGS].sort());
  assert.ok(SAPLINGS.every((s) => items.includes(s)), "every sapling named exists");
  assert.deepEqual([...PLACEABLE], ["dirt", "stone", "netherrack", "cobbled_deepslate", "cobblestone"], "the stair's fill is untouched");
  for (const n of ["pale_oak_sapling", "azalea", "flowering_azalea", "mangrove_propagule", "wheat_seeds", "dandelion", "bone_meal", "tnt", "water_bucket", "fire_charge"]) assert.equal(handsPlaceable(n), false, n);
});

// ---- the gate on a sapling ----

const T: Pos = { x: 10, y: 70, z: 10 };
const world = (ground: string, light: number | null | undefined, over: Partial<World> = {}): World => ({
  nameAt: (p) => (p.y === T.y - 1 ? ground : "air"),
  solidAt: (p) => p.y === T.y - 1,
  ...(light !== undefined && { lightAt: () => light }),
  ...over,
});
const sapling = (over: Partial<Op> = {}): Op => ({ kind: "place", pos: T, against: { ...T, y: T.y - 1 }, block: "oak_sapling", job: "t", ...over });
const verdict = (op: Op, w: World) => {
  const v = check(op, w, { strict: true });
  return v.ok ? "ok" : `${v.reason}: ${v.detail}`;
};

test("gate: a sapling goes on the five grounds, in light 9 or more, on top of the ground", () => {
  for (const g of ["grass_block", "dirt", "podzol", "coarse_dirt", "rooted_dirt"]) assert.equal(verdict(sapling(), world(g, 15)), "ok", g);
  assert.equal(verdict(sapling(), world("grass_block", 9)), "ok");
  assert.match(verdict(sapling(), world("grass_block", 8)), /^not_allowed: .*dark/);
  for (const g of ["stone", "sand", "mycelium", "farmland", "oak_planks", "moss_block"]) assert.match(verdict(sapling(), world(g, 15)), /^not_allowed: .*grass or dirt/, g);
  assert.match(verdict(sapling({ against: { x: 11, y: T.y, z: 10 } }), world("grass_block", 15, { solidAt: () => true, nameAt: () => "grass_block" })), /^not_allowed/, "against a side");
  assert.match(verdict(sapling(), world("grass_block", undefined)), /^unknown/, "light not known is not guessed");
  assert.match(verdict(sapling(), world("grass_block", null)), /^unknown/);
});

test("gate: a sapling still passes every other rule: a made block near, a kept zone, someone standing there, the budget", () => {
  const house: World = world("grass_block", 15, { nameAt: (p) => (p.y === T.y - 1 ? "grass_block" : p.x === T.x + 2 && p.y === T.y ? "oak_planks" : "air") });
  assert.match(verdict(sapling(), house), /^player_built/);
  assert.match(verdict(sapling(), world("grass_block", 15, { zonesAt: () => ["reverted"] })), /^protected/);
  assert.match(verdict(sapling(), world("grass_block", 15, { occupied: () => true })), /^not_allowed: someone/);
  assert.match(verdict(sapling(), world("grass_block", 15, { budgetLeft: () => false })), /^not_allowed: it has set down enough/);
  assert.match(verdict(sapling({ pos: { ...T, y: T.y }, block: "oak_sapling" }), world("grass_block", 15, { nameAt: (p) => (p.y === T.y ? "stone" : "grass_block") })), /something is already there/);
});

test("gate: the ground and light rule is for saplings only; a torch or dirt asks neither", () => {
  assert.equal(verdict(sapling({ block: "torch" }), world("stone", undefined)), "ok");
  assert.equal(verdict(sapling({ block: "dirt" }), world("stone", undefined)), "ok");
  assert.ok(isSapling("oak_sapling") && !isSapling("oak_planks"));
});

// ---- the cell it picks ----

function field(ground: string, light: number | null, put: Record<string, string> = {}): PutView {
  const name = (p: Pos): string => put[`${p.x},${p.y},${p.z}`] ?? (p.y <= 63 ? ground : "air");
  return {
    eye: { x: 0.5, y: 64.62, z: 0.5 },
    feet: { x: 0, y: 64, z: 0 },
    facing: { dx: 1, dz: 0 },
    nameAt: name,
    lightAt: () => light,
    solid: (p) => p.y <= 63,
    occupied: () => false,
  };
}

test("plan: a sapling is planted ahead on grass; a stone floor or a dark cell is no_room, never a refusal", () => {
  const ok = planPut("oak_sapling", { kind: "ahead" }, field("grass_block", 15));
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.spot.cell, { x: 1, y: 64, z: 0 });
  for (const g of ["podzol", "coarse_dirt", "rooted_dirt", "dirt"]) assert.ok(planPut("birch_sapling", { kind: "here" }, field(g, 12)).ok, g);

  const stone = planPut("oak_sapling", { kind: "here" }, field("stone", 15));
  assert.deepEqual(stone.ok ? null : stone.reason, "no_room");
  assert.match(stone.ok ? "" : stone.detail, /grass or dirt/);
  const dark = planPut("oak_sapling", { kind: "here" }, field("grass_block", 4));
  assert.deepEqual(dark.ok ? null : dark.reason, "no_room");
  assert.match(dark.ok ? "" : dark.detail, /too dark/);
  assert.equal(planPut("oak_sapling", { kind: "here" }, field("grass_block", null)).ok, false, "unknown light");
});

test("plan: on a block puts the sapling on top of that block, only if it is grass or dirt", () => {
  const v = field("grass_block", 15, { "3,63,0": "stone", "2,63,0": "dirt" });
  assert.equal(planPut("spruce_sapling", { kind: "on", target: { x: 3, y: 63, z: 0 } }, v).ok, false);
  const p = planPut("spruce_sapling", { kind: "on", target: { x: 2, y: 63, z: 0 } }, v);
  assert.ok(p.ok && p.spot.cell.x === 2 && p.spot.cell.y === 64);
  assert.equal(planPut("oak_sapling", { kind: "wall" }, v).ok, false, "only a torch goes on a wall");
});

test("plan: the other items are planned as before, whatever the ground and light", () => {
  assert.ok(planPut("crafting_table", { kind: "here" }, field("stone", 0)).ok);
  assert.ok(planPut("torch", { kind: "here" }, field("sand", 0)).ok);
});

// ---- shear ----

const KEYS = ["shared_flags", "air_supply", "custom_name", "custom_name_visible", "silent", "no_gravity", "pose", "ticks_frozen", "living_entity_flags", "health", "effect_particles", "effect_ambience", "arrow_count", "stinger_count", "sleeping_pos", "mob_flags", "baby", "age_locked", "wool"];
const meta = (set: Record<number, unknown>): unknown[] => Object.assign([] as unknown[], set);

test("shear: an adult with wool passes; a lamb, a shorn sheep and anything else do not", () => {
  const adult = readSheep(meta({ 18: 0 }), KEYS);
  assert.deepEqual(adult, { baby: false, sheared: false });
  assert.equal(shearRefusal("sheep", adult), null);
  assert.equal(shearRefusal("sheep", readSheep(meta({}), KEYS)), null, "slots not sent are the defaults");
  assert.equal(shearRefusal("sheep", readSheep(meta({ 18: 5 }), KEYS)), null, "a coloured sheep, bit 4 clear");
  assert.equal(shearRefusal("sheep", readSheep(meta({ 16: true }), KEYS))?.reason, "refused");
  assert.equal(shearRefusal("sheep", readSheep(meta({ 18: 0x10 }), KEYS))?.reason, "no_wool");
  assert.equal(shearRefusal("sheep", readSheep(meta({ 18: 0x10 | 14 }), KEYS))?.reason, "no_wool", "a shorn red sheep");
  assert.equal(shearRefusal("sheep", readSheep(meta({ 16: true, 18: 0x10 }), KEYS))?.reason, "refused");
  assert.equal(shearRefusal("cow", adult)?.reason, "not_allowed");
  assert.equal(shearRefusal(undefined, adult)?.reason, "not_allowed");
  assert.equal(readSheep(meta({}), undefined), null, "no key names: not guessed");
  assert.equal(shearRefusal("sheep", readSheep(meta({}), ["baby"]))?.reason, "stuck");
});

// ---- the API ----

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

test("parseFrame: shear takes a mob handle and nothing else", () => {
  assert.ok(ok({ intent: "shear", handle: "e12ab" }));
  assert.ok(!ok({ intent: "shear", handle: "b12ab" }));
  assert.ok(!ok({ intent: "shear", handle: "home" }));
  assert.ok(!ok({ intent: "shear" }));
  assert.ok(!ok({ intent: "shear", handle: "e12ab", count: 2 }));
  assert.ok(ok({ intent: "place", item: "oak_sapling", where: "ahead" }));
});

function stub(over: Partial<BodyControl> = {}): BodyControl {
  const never = () => new Promise<never>(() => {});
  return {
    inGame: () => true,
    fighting: () => false,
    danger: () => false,
    busy: () => false,
    canSee: () => true,
    vitals: () => ({ health: 20, food: 20 }),
    comeTo: never,
    follow: () => {},
    guard: never,
    give: never,
    goTo: never,
    handleLabel: (h) => (h === "e3ab" ? "a sheep" : null),
    observe: () => ({ health: 20, food: 20, weather: "clear", where: "x", held: null, inv: {}, near: [], blocks: [] }),
    runTask: never,
    runAction: never,
    knowsItem: () => true,
    recipe: () => null,
    stash: () => ({ items: {}, fresh: true, looked: "never" }),
    equip: () => true,
    placementOn: () => true,
    canExplore: () => true,
    say: () => "sent",
    stop: () => {},
    interrupt: () => {},
    ...over,
  };
}

test("dispatch: shear is off with placing, wants a live sheep handle, and is one action at a time", () => {
  const off = createDispatcher(stub({ placementOn: () => false }), new EventLog());
  assert.deepEqual(off.handle({ intent: "shear", handle: "e3ab" }), { kind: "rejected", reason: "not_enabled" });
  const on = createDispatcher(stub(), new EventLog());
  assert.deepEqual(on.handle({ intent: "shear", handle: "e9zz" }), { kind: "rejected", reason: "stale_handle" });
  assert.equal(on.handle({ intent: "shear", handle: "e3ab" }).kind, "accepted");
  assert.deepEqual(on.handle({ intent: "shear", handle: "e3ab" }), { kind: "rejected", reason: "busy" });
});

// ---- light ----

const column = (blocks: Record<number, string>, solid: (n: string) => boolean = (n) => !/^(air|cave_air|short_grass)$/.test(n) && !n.endsWith("_leaves")) =>
  (dy: number) => ({ name: blocks[dy] ?? "air", solid: solid(blocks[dy] ?? "air") });

test("light: open sky reads 15 whatever the data says, a roof caps the sky at 8, leaves leave it to the data", () => {
  assert.equal(overheadOf(column({})), "open");
  assert.equal(skyNow("open", 0), 15, "stale data from before the roof came off");
  assert.equal(overheadOf(column({ 3: "stone" })), "roof");
  assert.equal(skyNow("roof", 15), 8, "stale data from before the roof went on");
  assert.equal(skyNow("roof", 2), 2, "and data that is darker still stays");
  assert.equal(overheadOf(column({ 2: "oak_leaves", 3: "oak_leaves" })), "leaves");
  assert.equal(skyNow("leaves", 12), 12);
  assert.equal(overheadOf(column({ 2: "oak_leaves", 5: "stone" })), "roof", "a roof over the leaves still counts");
  assert.equal(overheadOf(column({ 1: "short_grass" }, () => false)), "open", "a plant over it is not a roof");
});

test("light: only what is within the scan counts as over it, and an unloaded cell ends the look", () => {
  assert.equal(overheadOf(column({ [SCAN]: "stone" })), "roof");
  assert.equal(overheadOf(column({ [SCAN + 1]: "stone" })), "open");
  assert.equal(overheadOf((dy) => (dy < 3 ? { name: "air", solid: false } : null)), "open");
});
