// The mine site's pure parts: the site file and its parser, the shaft put back after a restart, undo's plan over a
// journal, and where a distance rule is measured from.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseFrame, PLACING_INTENTS } from "../src/api/protocol";
import { seedStair, stairBottom, stairFacing, stairTop, forgetStair, addTunnelCell, wayEnd, stairSteps } from "../src/behaviors/stair";
import { lastJob, planUndo, restoreSpot, undoWords, UNDO_MAX, jobKind } from "../src/behaviors/undo-plan";
import { done } from "../src/lib/gate";
import { Journal, undoJob, type Entry } from "../src/lib/journal";
import { journal } from "../src/lib/journal";
import { inMine, mineCentre, openSites, originFor, parseSites, resetSites, setMine, siteText, getMine, sitesFile, MINE_REACH, type MineSite } from "../src/lib/sites";
import { parseBase } from "../src/lib/base";
import { buildIntent } from "../src/mcp/skills";

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;
const p = (x: number, y: number, z: number) => ({ x, y, z });

// a shaft facing east from (100, 67, 50): each step a block along and one down
const shaft = (n: number) => Array.from({ length: n + 1 }, (_, i) => p(100 + i, 67 - i, 50));
const site = (n: number, extra: Partial<MineSite> = {}): MineSite => ({ top: p(100, 67, 50), facing: { dx: 1, dz: 0 }, shaft: shaft(n), landing: null, kit: {}, ...extra });

test("a whole site parses back as it was written", () => {
  const m = site(10, { landing: p(110, 57, 50), kit: { chest: p(110, 57, 51), table: p(110, 57, 49), furnace: p(110, 58, 49) } });
  assert.deepEqual(parseSites(siteText(m)), m);
  assert.deepEqual(parseSites(siteText(site(3))), site(3));
});

test("anything that is not a whole site is no mine", () => {
  for (const bad of ["", "not json", "{}", '{"mine":null}', '{"mine":{"top":{"x":1}}}', "[]"]) assert.equal(parseSites(bad), null, bad);
  // a gap in the shaft, a shaft that does not start at the top, a diagonal facing, floats
  const gap = site(5);
  gap.shaft.splice(3, 1);
  assert.equal(parseSites(siteText(gap)), null);
  assert.equal(parseSites(siteText(site(4, { top: p(99, 67, 50) }))), null);
  assert.equal(parseSites(siteText(site(4, { facing: { dx: 1, dz: 1 } }))), null);
  assert.equal(parseSites(siteText(site(4, { top: p(100.5, 67, 50) }))), null);
  // a landing that is not the last cell, or a kit before there is a landing
  assert.equal(parseSites(siteText(site(5, { landing: p(103, 64, 50) }))), null);
  assert.equal(parseSites(siteText(site(5, { kit: { chest: p(105, 62, 51) } }))), null);
  assert.equal(parseSites(siteText(site(5, { landing: p(105, 62, 50), kit: { chest: { x: 1, y: 2 } as never } }))), null);
});

test("a shaft with no cells yet, and one with a level step, are fine", () => {
  assert.ok(parseSites(siteText({ top: p(1, 2, 3), facing: null, shaft: [], landing: null, kit: {} })));
  const level = [p(0, 10, 0), p(1, 9, 0), p(2, 9, 0)];
  assert.ok(parseSites(siteText({ top: p(0, 10, 0), facing: { dx: 1, dz: 0 }, shaft: level, landing: null, kit: {} })));
});

test("the site file is its own: a missing or damaged one is no mine, and the base file is never read or written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-"));
  try {
    const baseFile = path.join(dir, "base-Bot.json");
    const oldBase = JSON.stringify({ bed: [p(1, 2, 3), p(1, 2, 4)], craftingTable: p(2, 2, 3), furnaces: [], stashChests: [p(3, 2, 3)] });
    fs.writeFileSync(baseFile, oldBase);
    resetSites();
    openSites(dir, "Bot");
    assert.equal(getMine(), null);
    setMine(site(4));
    assert.deepEqual(parseSites(fs.readFileSync(sitesFile(dir, "Bot"), "utf8")), site(4));
    assert.equal(fs.readFileSync(baseFile, "utf8"), oldBase, "the base file is untouched");
    assert.ok(parseBase(oldBase), "an old base record still reads");

    // a restart: the file is read back; another bot name has none
    resetSites();
    openSites(dir, "Bot");
    assert.deepEqual(getMine(), site(4));
    resetSites();
    openSites(dir, "Other");
    assert.equal(getMine(), null);

    fs.writeFileSync(sitesFile(dir, "Bot"), '{"mine":{"top":');
    openSites(dir, "Bot");
    assert.equal(getMine(), null, "a damaged file is no mine");
    setMine(null);
    assert.ok(!fs.existsSync(sitesFile(dir, "Bot")));
  } finally {
    resetSites();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a half-dug shaft is put back as the stair after a restart, and goes on from its foot", () => {
  forgetStair();
  assert.equal(stairBottom(), null);
  const m = site(6);
  seedStair(m.shaft, { dx: 1, dz: 0 });
  assert.deepEqual(stairTop(), p(100, 67, 50));
  assert.deepEqual(stairBottom(), p(106, 61, 50), "dig_down is at the foot of this stair, so it goes on");
  assert.deepEqual(stairFacing(), { dx: 1, dz: 0 });
  assert.equal(stairSteps()?.length, 7);
  // a tunnel cut off the foot stays when the same shaft is seeded again
  addTunnelCell(p(107, 61, 50), { dx: 1, dz: 0 });
  seedStair(m.shaft, { dx: 1, dz: 0 });
  assert.deepEqual(wayEnd(), p(107, 61, 50));
  // another top replaces the stair in memory
  seedStair([p(5, 5, 5), p(6, 4, 5)], { dx: 1, dz: 0 });
  assert.deepEqual(stairTop(), p(5, 5, 5));
  forgetStair();
});

// ---- undo ----

let t = 0;
const entry = (op: "place" | "dig", pos: ReturnType<typeof p>, before: string, after: string, job: string, own = op === "place"): Entry => ({ t: ++t, op, pos, before, after, job, own });
const names = (world: Record<string, string>) => (q: { x: number; y: number; z: number }): string | null => world[`${q.x},${q.y},${q.z}`] ?? null;
const at = (q: ReturnType<typeof p>) => `${q.x},${q.y},${q.z}`;

test("undo takes the newest job of a kind, and only the kinds the mind may name", () => {
  const h = [
    entry("dig", p(1, 1, 1), "dirt", "air", "tree"),
    entry("place", p(2, 1, 1), "air", "chest", "place@10"),
    entry("dig", p(3, 1, 1), "dirt", "air", "dig_down@20"),
    entry("dig", p(4, 1, 1), "stone", "air", "pick_up"),
  ];
  assert.equal(lastJob(h), "dig_down@20", "pick_up and tree are no run of their own");
  assert.equal(lastJob(h, "place"), "place@10");
  assert.equal(lastJob(h, "tunnel"), null);
  assert.equal(jobKind("dig_shaft@123"), "dig_shaft");
  assert.equal(jobKind("make_base"), "make_base");
  assert.equal(lastJob([]), null);
});

test("a job whose cells all changed outside the journal does not hide an older one", () => {
  const h = [entry("place", p(1, 1, 1), "air", "chest", "place@10"), entry("place", p(2, 1, 1), "air", "crafting_table", "place@20")];
  assert.equal(lastJob(h, "place", names({ "1,1,1": "chest", "2,1,1": "air" })), "place@10", "the table was broken by hand");
  assert.equal(lastJob(h, "place", names({ "1,1,1": "stone", "2,1,1": "air" })), null);
  assert.equal(lastJob(h, "place", names({})), "place@20", "unloaded cells are still taken to be there");
});

test("a place is taken up and a dig put back, newest first, and a block changed since is left", () => {
  const job = "dig_down@5";
  const h = [
    entry("dig", p(0, 10, 0), "dirt", "air", job),
    entry("dig", p(1, 10, 0), "dirt", "air", job),
    entry("place", p(2, 10, 0), "air", "torch", job),
    entry("dig", p(3, 10, 0), "dirt", "air", job),
    entry("dig", p(4, 10, 0), "stone", "air", job),
    entry("dig", p(5, 10, 0), "dirt", "air", job),
  ];
  const world = { [at(h[0].pos)]: "air", [at(h[1].pos)]: "air", [at(h[2].pos)]: "torch", [at(h[3].pos)]: "stone", [at(h[4].pos)]: "air", [at(h[5].pos)]: "air" };
  const plan = planUndo(h, job, names(world), { dirt: 2 });
  assert.deepEqual(plan.todo.map((e) => e.pos.x), [5, 2, 1], "newest first; only two dirt to put back");
  assert.deepEqual(plan.skipped.map((s) => [s.pos.x, s.why]).sort(), [[0, "not_carried"], [3, "changed"], [4, "not_carried"]]);
  assert.equal(plan.more, false);
});

test("a dug block goes back as what it drops: stone as cobblestone, deepslate as cobbled deepslate, grass as dirt", () => {
  const job = "dig_down@6";
  const h = [
    entry("dig", p(0, 10, 0), "stone", "air", job),
    entry("dig", p(1, 10, 0), "deepslate", "air", job),
    entry("dig", p(2, 10, 0), "grass_block", "air", job),
    entry("dig", p(3, 10, 0), "coal_ore", "air", job),
    entry("dig", p(4, 10, 0), "stone", "air", job),
  ];
  const world = Object.fromEntries(h.map((e) => [at(e.pos), "air"]));
  const plan = planUndo(h, job, names(world), { cobblestone: 1, cobbled_deepslate: 1, dirt: 1 });
  assert.deepEqual(plan.todo.map((e) => [e.pos.x, e.item]), [[4, "cobblestone"], [2, "dirt"], [1, "cobbled_deepslate"]]);
  assert.deepEqual(plan.skipped.map((s) => [s.pos.x, s.why]).sort(), [[0, "not_carried"], [3, "no_block"]], "an ore drops coal, which is not set down; the older stone finds the one cobblestone used");
  // the registry's loot table says the same, and a block with no loot row falls back to the short table
  const loot = (b: string) => (b === "stone" ? ["cobblestone"] : b === "coal_ore" ? ["coal"] : null);
  const viaLoot = planUndo(h, job, names(world), { cobblestone: 2 }, loot);
  assert.deepEqual(viaLoot.todo.map((e) => e.item), ["cobblestone", "cobblestone"]);
  // what the gate would refuse is never planned, whatever is carried: the item has to pass handsPlaceable
  const stoneItem = planUndo(h.slice(0, 1), job, names(world), { stone: 3 }, () => ["stone"]);
  assert.deepEqual([stoneItem.todo.length, stoneItem.skipped.map((s) => s.why)], [0, ["no_block"]]);
  assert.match(undoWords(0, 0, plan.skipped, false), /gave nothing it can set down again/);
  assert.match(undoWords(0, 0, [{ pos: p(0, 0, 0), why: "not_carried" }], false), /none of what that block drops/);
});

test("a cell the job changed twice is undone once, from its newest entry; another job's later change is left", () => {
  const job = "tunnel@7";
  const h = [
    entry("dig", p(0, 1, 0), "dirt", "air", job),
    entry("place", p(0, 1, 0), "air", "torch", job),
    entry("dig", p(1, 1, 0), "dirt", "air", job),
    entry("place", p(1, 1, 0), "air", "cobblestone", "place@9"),
  ];
  const plan = planUndo(h, job, names({ "0,1,0": "torch", "1,1,0": "cobblestone" }), { dirt: 5 });
  assert.deepEqual(plan.todo.map((e) => e.op + e.pos.x), ["place0"]);
  assert.deepEqual(plan.skipped.map((s) => [s.pos.x, s.why]), [[1, "changed"]]);
});

test("what an undo already took back is not asked again, and an unloaded cell is not 'changed'", () => {
  const job = "place@1";
  const first = entry("place", p(1, 1, 1), "air", "crafting_table", job);
  const plan0 = planUndo([first], job, names({ "1,1,1": "crafting_table" }), {});
  assert.equal(plan0.todo.length, 1);
  // the undo took it up: its dig is now the latest entry for that cell
  const later = entry("dig", p(1, 1, 1), "crafting_table", "air", undoJob(job, 99), false);
  const plan1 = planUndo([first, later], job, names({ "1,1,1": "air" }), {});
  assert.deepEqual([plan1.todo.length, plan1.skipped.length], [0, 0]);
  const far = planUndo([first], job, names({}), {});
  assert.deepEqual(far.skipped.map((s) => s.why), ["stuck"]);
  assert.equal(lastJob([first, later]), null, "nothing of its own left to undo");
});

test("a place of the undo's own is not the body's own block, and a job's undo is capped per call", () => {
  const j = new Journal();
  const aJob = undoJob("dig_down@1", 5);
  const live = (e: Entry) => j.add(e);
  live(entry("dig", p(0, 1, 0), "dirt", "air", "dig_down@1"));
  live(entry("place", p(0, 1, 0), "air", "dirt", aJob, false));
  assert.equal(j.ownAt(p(0, 1, 0), "dirt"), false);
  assert.equal(j.restoredAt(p(0, 1, 0), "dirt"), true, "but it is not a build either: the next dig there is not refused for it");
  assert.equal(j.restoredAt(p(0, 1, 0), "stone"), false);
  assert.equal(j.history().length, 2);
  assert.equal(j.latestAt(p(0, 1, 0))?.job, aJob);

  const many = Array.from({ length: UNDO_MAX + 4 }, (_, i) => entry("place", p(i, 1, 0), "air", "torch", "place@2"));
  const world = Object.fromEntries(many.map((e) => [at(e.pos), "torch"]));
  const plan = planUndo(many, "place@2", names(world), {});
  assert.equal(plan.todo.length, UNDO_MAX);
  assert.equal(plan.more, true);
  assert.equal(plan.todo[0].pos.x, UNDO_MAX + 3, "newest first");
});

test("gate.done marks a place as its own, except the undo's put-back", () => {
  const before = journal.history().length;
  done({ kind: "place", pos: p(900, 5, 900), job: "place@1", block: "chest" }, "air", "chest", 1);
  done({ kind: "place", pos: p(901, 5, 900), job: undoJob("dig_down@1", 1), block: "dirt" }, "air", "dirt", 2);
  done({ kind: "place", pos: p(902, 5, 900), job: "place@1", block: "chest" }, "chest", "chest", 3);
  const added = journal.history().slice(before);
  assert.equal(added.length, 2, "a change that did not change anything is not written");
  assert.deepEqual(added.map((e) => e.own), [true, false]);
  assert.equal(journal.ownAt(p(900, 5, 900), "chest"), true);
  assert.equal(journal.ownAt(p(901, 5, 900), "dirt"), false);
});

test("the words for an undo have no digits and say what was left", () => {
  assert.equal(undoWords(2, 6, [{ pos: p(0, 0, 0), why: "changed" }], false), "put back six blocks and took up two blocks; left: one cell changed since");
  assert.equal(undoWords(0, 0, [{ pos: p(0, 0, 0), why: "chest" }, { pos: p(1, 0, 0), why: "chest" }], true), "nothing undone; left: two cells held things, take them out first; more to undo, ask again");
  assert.ok(!/\d/.test(undoWords(1, 1, [], false)));
});

test("a block goes back against a solid neighbour in reach, never where the body stands", () => {
  const solid = (q: { x: number; y: number; z: number }) => q.y < 10 || (q.x === 6 && q.y === 11);
  const view = { eye: { x: 5.5, y: 11.62, z: 5.5 }, feet: p(5, 10, 5), solid };
  assert.equal(restoreSpot(p(5, 10, 5), view), "stood");
  assert.equal(restoreSpot(p(5, 11, 5), view), "stood");
  assert.deepEqual(restoreSpot(p(5, 10, 6), view), { ref: p(5, 9, 6), face: p(0, 1, 0) });
  assert.equal(restoreSpot(p(5, 30, 5), view), null);
});

// ---- measuring from the mine ----

test("a task begun in the mine is measured from the landing, and one begun anywhere else from home", () => {
  const m = site(40, { landing: p(140, 27, 50), kit: {} });
  const home = p(0, 70, 0);
  assert.deepEqual(originFor(p(140, 27, 50), home, m), p(140, 27, 50));
  assert.deepEqual(originFor(p(170, 27, 80), home, m), p(140, 27, 50), "a branch off the landing");
  assert.deepEqual(originFor(p(110, 57, 50), home, m), p(140, 27, 50), "on the shaft, within reach of the landing");
  assert.deepEqual(originFor(p(140, 68, 50), home, m), home, "on the surface above it");
  assert.deepEqual(originFor(p(100, 67, 50), home, m), home, "at the top of the shaft");
  assert.deepEqual(originFor(p(140 + MINE_REACH + 5, 27, 50), home, m), home, "too far from the landing to be the mine's");
  assert.deepEqual(originFor(p(140, 27, 50), home, null), home, "no mine");
  assert.deepEqual(originFor(p(140, 27, 50), home, site(40)), home, "a shaft with no landing is no mine");
  assert.equal(inMine(p(100, 67, 50), m), false);
});

test("a search is centred on the landing when it begins in the mine or is aimed at it", () => {
  const m = site(40, { landing: p(140, 27, 50) });
  assert.deepEqual(mineCentre(undefined, p(141, 27, 50), m), p(140, 27, 50));
  assert.equal(mineCentre(undefined, p(0, 70, 0), m), null);
  assert.deepEqual(mineCentre(p(141, 27, 52), p(0, 70, 0), m), p(140, 27, 50), "near: mine");
  assert.equal(mineCentre(p(0, 70, 0), p(141, 27, 50), m), null, "aimed at home, from the mine");
  assert.equal(mineCentre(undefined, p(141, 27, 50), null), null);
});

test("dig_shaft, make_mine and undo have wire shapes of their own, and placing is what switches two of them", () => {
  assert.ok(ok({ intent: "dig_shaft", to: -50 }));
  assert.ok(ok({ intent: "dig_shaft", to: -50, torches: true }));
  assert.ok(!ok({ intent: "dig_shaft" }));
  assert.ok(!ok({ intent: "dig_shaft", to: "stone" }));
  assert.ok(!ok({ intent: "dig_shaft", to: 1.5 }));
  assert.ok(!ok({ intent: "dig_shaft", to: -50, dir: "east" }));
  assert.ok(ok({ intent: "make_mine" }));
  assert.ok(!ok({ intent: "make_mine", where: "here" }));
  assert.ok(ok({ intent: "undo" }));
  assert.ok(ok({ intent: "undo", job: "dig_shaft" }));
  assert.ok(!ok({ intent: "undo", job: "make_base" }), "a fixed key is no run of its own");
  assert.ok(!ok({ intent: "undo", job: "dig_down@17" }), "a job key with a time is never taken");
  assert.ok(!ok({ intent: "undo", job: "x; rm" }));
  assert.ok(ok({ intent: "go_to", handle: "mine" }));
  assert.ok(ok({ intent: "go_to", handle: "shaft" }));
  assert.ok(ok({ intent: "task", name: "get_stone", near: "mine" }));
  assert.ok(!ok({ intent: "task", name: "get_stone", near: "shaft" }));
  assert.ok(PLACING_INTENTS.includes("make_mine") && PLACING_INTENTS.includes("undo") && !(PLACING_INTENTS as readonly string[]).includes("dig_shaft"));
  assert.deepEqual(buildIntent("dig_shaft", { to: -50, torches: true }), { ok: true, fields: { intent: "dig_shaft", to: -50, torches: true } });
  assert.equal(buildIntent("dig_shaft", {}).ok, false);
  assert.equal(buildIntent("dig_shaft", { to: "stone" }).ok, false);
  assert.deepEqual(buildIntent("undo", { job: "place" }), { ok: true, fields: { intent: "undo", job: "place" } });
  assert.equal(buildIntent("undo", { job: "tree" }).ok, false);
  assert.deepEqual(buildIntent("make_mine", {}), { ok: true, fields: { intent: "make_mine" } });
});
