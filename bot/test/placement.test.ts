import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { base, openBase, parseBase, resetBase, setBase } from "../src/lib/base";
import { Journal, journalFile, openJournal, parseLines, record, journal, type Entry } from "../src/lib/journal";
import { check, handsPlaceable, placeable, type NameAt, type Op, type Pos } from "../src/lib/policy";
import { cardinalOfYaw, planPut, putWords, type PutView } from "../src/behaviors/put-plan";
import { storeSpots, stashSummary, takeSpots, StashMemory, spotKey } from "../src/behaviors/stash-plan";

const e = (over: Partial<Entry> = {}): Entry => ({ t: 1, op: "place", pos: { x: 1, y: 64, z: 1 }, before: "air", after: "crafting_table", job: "place", own: true, ...over });

// ---- journal ----

test("journal: the latest entry for a cell decides, and the block has to still be what was placed", () => {
  const j = new Journal();
  const p = { x: 1, y: 64, z: 1 };
  assert.equal(j.ownAt(p, "crafting_table"), false, "nothing journalled is not own");
  j.add(e());
  assert.equal(j.ownAt(p, "crafting_table"), true);
  assert.equal(j.ownAt(p, "furnace"), false, "a different block there now");
  j.add(e({ op: "dig", before: "crafting_table", after: "air", own: false }));
  assert.equal(j.ownAt(p, "crafting_table"), false, "dug since, so the next table there is not its own");
  j.add(e({ t: 3 }));
  assert.equal(j.ownAt(p, "crafting_table"), true, "placed again");
  j.add(e({ own: false, after: "oak_planks" }));
  assert.equal(j.ownAt(p, "oak_planks"), false, "a place that is not for its own use");
});

test("journal: ownCells lists what it placed by kind", () => {
  const j = new Journal();
  j.add(e());
  j.add(e({ pos: { x: 5, y: 64, z: 5 }, after: "chest" }));
  j.add(e({ pos: { x: 6, y: 64, z: 5 }, after: "chest", op: "dig", own: false }));
  assert.deepEqual(j.ownCells((n) => n === "chest"), [{ x: 5, y: 64, z: 5 }]);
});

test("journal: a corrupt or half-written line is skipped, the rest read", () => {
  const text = [JSON.stringify(e()), "{not json", JSON.stringify({ op: "place", pos: { x: 1.5, y: 1, z: 1 }, before: "a", after: "b" }), '{"t":2,"op":"dig","pos":{"x":2,"y":3,"z":4},"before":"stone","after":"air","job":"d"', ""].join("\n");
  const got = parseLines(text);
  assert.equal(got.length, 1);
  assert.equal(got[0].after, "crafting_table");
});

test("journal: the file keeps ownership across a restart and rotates at the limit, reading back both files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "journal-"));
  openJournal(dir, "Tester", 400);
  const p = (n: number): Pos => ({ x: n, y: 64, z: 0 });
  for (let n = 0; n < 12; n++) record(e({ pos: p(n), job: "x".repeat(20) }));
  const file = journalFile(dir, "Tester");
  assert.ok(existsSync(`${file}.1`), "rotated");
  assert.ok(readFileSync(file, "utf8").length < 800);
  // a restart: a fresh journal reads the pair back
  const again = new Journal();
  again.load([...parseLines(readFileSync(`${file}.1`, "utf8")), ...parseLines(readFileSync(file, "utf8"))]);
  assert.equal(again.ownAt(p(0), "crafting_table") || again.ownAt(p(11), "crafting_table"), true);
  assert.equal(again.ownAt(p(11), "crafting_table"), true);
  // two bots keep two files
  assert.notEqual(journalFile(dir, "ScuttleTest"), journalFile(dir, "ScuttleTest1"));
  // a name that did not write anything leaves nothing own
  assert.equal(journal.ownAt({ x: 999, y: 1, z: 1 }, "crafting_table"), false);
});

// ---- base ----

test("base: today's home until one is made, a record is all or nothing, and it survives a restart", () => {
  resetBase();
  assert.equal(base.made, false);
  assert.deepEqual([base.bed[0].x, base.bed[0].y, base.bed[0].z], [4, 68, -28]);
  assert.equal(base.furnaces.length, 2);
  assert.equal(base.stashChests.length, 3);

  assert.equal(parseBase("{nope"), null);
  assert.equal(parseBase(JSON.stringify({ bed: [{ x: 1, y: 2, z: 3 }], craftingTable: { x: 1, y: 2, z: 3 }, furnaces: [], stashChests: [] })), null, "a bed is two cells");
  assert.equal(parseBase(JSON.stringify({ bed: [{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 4 }], craftingTable: { x: 1.5, y: 2, z: 3 }, furnaces: [], stashChests: [] })), null);

  const dir = mkdtempSync(path.join(tmpdir(), "base-"));
  openBase(dir, "Tester");
  assert.equal(base.made, false, "no file is the home");
  const made = { bed: [{ x: 90, y: 70, z: 90 }, { x: 90, y: 70, z: 91 }] as [Pos, Pos], craftingTable: { x: 88, y: 70, z: 90 }, furnaces: [], stashChests: [{ x: 92, y: 70, z: 90 }] };
  setBase(made);
  assert.equal(base.made, true);
  assert.equal(base.bed[0].x, 90);
  assert.equal(base.furnaces.length, 0, "a base need not have a furnace yet");
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "base-Tester.json"), "utf8")), made);
  resetBase();
  openBase(dir, "Tester");
  assert.equal(base.made, true);
  assert.equal(base.craftingTable.x, 88);
  writeFileSync(path.join(dir, "base-Tester.json"), "garbage");
  openBase(dir, "Tester");
  assert.equal(base.made, false, "a damaged file is the home");
  resetBase();
});

// ---- the cell it picks ----

// a flat field of grass at y 63 (the floor) with air above; `put` overrides cells by "x,y,z"
function field(put: Record<string, string> = {}, over: Partial<PutView> = {}, standers: string[] = []): PutView {
  const name = (p: Pos): string => put[`${p.x},${p.y},${p.z}`] ?? (p.y <= 63 ? "grass_block" : "air");
  return {
    eye: { x: 0.5, y: 64.62, z: 0.5 },
    feet: { x: 0, y: 64, z: 0 },
    facing: { dx: 1, dz: 0 },
    nameAt: name,
    solid: (p) => !/^(air|cave_air|short_grass|torch|water|lava)$/.test(name(p)),
    occupied: (p) => standers.includes(`${p.x},${p.y},${p.z}`),
    ...over,
  };
}
const okSpot = (p: ReturnType<typeof planPut>) => {
  assert.ok(p.ok, p.ok ? "" : p.detail);
  return p.ok ? p : (undefined as never);
};

test("put-plan: here is the ground beside it, the way it faces first; the body's own cell is never used", () => {
  const plan = okSpot(planPut("crafting_table", { kind: "here" }, field()));
  assert.deepEqual(plan.spot.cell, { x: 1, y: 64, z: 0 });
  assert.deepEqual(plan.spot.ref, { x: 1, y: 63, z: 0 });
  assert.deepEqual(plan.spot.face, { x: 0, y: 1, z: 0 });
  assert.equal(plan.where, "beside it");
  // ahead is a drop: the next side
  const hole = okSpot(planPut("crafting_table", { kind: "here" }, field({ "1,63,0": "air", "1,62,0": "air" })));
  assert.notDeepEqual(hole.spot.cell, { x: 1, y: 64, z: 0 });
  assert.equal(hole.spot.cell.y, 64);
  // somebody standing in the cell
  const stood = okSpot(planPut("crafting_table", { kind: "here" }, field({}, {}, ["1,64,0"])));
  assert.notDeepEqual(stood.spot.cell, { x: 1, y: 64, z: 0 });
  assert.equal(putWords("crafting_table", plan.where), "a crafting table beside it");
  assert.equal(putWords("oak_bed", "beside it"), "an oak bed beside it");
});

test("put-plan: ahead is one cell, and nothing free there is no_room with words", () => {
  assert.deepEqual(okSpot(planPut("furnace", { kind: "ahead" }, field())).spot.cell, { x: 1, y: 64, z: 0 });
  const blocked = planPut("furnace", { kind: "ahead" }, field({ "1,64,0": "stone" }));
  assert.deepEqual(blocked, { ok: false, reason: "no_room", detail: "no free ground there to set it on" });
  const water = planPut("furnace", { kind: "ahead" }, field({ "1,64,0": "water" }));
  assert.equal(water.ok, false, "never into a fluid");
});

test("put-plan: wall is a torch's, on the face of a wall beside it", () => {
  assert.deepEqual(planPut("chest", { kind: "wall" }, field()), { ok: false, reason: "not_allowed", detail: "only a torch goes on a wall" });
  assert.equal(planPut("torch", { kind: "wall" }, field()).ok, false, "open field: no wall");
  const wall = { "2,64,0": "stone", "2,65,0": "stone" };
  const plan = okSpot(planPut("torch", { kind: "wall" }, field(wall)));
  assert.deepEqual(plan.spot.ref.x, 2);
  assert.deepEqual(plan.spot.face, { x: -1, y: 0, z: 0 });
  assert.equal(plan.where, "on the wall");
});

test("put-plan: on a block puts it on top, walks closer when it is too far, refuses a covered top", () => {
  const plan = okSpot(planPut("crafting_table", { kind: "on", target: { x: 2, y: 63, z: 1 } }, field()));
  assert.deepEqual(plan.spot.cell, { x: 2, y: 64, z: 1 });
  assert.equal(planPut("crafting_table", { kind: "on", target: { x: 20, y: 63, z: 1 } }, field()).ok, false);
  const far = planPut("crafting_table", { kind: "on", target: { x: 20, y: 63, z: 1 } }, field());
  assert.equal(!far.ok && far.reason, "too_far");
  const covered = planPut("crafting_table", { kind: "on", target: { x: 2, y: 63, z: 1 } }, field({ "2,64,1": "stone" }));
  assert.equal(!covered.ok && covered.reason, "no_room");
});

test("put-plan: a bed needs two clear cells in line away from it, with floor under both", () => {
  const plan = okSpot(planPut("white_bed", { kind: "here" }, field()));
  assert.deepEqual(plan.spot.cell, { x: 1, y: 64, z: 0 });
  assert.deepEqual(plan.spot.head, { x: 2, y: 64, z: 0 });
  // the head cell is taken: the foot goes elsewhere, with its own head in line
  const tight = okSpot(planPut("white_bed", { kind: "here" }, field({ "2,64,0": "stone" })));
  assert.notDeepEqual(tight.spot.cell, { x: 1, y: 64, z: 0 });
  assert.ok(tight.spot.head);
  // no floor under the head
  const edge = planPut("white_bed", { kind: "ahead" }, field({ "2,63,0": "air", "2,62,0": "air" }));
  assert.equal(edge.ok, false);
});

test("put-plan: two chests are never set side by side, and a gate refusal moves on to the next cell", () => {
  const next = okSpot(planPut("chest", { kind: "here" }, field({ "2,64,0": "chest" })));
  assert.notDeepEqual(next.spot.cell, { x: 1, y: 64, z: 0 }, "beside a chest it would make a double one");
  const vetoed: string[] = [];
  const moved = okSpot(
    planPut("crafting_table", { kind: "here" }, field(), (cell) => {
      vetoed.push(`${cell.x}`);
      return cell.x === 1 ? "something a player built is too close" : null;
    })
  );
  assert.notEqual(moved.spot.cell.x, 1);
  const all = planPut("crafting_table", { kind: "here" }, field(), () => "something a player built is too close");
  assert.deepEqual(all, { ok: false, reason: "refused", detail: "something a player built is too close" });
});

test("put-plan: yaw gives the cardinal the body looks along", () => {
  assert.deepEqual(cardinalOfYaw(0), { dx: 0, dz: -1 });
  assert.deepEqual(cardinalOfYaw(Math.PI / 2), { dx: -1, dz: 0 });
  assert.deepEqual(cardinalOfYaw(Math.PI), { dx: 0, dz: 1 });
});

// ---- the gate's rules for a place from the hands ----

const names =
  (put: Record<string, string> = {}): NameAt =>
  (p) =>
    put[`${p.x},${p.y},${p.z}`] ?? (p.y <= 63 ? "stone" : "air");
const placeOp = (block: string, over: Partial<Op> = {}): Op => ({ kind: "place", pos: { x: 5, y: 64, z: 5 }, against: { x: 5, y: 63, z: 5 }, block, job: "j", ...over });
const solid = (p: Pos) => p.y <= 63;

test("place allowlist: a table, furnace, chest, torch, any bed and scaffolding; nothing else", () => {
  for (const b of ["crafting_table", "furnace", "chest", "torch", "white_bed", "oak_bed", "dirt", "cobblestone", "cobbled_deepslate", "netherrack"]) assert.equal(placeable(b), true, b);
  for (const b of ["tnt", "water", "lava", "fire", "oak_sign", "redstone_wire", "lava_bucket", "ender_chest", "trapped_chest"]) assert.equal(placeable(b), false, b);
});

test("place from the hands: refused beside a build and in a kept zone, allowed beside its own blocks", () => {
  const strict = { strict: true };
  const clear = { nameAt: names(), solidAt: solid };
  assert.equal(check(placeOp("crafting_table"), clear, strict).ok, true);
  const house = { nameAt: names({ "7,64,5": "oak_planks" }), solidAt: solid };
  const refused = check(placeOp("crafting_table"), house, strict);
  assert.equal(!refused.ok && refused.reason, "player_built");
  assert.equal(check(placeOp("dirt"), house).ok, true, "the stair's fill does not look at builds");
  // the same planks are its own: not a build
  assert.equal(check(placeOp("crafting_table"), { ...house, isOwn: (p) => p.x === 7 }, strict).ok, true);
  const zoned = check(placeOp("crafting_table"), { ...clear, zonesAt: () => ["reverted" as const] }, strict);
  assert.equal(!zoned.ok && zoned.reason, "protected");
  assert.equal(check(placeOp("crafting_table"), { ...clear, zonesAt: () => ["reverted" as const] }).ok, true, "the stair's fill skips zones as before");
  const tnt = check(placeOp("tnt"), clear, strict);
  assert.equal(!tnt.ok && tnt.reason, "not_allowed");
  // stone is the stair's own fill: the hands do not set it down, the stair still can
  assert.equal(check(placeOp("stone"), clear, strict).ok, false);
  assert.equal(check(placeOp("stone"), clear).ok, true);
  assert.equal(handsPlaceable("stone"), false);
  assert.equal(handsPlaceable("dirt"), true);
});

// ---- chests ----

test("stash spots: own chests near it first, else the base's; take looks at every own chest, then the base's, each once", () => {
  const base3 = [{ x: 0, y: 64, z: 0 }, { x: 50, y: 64, z: 0 }];
  const near = { x: 4, y: 64, z: 0 };
  const far = { x: 200, y: 64, z: 0 };
  assert.deepEqual(storeSpots([near, far], base3, { x: 3, y: 64, z: 0 }), [near]);
  assert.deepEqual(storeSpots([far], base3, { x: 3, y: 64, z: 0 }), base3, "a stray chest far away does not take the stash over");
  assert.deepEqual(storeSpots([], base3, { x: 3, y: 64, z: 0 }), base3);
  const took = takeSpots([far, near, base3[0]], base3, { x: 3, y: 64, z: 0 });
  assert.equal(took.length, 4, "the base's own chest is listed once");
  assert.deepEqual(took.slice(0, 3), [near, base3[0], far], "own chests nearest first");
  assert.deepEqual(took[3], base3[1]);
});

test("stash memory is kept by where a chest is, and a chest reads back as words", () => {
  const m = new StashMemory();
  m.note(spotKey({ x: 1, y: 2, z: 3 }), { oak_log: 12, coal: 3, stick: 1, apple: 1 }, 0);
  assert.deepEqual(m.lookAt("1,2,3"), { oak_log: 12, coal: 3, stick: 1, apple: 1 });
  assert.equal(m.lookAt("9,9,9"), null);
  assert.equal(stashSummary(m.lookAt("1,2,3")), "oak_log 12, coal 3, apple 1, and more");
  assert.equal(stashSummary({}), "empty");
  assert.equal(stashSummary(null), null);
});

// ---- the API ----

const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", ...o })).ok;

test("parseFrame: place takes a word for where, never a position; pick_up and make_base are strict; store and take name a chest by handle", () => {
  assert.ok(ok({ intent: "place", item: "crafting_table" }));
  assert.ok(ok({ intent: "place", item: "torch", where: "wall" }));
  assert.ok(ok({ intent: "place", item: "crafting_table", where: "on b12ab" }));
  assert.ok(ok({ intent: "place", item: "chest", where: "on table" }));
  assert.ok(!ok({ intent: "place", item: "chest", where: "at 4 64 4" }));
  assert.ok(!ok({ intent: "place", item: "chest", where: "on e12ab" }));
  assert.ok(!ok({ intent: "place", item: "chest", x: 1 }));
  assert.ok(!ok({ intent: "place", where: "here" }));
  assert.ok(ok({ intent: "pick_up", handle: "b3ab" }));
  assert.ok(ok({ intent: "pick_up", handle: "table" }));
  assert.ok(!ok({ intent: "pick_up", handle: "e3ab" }));
  assert.ok(!ok({ intent: "pick_up" }));
  assert.ok(ok({ intent: "make_base" }));
  assert.ok(!ok({ intent: "make_base", x: 1 }));
  assert.ok(ok({ intent: "store", chest: "b4ab" }));
  assert.ok(ok({ intent: "store", item: "oak_log", count: 4, chest: "stash" }));
  assert.ok(ok({ intent: "take", item: "oak_log", chest: "b4ab" }));
  assert.ok(!ok({ intent: "take", item: "oak_log", chest: "e4ab" }));
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
    handleLabel: (h) => (h === "b3ab" ? "the table" : null),
    observe: () => ({ health: 20, food: 20, weather: "clear", where: "x", held: null, inv: {}, near: [], blocks: [] }),
    runTask: never,
    runAction: never,
    knowsItem: (i) => i !== "nonsense",
    recipe: () => null,
    stash: () => ({ items: {}, fresh: true, looked: "never" }),
    equip: () => true,
    placementOn: () => true,
    canExplore: () => true,
    say: () => "sent",
    announce: () => {},
    stop: () => {},
    interrupt: () => {},
    ...over,
  };
}

test("dispatch: place, pick_up and make_base are refused not_enabled when placing is off, stale handles and unknown items at once", () => {
  const off = createDispatcher(stub({ placementOn: () => false }), new EventLog());
  for (const i of [{ intent: "place", item: "crafting_table" }, { intent: "pick_up", handle: "b3ab" }, { intent: "make_base" }] as const) {
    assert.deepEqual(off.handle(i), { kind: "rejected", reason: "not_enabled" });
  }
  assert.equal(off.handle({ intent: "craft", item: "stick" }).kind, "accepted", "craft is not one of them");

  const on = createDispatcher(stub(), new EventLog());
  assert.deepEqual(on.handle({ intent: "place", item: "nonsense" }), { kind: "rejected", reason: "unknown_item" });
  assert.deepEqual(on.handle({ intent: "place", item: "crafting_table", where: "on b9zz" }), { kind: "rejected", reason: "stale_handle" });
  assert.deepEqual(on.handle({ intent: "pick_up", handle: "b9zz" }), { kind: "rejected", reason: "stale_handle" });
  assert.deepEqual(on.handle({ intent: "store", chest: "b9zz" }), { kind: "rejected", reason: "stale_handle" });
  assert.equal(on.handle({ intent: "place", item: "crafting_table", where: "on b3ab" }).kind, "accepted");
  assert.deepEqual(on.handle({ intent: "make_base" }), { kind: "rejected", reason: "busy" }, "one action at a time");
});
