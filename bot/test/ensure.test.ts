// `ensure`'s plan: what is taken from the landing chest and crafted, and what is still lacking, on made-up packs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFrame } from "../src/api/protocol";
import { buildIntent } from "../src/mcp/skills";
import { lacksWords, planEnsure, type Counts, type EnsureInput, type Part } from "../src/behaviors/ensure-plan";

const foods = { bread: 5, cooked_beef: 8, apple: 4 };
const plan = (what: EnsureInput["what"], pack: Counts, chest: Counts = {}, over: Partial<EnsureInput> = {}): Part[] =>
  planEnsure({ what, pack, chest, good: 0, foods, ...over });
const stepsOf = (p: Part[]) => p.flatMap((x) => x.steps.map((s) => `${s.do} ${s.item} ${s.count}`));

test("a pickaxe in the chest is taken, the best first", () => {
  const [p] = plan("pickaxe", {}, { stone_pickaxe: 1, iron_pickaxe: 1 });
  assert.deepEqual(stepsOf([p]), ["take iron_pickaxe 1"]);
  assert.deepEqual(p.lacks, {});
});

test("with none to take, a stone pickaxe is crafted from cobblestone and the sticks it keeps", () => {
  const [p] = plan("pickaxe", { cobblestone: 5, stick: 8 });
  assert.deepEqual(stepsOf([p]), ["craft stone_pickaxe 1"]);
  // cobblestone and sticks in the chest are taken first
  const [q] = plan("pickaxe", {}, { cobblestone: 20, stick: 8 });
  assert.deepEqual(stepsOf([q]), ["take cobblestone 3", "take stick 2", "craft stone_pickaxe 1"]);
  // at depth the stone it stored is deepslate
  const [d] = plan("pickaxe", { stick: 2 }, { cobbled_deepslate: 30 });
  assert.deepEqual(stepsOf([d]), ["take cobbled_deepslate 3", "craft stone_pickaxe 1"]);
});

test("three iron ingots make an iron pickaxe, from the pack or the chest", () => {
  assert.deepEqual(stepsOf(plan("pickaxe", { iron_ingot: 3, stick: 2, cobblestone: 9 })), ["craft iron_pickaxe 1"]);
  assert.deepEqual(stepsOf(plan("pickaxe", { iron_ingot: 1, stick: 2 }, { iron_ingot: 4 })), ["take iron_ingot 2", "craft iron_pickaxe 1"]);
  // two ingots are not enough: it falls back to stone
  assert.deepEqual(stepsOf(plan("pickaxe", { iron_ingot: 2, stick: 2, cobblestone: 3 })), ["craft stone_pickaxe 1"]);
});

test("sticks come from planks when none are held, and it says what it lacks when it cannot", () => {
  assert.deepEqual(stepsOf(plan("pickaxe", { cobblestone: 3, oak_planks: 4 })), ["craft stick 4", "craft stone_pickaxe 1"]);
  const [none] = plan("pickaxe", { cobblestone: 3 });
  assert.deepEqual(none.steps, []);
  assert.deepEqual(none.lacks, { stick: 2 });
  const [stoneless] = plan("pickaxe", { stick: 4, cobblestone: 1 });
  assert.deepEqual(stoneless.lacks, { cobblestone: 2 });
  assert.equal(lacksWords({ cobblestone: 2, stick: 2 }), "short of cobblestone and stick");
  assert.equal(lacksWords({}), "");
});

test("a pickaxe it has with life left is not made again, and count asks for more", () => {
  assert.deepEqual(plan("pickaxe", { stone_pickaxe: 1, cobblestone: 9, stick: 8 }, {}, { good: 1 })[0].steps, []);
  const two = plan("pickaxe", { cobblestone: 9, stick: 8 }, {}, { count: 2 })[0];
  assert.deepEqual(stepsOf([two]), ["craft stone_pickaxe 1", "craft stone_pickaxe 1"]);
  // the second one has the sticks of the first taken off
  const short = plan("pickaxe", { cobblestone: 9, stick: 3 }, {}, { count: 2 })[0];
  assert.deepEqual(stepsOf([short]), ["craft stone_pickaxe 1"]);
  assert.deepEqual(short.lacks, { stick: 1 });
});

test("torches: the chest first, then coal and sticks, four to a craft, and never the last two sticks", () => {
  assert.deepEqual(plan("torches", { torch: 16 })[0].steps, []);
  assert.deepEqual(stepsOf(plan("torches", { torch: 4 }, { torch: 20 })), ["take torch 12"]);
  assert.deepEqual(stepsOf(plan("torches", { torch: 12, coal: 2, stick: 8 })), ["craft torch 4"]);
  assert.deepEqual(stepsOf(plan("torches", {}, { torch: 5, coal: 8, stick: 8 })), ["take torch 5", "take coal 3", "take stick 3", "craft torch 12"]);
  const sticks = plan("torches", { coal: 8, stick: 3 })[0];
  assert.deepEqual(stepsOf([sticks]), ["craft torch 4"]); // one craft: the reserve of two stays
  assert.deepEqual(sticks.lacks, { stick: 3 });
  const short = plan("torches", { torch: 16 }, { coal: 4, stick: 6 }, { count: 40 })[0];
  assert.deepEqual(stepsOf([short]), ["take coal 4", "take stick 4", "craft torch 16"]);
  assert.deepEqual(short.lacks, { coal: 2, stick: 2 }); // six crafts asked, four made: the lack is what is still missing, not all of it
  const coalless = plan("torches", { stick: 8 })[0];
  assert.deepEqual(coalless.steps, []);
  assert.deepEqual(coalless.lacks, { coal: 4 });
  // charcoal does as coal does
  assert.deepEqual(stepsOf(plan("torches", { torch: 12, charcoal: 1, stick: 8 })), ["craft torch 4"]);
});

test("food: the best in the chest first, up to the count, and the shortfall is a count of food", () => {
  assert.deepEqual(plan("food", { bread: 16 })[0].steps, []);
  assert.deepEqual(stepsOf(plan("food", { bread: 10 }, { apple: 9, cooked_beef: 4 })), ["take cooked_beef 4", "take apple 2"]);
  const none = plan("food", { rotten_flesh: 5, spider_eye: 2 })[0]; // not food it would eat
  assert.deepEqual(none.steps, []);
  assert.deepEqual(none.lacks, { food: 16 });
  assert.deepEqual(plan("food", { bread: 3 }, { bread: 2 }, { count: 8 })[0].lacks, { food: 3 });
});

test("a kit is a spare pickaxe, torches and food in one plan, each on what the one before leaves", () => {
  const parts = plan("kit", { stone_pickaxe: 1, cobblestone: 3, stick: 4, coal: 1, bread: 4 }, { torch: 9, cooked_beef: 20 }, { good: 1 });
  assert.deepEqual(parts.map((p) => p.what), ["pickaxe", "torches", "food"]);
  // the spare takes two of the four sticks, so the torches find none over the reserve: they take the chest's nine and lack the rest
  assert.deepEqual(stepsOf(parts), ["craft stone_pickaxe 1", "take torch 9", "take cooked_beef 12"]);
  assert.deepEqual(parts.map((p) => p.lacks), [{}, { coal: 1, stick: 2 }, {}]);
});

// ---- the wire ----

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

test("parseFrame: ensure takes a what, a count for all but a kit, and nothing else", () => {
  assert.ok(ok({ intent: "ensure", what: "pickaxe" }));
  assert.ok(ok({ intent: "ensure", what: "torches", count: 24 }));
  assert.ok(ok({ intent: "ensure", what: "kit" }));
  assert.ok(!ok({ intent: "ensure", what: "kit", count: 2 }));
  assert.ok(!ok({ intent: "ensure" }));
  assert.ok(!ok({ intent: "ensure", what: "diamonds" }));
  assert.ok(!ok({ intent: "ensure", what: "food", count: 0 }));
  assert.ok(!ok({ intent: "ensure", what: "food", item: "bread" }));
});

test("the adapter builds ensure and refuses what the body would", () => {
  assert.deepEqual(buildIntent("ensure", { what: "kit" }), { ok: true, fields: { intent: "ensure", what: "kit" } });
  assert.deepEqual(buildIntent("ensure", { what: "torches", count: 8 }), { ok: true, fields: { intent: "ensure", what: "torches", count: 8 } });
  assert.equal(buildIntent("ensure", {}).ok, false);
  assert.equal(buildIntent("ensure", { what: "gold" }).ok, false);
  assert.equal(buildIntent("ensure", { what: "kit", count: 3 }).ok, false);
  assert.equal(buildIntent("craft", { item: "torch", what: "kit" }).ok, false);
});
