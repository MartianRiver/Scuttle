import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { endFields, EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { TOOLS } from "../src/mcp/tools";
import { buildIntent } from "../src/mcp/skills";
import type { BodyClient } from "../src/mcp/client";
import { FakeBody, connected } from "./mcp-fake";

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

test("parseFrame: the hands intents are strict", () => {
  assert.ok(ok({ intent: "recipe", item: "crafting_table" }));
  assert.ok(!ok({ intent: "recipe", item: "minecraft:stone" }));
  assert.ok(!ok({ intent: "recipe" }));
  assert.ok(ok({ intent: "craft", item: "oak_planks", count: 16 }));
  assert.ok(!ok({ intent: "craft", item: "oak_planks", count: 65 }));
  assert.ok(!ok({ intent: "craft", item: "oak_planks", count: 0 }));
  assert.ok(!ok({ intent: "craft", count: 4 }));
  assert.ok(ok({ intent: "collect", handle: "b7kq" }));
  assert.ok(ok({ intent: "collect", handle: "b7kq", count: 16 }));
  assert.ok(!ok({ intent: "collect", handle: "b7kq", count: 17 }));
  assert.ok(!ok({ intent: "collect", handle: "e7kq" })); // a mob moves, a place is not a block to dig
  assert.ok(!ok({ intent: "collect", handle: "home" }));
  assert.ok(ok({ intent: "equip", item: "iron_chestplate" }));
  assert.ok(ok({ intent: "store" }));
  assert.ok(ok({ intent: "store", item: "oak_log", count: 5 }));
  assert.ok(!ok({ intent: "store", count: 5 })); // a count needs an item
  assert.ok(ok({ intent: "take", item: "oak_log" }));
  assert.ok(!ok({ intent: "take" }));
  assert.ok(ok({ intent: "stash" }));
  assert.ok(!ok({ intent: "stash", item: "x" }));
  assert.ok(ok({ intent: "explore", dir: "north-east" }));
  assert.ok(ok({ intent: "explore", dir: "east", far: "a fair way" }));
  assert.ok(!ok({ intent: "explore", dir: "up" }));
  assert.ok(!ok({ intent: "explore", dir: "east", far: "100" }));
  assert.ok(!ok({ intent: "explore", dir: "east", x: 5 })); // no coordinates
  assert.ok(!ok({ intent: "explore" }));
});

test("endFields: missing and stored are item counts, saw is words", () => {
  assert.deepEqual(endFields({ missing: { planks: 4, stick: 1 } }), { missing: { planks: 4, stick: 1 } });
  assert.deepEqual(endFields({ stored: { oak_log: 12, "bad name": 3, dirt: 0 } }), { stored: { oak_log: 12 } });
  const many = Object.fromEntries("abcdefghij".split("").map((c, i) => [c, i + 1]));
  assert.equal(Object.keys(endFields({ stored: many }).stored!).length, 8);
  assert.equal(Object.keys(endFields({ missing: many }).missing!).length, 4);
  assert.equal(endFields({ saw: "trees, stone, iron ore" }).saw, "trees, stone, iron ore");
  assert.equal(endFields({ saw: "water at 12 3" }).saw, "water at");
  assert.deepEqual(endFields({ saw: "", missing: {}, stored: "no" }), {});
});

function stub(over: Partial<BodyControl> = {}) {
  const calls: string[] = [];
  let finish: (v?: unknown) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const body: BodyControl = {
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
    handleLabel: (h) => (h === "b3ab" ? "the stone" : null),
    observe: () => ({ health: 20, food: 20, weather: "clear", where: "x", held: null, inv: {}, near: [], blocks: [] }),
    runTask: async () => {},
    runAction: (a) => {
      calls.push(a.intent);
      return new Promise((res, rej) => ((finish = res as never), (fail = rej)));
    },
    knowsItem: (i) => i !== "nonsense",
    recipe: (i) => (i === "nonsense" ? null : { item: i, makes: 1, needs: { planks: 4 }, table: false, have: { planks: 0 }, missing: { planks: 4 } }),
    stash: () => ({ items: { oak_log: 3 }, fresh: true, looked: "just now" }),
    equip: (i) => {
      calls.push(`equip:${i}`);
      return i !== "air";
    },
    canExplore: (dir) => dir !== "south",
    say: () => "sent",
    stop: () => {},
    interrupt: () => {},
    ...over,
  };
  return { body, calls, finish: (v?: unknown) => finish(v), fail: (e: Error) => fail(e) };
}

test("recipe and stash answer at once, mid-task; an unknown item is refused", () => {
  const log = new EventLog();
  const s = stub();
  const d = createDispatcher(s.body, log);
  assert.equal(d.handle({ intent: "craft", item: "oak_planks" }).kind, "accepted");
  const r = d.handle({ intent: "recipe", item: "crafting_table" });
  assert.equal(r.kind, "recipe");
  assert.deepEqual(d.handle({ intent: "recipe", item: "nonsense" }), { kind: "rejected", reason: "unknown_item" });
  assert.deepEqual(d.handle({ intent: "stash" }), { kind: "stash", stash: { items: { oak_log: 3 }, fresh: true, looked: "just now" } });
  const off = createDispatcher(stub({ inGame: () => false }).body, new EventLog());
  assert.deepEqual(off.handle({ intent: "recipe", item: "stick" }), { kind: "rejected", reason: "not_in_game" });
  assert.deepEqual(off.handle({ intent: "stash" }), { kind: "rejected", reason: "not_in_game" });
});

test("craft, collect, store, take, explore: one at a time like a task, with the task's events and the new fields", async () => {
  const log = new EventLog();
  const s = stub();
  const d = createDispatcher(s.body, log);
  const first = d.handle({ intent: "craft", item: "stick", count: 4 });
  assert.deepEqual(first, { kind: "accepted", taskId: "t1" });
  for (const i of [
    { intent: "craft", item: "stick" }, { intent: "collect", handle: "b3ab" }, { intent: "store" }, { intent: "take", item: "oak_log" },
    { intent: "explore", dir: "east" }, { intent: "task", name: "get_wood" }, { intent: "come_to", player: "Sam" }, { intent: "equip", item: "iron_sword" },
  ] as const) {
    assert.deepEqual(d.handle(i), { kind: "rejected", reason: "busy" }, i.intent);
  }
  assert.equal(log.since(0).events.find((e) => e.event === "task_started")?.kind, "craft:stick");
  s.fail(Object.assign(new Error("missing"), { detail: "short of planks", missing: { planks: 4 } }));
  await Promise.resolve();
  const e = log.since(0).events.at(-1)!;
  assert.deepEqual([e.event, e.reason, e.detail, e.missing], ["task_failed", "missing", "short of planks", { planks: 4 }]);

  assert.equal(d.handle({ intent: "store" }).kind, "accepted");
  s.finish({ stored: { oak_log: 12 }, got: { stick: 1 } });
  await Promise.resolve();
  const done = log.since(0).events.at(-1)!;
  assert.deepEqual([done.event, done.stored, done.got], ["task_finished", { oak_log: 12 }, { stick: 1 }]);

  assert.equal(d.handle({ intent: "explore", dir: "east", far: "near" }).kind, "accepted");
  s.finish({ saw: "trees, water" });
  await Promise.resolve();
  assert.equal(log.since(0).events.at(-1)!.saw, "trees, water");
});

test("stop ends a running action, and progress lines flow for them", () => {
  const log = new EventLog();
  let report: (p: { step: string; got?: Record<string, number> }) => void = () => {};
  const s = stub({
    runAction: (_a, r) => {
      report = r;
      return new Promise(() => {});
    },
  });
  const d = createDispatcher(s.body, log);
  d.handle({ intent: "explore", dir: "north" });
  report({ step: "exploring north" });
  assert.equal(log.since(0).events.filter((e) => e.event === "task_progress").length, 1);
  assert.equal(d.handle({ intent: "stop" }).kind, "accepted");
  assert.equal(log.since(0).events.at(-1)!.event, "task_stopped");
});

test("pre-checks come back as rejections: unknown item, stale handle, too far, none held", () => {
  const d = createDispatcher(stub().body, new EventLog());
  assert.deepEqual(d.handle({ intent: "craft", item: "nonsense" }), { kind: "rejected", reason: "unknown_item" });
  assert.deepEqual(d.handle({ intent: "take", item: "nonsense" }), { kind: "rejected", reason: "unknown_item" });
  assert.deepEqual(d.handle({ intent: "collect", handle: "b9zz" }), { kind: "rejected", reason: "stale_handle" });
  assert.deepEqual(d.handle({ intent: "explore", dir: "south" }), { kind: "rejected", reason: "too_far" });
  assert.deepEqual(d.handle({ intent: "equip", item: "air" }), { kind: "rejected", reason: "none_held" });
  assert.deepEqual(d.handle({ intent: "equip", item: "iron_sword" }), { kind: "accepted" }); // at once, no task id
});

test("fights and danger refuse the hands too; equip is not a task and does not replace a follow", () => {
  const fight = createDispatcher(stub({ fighting: () => true }).body, new EventLog());
  assert.deepEqual(fight.handle({ intent: "craft", item: "stick" }), { kind: "rejected", reason: "in_fight" });
  const danger = createDispatcher(stub({ danger: () => true }).body, new EventLog());
  assert.deepEqual(danger.handle({ intent: "explore", dir: "east" }), { kind: "rejected", reason: "in_danger" });
  assert.deepEqual(danger.handle({ intent: "recipe", item: "stick" }).kind, "recipe"); // read-only, like observe
  const log = new EventLog();
  const d = createDispatcher(stub().body, log);
  d.handle({ intent: "follow", player: "Sam" });
  assert.deepEqual(d.handle({ intent: "equip", item: "iron_sword" }), { kind: "accepted" });
  assert.equal(log.since(0).events.some((e) => e.event === "task_stopped"), false);
  assert.deepEqual(d.handle({ intent: "craft", item: "stick" }), { kind: "rejected", reason: "busy" }); // a follow runs until stopped
});

// the adapter

test("act builds the wire intents for the hands and refuses what they do not take", () => {
  assert.deepEqual(buildIntent("craft", { item: "stick", count: 4 }), { ok: true, fields: { intent: "craft", item: "stick", count: 4 } });
  assert.deepEqual(buildIntent("collect", { handle: "b3kq", count: 3 }), { ok: true, fields: { intent: "collect", handle: "b3kq", count: 3 } });
  assert.deepEqual(buildIntent("explore", { dir: "east", far: "far" }), { ok: true, fields: { intent: "explore", dir: "east", far: "far" } });
  assert.deepEqual(buildIntent("store", {}), { ok: true, fields: { intent: "store" } });
  assert.equal(buildIntent("explore", {}).ok, false); // a direction is required
  assert.equal(buildIntent("equip", { item: "x", count: 2 }).ok, false);
  assert.equal(buildIntent("craft", { item: "x", dir: "east" }).ok, false);
});

const call = async (client: BodyClient, name: string, args: object = {}) => (await TOOLS.find((t) => t.name === name)!.run({ client }, args)).out as any;

test("recipe and stash tools pass the body's answers through and refusals as data", async () => {
  const fake = await FakeBody.start();
  const client = await connected(fake);
  try {
    const answer = { item: "crafting_table", makes: 1, needs: { planks: 4 }, table: false, have: { planks: 0 }, missing: { planks: 4 } };
    const base = fake.reply;
    fake.reply = (m) => {
      if (m.intent === "recipe") return m.item === "nonsense" ? { type: "rejected", id: m.id, reason: "unknown_item" } : { type: "recipe", id: m.id, recipe: answer };
      if (m.intent === "stash") return { type: "stash", id: m.id, stash: { items: { oak_log: 3 }, fresh: false, looked: "never", unseen: 3 } };
      return base(m);
    };
    assert.deepEqual(await call(client, "recipe", { item: "crafting_table" }), answer);
    const no = await call(client, "recipe", { item: "nonsense" });
    assert.equal(no.accepted, false);
    assert.equal(no.reason, "unknown_item");
    assert.ok(no.hint.length > 0);
    assert.deepEqual(await call(client, "stash"), { items: { oak_log: 3 }, fresh: false, looked: "never", unseen: 3 });
    assert.deepEqual(fake.intents.map((f) => f.intent), ["recipe", "recipe", "stash"]);

    const acted = await call(client, "act", { action: "equip", item: "iron_sword", rationale: "r" });
    assert.deepEqual(acted, { accepted: true, action: "equip", taskId: "t1" }); // the fake gives every non-say a task id
  } finally {
    client.close();
    await fake.close();
  }
});
