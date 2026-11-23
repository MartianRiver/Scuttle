import assert from "node:assert/strict";
import { test } from "node:test";
import { directionWords, distanceBand, durabilityLeft, healthBand, mobHealthBand, timeWords, weatherWords } from "../src/senses/bands";
import { fitBudget } from "../src/senses/budget";
import { compose, OBSERVATION_MAX_CHARS, type RawSense } from "../src/senses/compose";
import { HANDLE_SHAPE, HandleTable, isPlace } from "../src/senses/handles";
import { blockKind } from "../src/senses/notable";
import { blockVisible, entityVisible, hasOpenFace, rayClear, type Opaque } from "../src/senses/sight";

// ---- bands ----

test("distance bands and directions are words, with up and down", () => {
  assert.equal(distanceBand(0), "here");
  assert.equal(distanceBand(3), "here");
  assert.equal(distanceBand(6), "close");
  assert.equal(distanceBand(16), "near");
  assert.equal(distanceBand(17), "far");
  assert.equal(distanceBand(40), "a short walk");
  assert.equal(distanceBand(1e6), "very far");

  assert.equal(directionWords(6, 0, 0), "east");
  assert.equal(directionWords(0, 0, -9), "north");
  assert.equal(directionWords(-5, 0, 5), "south-west");
  assert.equal(directionWords(6, 4, 0), "east above");
  assert.equal(directionWords(6, -3, 6), "south-east below");
  assert.equal(directionWords(6, 2, 0), "east"); // a step up is not "above"
  assert.equal(directionWords(0.4, 5, -0.5), "above");
  assert.equal(directionWords(0.4, 0, -0.5), "here");
});

test("time of day, weather, health band, durability", () => {
  assert.equal(timeWords(0), "day");
  assert.equal(timeWords(6000), "day");
  assert.equal(timeWords(12500), "dusk");
  assert.equal(timeWords(18000), "night");
  assert.equal(timeWords(23500), "dawn");
  assert.equal(timeWords(24000 + 18000), "night");
  assert.equal(weatherWords(0, 0), "clear");
  assert.equal(weatherWords(0.05, 0), "clear"); // still fading out
  assert.equal(weatherWords(1, 0), "rain");
  assert.equal(weatherWords(1, 1), "thunder");
  assert.equal(healthBand(20, 20), "full");
  assert.equal(healthBand(10, 20), "hurt");
  assert.equal(healthBand(4, 20), "low");
  assert.equal(mobHealthBand("cow", 10), "full");
  assert.equal(mobHealthBand("cow", 4), "low");
  assert.equal(mobHealthBand("zombie", 12), "hurt");
  assert.equal(mobHealthBand("ender_dragon", 100), undefined); // not in the table
  assert.equal(mobHealthBand("cow", undefined), undefined);
  assert.equal(durabilityLeft(0, 250), 100);
  assert.equal(durabilityLeft(125, 250), 50);
  assert.equal(durabilityLeft(250, 250), 0);
  assert.equal(durabilityLeft(300, 250), 0);
});

// ---- sight ----

// a world as a set of solid cells; everything else is air
const world = (solid: string[]): Opaque => {
  const set = new Set(solid);
  return (x, y, z) => set.has(`${x},${y},${z}`);
};
const eye = { x: 0.5, y: 1.6, z: 0.5 };

test("rayClear: open air is clear, a block between is not, the end cells are the caller's", () => {
  const open = world([]);
  assert.ok(rayClear(eye, { x: 10.5, y: 1.5, z: 0.5 }, open));
  const wall = world(["5,1,0", "5,2,0", "5,0,0"]);
  assert.ok(!rayClear(eye, { x: 10.5, y: 1.5, z: 0.5 }, wall));
  assert.ok(rayClear(eye, { x: 10.5, y: 1.5, z: 5.5 }, wall)); // walks round it
  assert.ok(rayClear(eye, { x: 5.5, y: 1.5, z: 0.5 }, wall)); // ends inside the wall's own cell: not tested
  // diagonals and steep rays
  assert.ok(rayClear(eye, { x: 8.5, y: 9.5, z: 8.5 }, open));
  assert.ok(!rayClear(eye, { x: 8.5, y: 1.5, z: 8.5 }, world(["4,1,4"])));
  assert.ok(!rayClear({ x: 0.5, y: 10.5, z: 0.5 }, { x: 0.5, y: 0.5, z: 0.5 }, world(["0,5,0"])));
  // a ray along an exact cell edge terminates and does not wander
  assert.ok(rayClear({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }, open));
});

test("entityVisible: seen in the open, hidden behind a wall that covers it, seen over a low one", () => {
  const feet = { x: 12.5, y: 0, z: 0.5 };
  const wallOf = (h: number) => world(Array.from({ length: h }, (_, y) => `8,${y},0`));
  assert.ok(entityVisible(eye, feet, 1.95, world([])));
  assert.ok(!entityVisible(eye, feet, 1.95, wallOf(3)));
  // a one-block fence: the head clears it
  assert.ok(entityVisible({ x: 0.5, y: 1.62, z: 0.5 }, { x: 12.5, y: 1, z: 0.5 }, 1.95, wallOf(1)));
});

test("blockVisible: needs an open face toward the eye and a clear ray", () => {
  const ore = { x: 6, y: 1, z: 0 };
  assert.ok(blockVisible(eye, ore, world([])));
  // buried: every face has rock against it
  const buried = world(["5,1,0", "7,1,0", "6,0,0", "6,2,0", "6,1,1", "6,1,-1"]);
  assert.ok(!hasOpenFace(ore, buried));
  assert.ok(!blockVisible(eye, ore, buried));
  // open on the far side only: the face points away from the eye
  const farFace = world(["5,1,0", "6,0,0", "6,2,0", "6,1,1", "6,1,-1"]);
  assert.ok(hasOpenFace(ore, farFace));
  assert.ok(!blockVisible(eye, ore, farFace));
  // open on top, the eye above it: seen
  const topOpen = world(["5,1,0", "7,1,0", "6,0,0", "6,1,1", "6,1,-1"]);
  assert.ok(blockVisible({ x: 5.5, y: 4.5, z: 0.5 }, ore, topOpen));
  // an open face and a wall in the way
  assert.ok(!blockVisible(eye, ore, world(["3,0,0", "3,1,0", "3,2,0"])));
  assert.ok(!blockVisible(eye, ore, world(["3,0,0", "3,1,0", "3,2,0", "3,3,0", "3,-1,0"])));
});

// ---- handles ----

test("handles: reused while seen, expire after the ttl, fixed places never do, another process's never match", () => {
  let t = 0;
  const table = new HandleTable({ tag: "kq", now: () => t, ttlMs: 1000 });
  const cow = table.mint({ kind: "entity", id: 77, label: "the cow" });
  const ore = table.mint({ kind: "block", x: 1, y: 2, z: 3, name: "diamond_ore" });
  assert.match(cow, /^e\d+kq$/);
  assert.match(ore, /^b\d+kq$/);
  assert.ok(HANDLE_SHAPE.test(cow) && HANDLE_SHAPE.test(ore));
  assert.equal(table.mint({ kind: "entity", id: 77, label: "the cow" }), cow);
  assert.equal(table.resolve(cow)?.kind, "entity");

  t = 900;
  table.mint({ kind: "entity", id: 77, label: "the cow" }); // seen again, so fresh again
  t = 1500;
  assert.ok(table.resolve(cow));
  assert.equal(table.resolve(ore), null); // not seen since 0
  assert.equal(table.resolve("e99kq"), null);
  t = 3000;
  assert.equal(table.resolve(cow), null);
  const again = table.mint({ kind: "entity", id: 77, label: "the cow" });
  assert.ok(table.resolve(again));

  for (const p of ["home", "table", "stash", "furnace", "bed"]) assert.ok(isPlace(p) && HANDLE_SHAPE.test(p));
  assert.ok(!isPlace("e1kq"));

  // a restart is a new table with a new tag; the old handle is a different string even for the same counter
  const before = new HandleTable({ tag: "kq" }).mint({ kind: "entity", id: 5, label: "x" });
  const after = new HandleTable({ tag: "zr" });
  after.mint({ kind: "entity", id: 5, label: "y" });
  assert.equal(after.resolve(before), null);
});

test("handles: the table is capped and drops the oldest", () => {
  const table = new HandleTable({ tag: "ab" });
  const first = table.mint({ kind: "entity", id: 1, label: "a" });
  let last = first;
  for (let i = 2; i < 400; i++) last = table.mint({ kind: "entity", id: i, label: "a" });
  assert.equal(table.resolve(first), null);
  assert.ok(table.resolve(last));
});

// ---- budget and composition ----

test("fitBudget takes from the longest list first and says what it took", () => {
  const lists = { a: Array.from({ length: 20 }, (_, i) => i), b: [1, 2], c: [1, 2, 3] };
  const render = (l: typeof lists, trimmed: Record<string, number>) => ({ ...l, ...(Object.keys(trimmed).length && { more: { ...trimmed } }) });
  const { out, trimmed } = fitBudget(lists, render, 55);
  assert.ok(JSON.stringify(out).length <= 55);
  assert.ok((trimmed.a ?? 0) >= 1);
  assert.equal(trimmed.b, undefined);
  assert.equal(lists.a.length, 20, "the input is left alone");
  // nothing fits: it empties every list and stops rather than looping
  const none = fitBudget(lists, render, 5);
  assert.deepEqual(none.out.a, []);
  assert.deepEqual(none.out.b, []);
});

const here = { dx: 0, dy: 0, dz: 0 };
function raw(over: Partial<RawSense> = {}): RawSense {
  return {
    health: 20,
    food: 18,
    armor: 0,
    time: "day",
    weather: "clear",
    where: "at home, on the surface",
    held: "iron_pickaxe",
    items: [
      { name: "oak_log", count: 12 },
      { name: "cobblestone", count: 40 },
    ],
    tools: [{ name: "iron_pickaxe", left: 87 }],
    entities: [{ handle: "e1kq", what: "cow", kind: "other", dx: 6, dy: 0, dz: 0 }],
    blocks: [{ handle: "b2kq", what: "chest", dx: -3, dy: 0, dz: 5 }],
    places: [{ name: "home", ...here }, { name: "table", dx: 0, dy: 0, dz: -4 }],
    ...over,
  };
}

test("compose: words and handles, optional fields left out when empty", () => {
  const o = compose(raw());
  assert.deepEqual(o.near, [{ h: "e1kq", what: "cow", d: "close", dir: "east" }]);
  assert.deepEqual(o.blocks, [{ h: "b2kq", what: "chest", d: "close", dir: "south-west" }]);
  assert.deepEqual(o.inv, { cobblestone: 40, oak_log: 12 });
  assert.deepEqual(o.tools, ["iron_pickaxe 87%"]);
  assert.equal(o.armor, undefined);
  assert.equal(o.more, undefined);
  assert.equal(o.places?.home, "here");
  assert.equal(o.places?.table, "close north");
  const bare = compose(raw({ tools: [], time: null, places: null, armor: 7 }));
  assert.equal(bare.tools, undefined);
  assert.equal(bare.time, undefined);
  assert.equal(bare.places, undefined);
  assert.equal(bare.armor, 7);
});

test("compose: hostile mobs and players come first, far animals are trimmed first", () => {
  const entities: RawSense["entities"] = [
    { handle: "e1kq", what: "cow", kind: "other", dx: 2, dy: 0, dz: 0 },
    { handle: "e2kq", what: "zombie", kind: "hostile", dx: 20, dy: 0, dz: 0 },
    { handle: "e3kq", what: "Sam", kind: "player", dx: 30, dy: 0, dz: 0 },
  ];
  const o = compose(raw({ entities }));
  assert.deepEqual(o.near.map((e) => e.what), ["Sam", "zombie", "cow"]);
  assert.equal(o.near[0].k, "player");
  assert.equal(o.near[1].k, "hostile");
  assert.equal(o.near[2].k, undefined);
});

// worse than anything a real inventory and a busy field could hand it
function worst(): RawSense {
  const items = Array.from({ length: 36 }, (_, i) => ({ name: `some_long_item_name_${i}`, count: 64 - i }));
  const tools = Array.from({ length: 9 }, (_, i) => ({ name: `netherite_pickaxe_${i}`, left: 50 + i }));
  const kinds = ["hostile", "other", "player"] as const;
  const entities = Array.from({ length: 40 }, (_, i) => ({
    handle: `e${i + 100}kq`,
    what: `a_mob_with_a_long_name_${i}`,
    kind: kinds[i % 3],
    dx: -20 + i,
    dy: i % 7 === 0 ? 5 : 0,
    dz: 30 - i,
    hp: "hurt" as const,
  }));
  const blocks = Array.from({ length: 60 }, (_, i) => ({ handle: `b${i + 100}kq`, what: `deepslate_diamond_ore`, dx: i - 20, dy: -3, dz: 10 - i }));
  return raw({ items, tools, entities, blocks, armor: 20, held: "netherite_pickaxe_0", where: "deep underground" });
}

test("compose: a worst case stays inside the budget, says what was left off and keeps the fixed part", () => {
  const o = compose(worst());
  const json = JSON.stringify(o);
  assert.ok(json.length <= OBSERVATION_MAX_CHARS, `${json.length} chars`);
  assert.ok(o.more && Object.keys(o.more).length > 0);
  for (const [list, n] of Object.entries(o.more!)) assert.ok(n > 0, list);
  assert.equal(o.places && Object.keys(o.places).length, 2); // places are never trimmed
  assert.equal(o.health, 20);
  // nearest-first inside a kind: what stays is the head of each list
  assert.equal(o.near[0].k, "player");

  // even a budget smaller than the fixed part ends, with every list empty
  const tiny = compose(worst(), 10);
  assert.deepEqual(tiny.near, []);
  assert.deepEqual(tiny.blocks, []);
  assert.deepEqual(tiny.inv, {});
});

test("compose: no coordinate leaves it, whatever the offsets are", () => {
  // offsets are what the body reads (a position minus its own); the numbers here are chosen so that
  // none could be mistaken for a count, a handle or a health value
  const dx = 7312;
  const dz = -9461;
  const o = compose(
    raw({
      entities: [{ handle: "e1kq", what: "zombie", kind: "hostile", dx, dy: 0, dz }],
      blocks: [{ handle: "b1kq", what: "diamond_ore", dx: dz, dy: 0, dz: dx }],
      places: [{ name: "home", dx, dy: 0, dz }],
    })
  );
  const json = JSON.stringify(o);
  for (const n of ["7312", "9461", "7.3", "9.4"]) assert.ok(!json.includes(n), n);
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        walk(x);
      }
    }
  };
  walk(o);
  for (const k of ["x", "y", "z", "dx", "dy", "dz", "pos", "position", "coords"]) assert.ok(!keys.has(k), `no ${k} key`);
  assert.equal(o.near[0].d, "very far");
});

test("blockKind: the short list and its kinds", () => {
  assert.equal(blockKind("chest"), "chest");
  assert.equal(blockKind("barrel"), "chest");
  assert.equal(blockKind("crafting_table"), "crafting_table");
  assert.equal(blockKind("blast_furnace"), "furnace");
  assert.equal(blockKind("red_bed"), "bed");
  assert.equal(blockKind("iron_door"), "door");
  assert.equal(blockKind("oak_trapdoor"), null);
  assert.equal(blockKind("diamond_ore"), "diamond_ore");
  assert.equal(blockKind("deepslate_iron_ore"), "deepslate_iron_ore");
  assert.equal(blockKind("water"), "water");
  assert.equal(blockKind("stone"), null);
});
