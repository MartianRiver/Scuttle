import assert from "node:assert/strict";
import { test } from "node:test";
import { distinctChests, FRESH_MS, StashMemory, storeAll, storeOne, walkOnFor, worthOpening, type Carried } from "../src/behaviors/stash-plan";

const it = (name: string, count: number, o: Partial<Carried> = {}): Carried => ({ name, count, durable: false, food: 0, ...o });

test("store everything keeps tools, food up to 16, 4 cobblestone and 4 coal", () => {
  const out = storeAll([
    it("oak_log", 40),
    it("cobblestone", 30),
    it("coal", 4),
    it("iron_pickaxe", 1, { durable: true }),
    it("bread", 10, { food: 5 }),
    it("cooked_beef", 10, { food: 8 }),
    it("raw_iron", 3),
  ]);
  assert.deepEqual(out, { oak_log: 40, cobblestone: 26, bread: 4, raw_iron: 3 });
});

test("store everything keeps 8 sticks and every torch, for picks and light below ground", () => {
  assert.deepEqual(storeAll([it("stick", 12), it("torch", 20), it("cobbled_deepslate", 64)]), { stick: 4, cobbled_deepslate: 64 });
});

test("the best food stays first, and 16 is the total", () => {
  const out = storeAll([it("bread", 20, { food: 5 }), it("cooked_beef", 12, { food: 8 })]);
  assert.deepEqual(out, { bread: 16 }); // 12 beef + 4 bread kept
});

test("nothing to spare stores nothing", () => {
  assert.deepEqual(storeAll([it("cobblestone", 4), it("stone_sword", 1, { durable: true })]), {});
});

test("store one item: all by default, up to a count, a tool when named", () => {
  const items = [it("oak_log", 7), it("oak_log", 5), it("iron_sword", 1, { durable: true })];
  assert.deepEqual(storeOne(items, "oak_log"), { oak_log: 12 });
  assert.deepEqual(storeOne(items, "oak_log", 5), { oak_log: 5 });
  assert.deepEqual(storeOne(items, "oak_log", 50), { oak_log: 12 });
  assert.deepEqual(storeOne(items, "iron_sword"), { iron_sword: 1 });
  assert.deepEqual(storeOne(items, "diamond"), {});
});

test("the stash it remembers: counts, how fresh, and chests never opened", () => {
  const m = new StashMemory();
  assert.deepEqual(m.answer(3, 0), { items: {}, fresh: false, looked: "never", unseen: 3 });
  m.note("0", { oak_log: 12, stick: 4 }, 1_000);
  const a = m.answer(3, 5_000);
  assert.deepEqual(a.items, { oak_log: 12, stick: 4 });
  assert.equal(a.fresh, false); // two chests were never opened
  assert.equal(a.unseen, 2);
  assert.equal(a.looked, "just now");
  m.note("1", { oak_log: 3 }, 2_000);
  m.note("2", {}, 3_000);
  const b = m.answer(3, 10_000);
  assert.deepEqual(b.items, { oak_log: 15, stick: 4 });
  assert.equal(b.fresh, true);
  assert.equal(b.unseen, undefined);
  assert.equal(m.answer(3, 1_000 + FRESH_MS + 1).fresh, false);
  assert.equal(m.answer(3, 3_000 + FRESH_MS + 1).looked, "a while ago");
  assert.equal(m.chestHas("0", "stick", 10_000), 4);
  assert.equal(m.chestHas("2", "stick", 10_000), 0);
  assert.equal(m.chestHas("0", "stick", 1_000 + FRESH_MS + 1), null); // too old to skip the chest on
  assert.equal(new StashMemory().chestHas("0", "stick"), null);
});

test("a new look replaces the old one for that chest", () => {
  const m = new StashMemory();
  m.note("0", { oak_log: 12 }, 0);
  m.note("0", { oak_log: 2 }, 10);
  assert.deepEqual(m.answer(1, 20).items, { oak_log: 2 });
});

test("the halves of a double chest are one place", () => {
  assert.deepEqual(distinctChests([{ x: -4, y: 68, z: -28 }, { x: 4, y: 68, z: -25 }, { x: 4, y: 68, z: -24 }]), [0, 1]);
  assert.deepEqual(distinctChests([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]), [0, 1]);
  assert.deepEqual(distinctChests([]), []);
});

test("a take skips a chest seen without the item only when it is a walk away", () => {
  const me = { x: 100, y: 10, z: 100 };
  const beside = { x: 101, y: 10, z: 100 };
  const far = { x: 350, y: 10, z: 100 };
  assert.equal(worthOpening(0, beside, me), true, "the memory may be stale, a look costs nothing");
  assert.equal(worthOpening(0, far, me), false);
  assert.equal(worthOpening(3, far, me), true);
  assert.equal(worthOpening(null, far, me), true, "never seen, or seen too long ago");
});

test("a take that holds some does not walk far for the rest", () => {
  const here = { x: 0, y: -50, z: 0 };
  assert.equal(walkOnFor(0, { x: 400, y: 67, z: 0 }, here), true); // none yet: the base chest is worth the walk
  assert.equal(walkOnFor(4, { x: 400, y: 67, z: 0 }, here), false);
  assert.equal(walkOnFor(4, { x: 20, y: -50, z: 0 }, here), true);
});
