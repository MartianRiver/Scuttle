import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { noteRefused, reverted } from "../src/behaviors/refused";
import { dig } from "../src/lib/collect";
import { breakGate, gateDig, grants, hooks, placeBudget, taskErrorOf } from "../src/lib/gate";
import { check, GrantStore, memoNames, PlaceBudget, provenanceAt, type Grant, type NameAt, type Op, type Pos, type World } from "../src/lib/policy";
import { placeBlock } from "../src/lib/place-block";

const T: Pos = { x: 10, y: 70, z: 10 };
const key = (p: Pos) => `${p.x},${p.y},${p.z}`;
const at = (dx: number, dy: number, dz: number): Pos => ({ x: T.x + dx, y: T.y + dy, z: T.z + dz });

function grid(put: Array<[Pos, string]> = [], unloaded: Pos[] = []): NameAt {
  const m = new Map(put.map(([p, n]) => [key(p), n]));
  const gone = new Set(unloaded.map(key));
  return (p) => (gone.has(key(p)) ? null : (m.get(key(p)) ?? "stone"));
}
const dig1: Op = { kind: "dig", pos: T, job: "t" };
const reason = (v: ReturnType<typeof check>) => (v.ok ? "ok" : v.reason);

test("a clean block passes and the verdict order is unknown, physical, provenance, radius, zones", () => {
  assert.equal(reason(check(dig1, { nameAt: grid() })), "ok");

  // each rule fires with every later one also failing, and a later one alone fires when the earlier ones pass
  const zones = () => ["reverted" as const];
  const everything: World = {
    nameAt: grid([[at(1, 0, 0), "water"], [at(0, 0, 0), "chest"], [at(2, 0, 0), "oak_planks"]], [at(0, 1, 0)]),
    zonesAt: zones,
  };
  assert.equal(reason(check(dig1, everything)), "unknown");
  assert.equal(reason(check(dig1, { ...everything, nameAt: grid([[at(1, 0, 0), "water"], [T, "chest"], [at(2, 0, 0), "oak_planks"]]) })), "unsafe");
  assert.equal(reason(check(dig1, { ...everything, nameAt: grid([[T, "chest"], [at(2, 0, 0), "oak_planks"]]) })), "player_built");
  assert.equal(reason(check(dig1, { ...everything, nameAt: grid([[at(2, 0, 0), "oak_planks"]]) })), "player_built"); // radius, not provenance
  assert.equal(reason(check(dig1, { nameAt: grid(), zonesAt: zones })), "protected");
  assert.equal(reason(check(dig1, { nameAt: grid([[at(0, 2, 0), "gravel"]]), zonesAt: zones })), "unsafe");
});

test("a stand the planner gives is geometry, the doors leave it out", () => {
  assert.equal(reason(check(dig1, { nameAt: grid() }, { stand: at(0, 1, 0) })), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: grid() })), "ok");
});

test("clearFalling lets a capped, dry column of sand or gravel come down, only from a stand beside the cell", () => {
  const col = (extra: Array<[Pos, string]> = []) => grid([[at(0, 1, 0), "gravel"], [at(0, 2, 0), "gravel"], ...extra]); // stone over it
  const beside = at(1, -1, 0);
  const clear = { clearFalling: true, stand: beside };
  assert.equal(reason(check(dig1, { nameAt: col() })), "unsafe"); // without the field the refusal stands
  assert.equal(reason(check(dig1, { nameAt: col() }, { clearFalling: true })), "unsafe"); // no stand: it will not say it is safe
  assert.equal(reason(check(dig1, { nameAt: col() }, { clearFalling: true, stand: at(0, -1, 0) })), "unsafe"); // under the column
  assert.equal(reason(check(dig1, { nameAt: col() }, clear)), "ok");
  // what must still refuse with the field: liquid or a cave in the column, liquid beside it, a column with no cap, the rest of the dig rules
  assert.equal(reason(check(dig1, { nameAt: col([[at(0, 3, 0), "water"]]) }, clear)), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: col([[at(0, 3, 0), "lava"]]) }, clear)), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: col([[at(0, 3, 0), "air"]]) }, clear)), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: col([[at(1, 2, 0), "water"]]) }, clear)), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: col([[at(0, 1, 1), "lava"]]) }, clear)), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: col([[at(1, 0, 0), "water"]]) }, clear)), "unsafe"); // beside the target itself
  assert.equal(reason(check(dig1, { nameAt: col([[at(0, 4, 0), "lava"]]) }, clear)), "ok"); // above the cap is not read
  assert.equal(reason(check(dig1, { nameAt: grid([[at(0, 1, 0), "gravel"], [at(0, 2, 0), "gravel"]], [at(0, 3, 0)]) }, clear)), "unsafe"); // the cap is not loaded
  assert.equal(reason(check(dig1, { nameAt: col([[at(2, 0, 0), "oak_planks"]]) }, clear)), "player_built");
  assert.equal(reason(check(dig1, { nameAt: col(), zonesAt: () => ["reverted" as const] }, clear)), "protected");
  // gravel two over with air between is not a column that starts over the cell
  assert.equal(reason(check(dig1, { nameAt: grid([[at(0, 1, 0), "air"], [at(0, 2, 0), "gravel"]]) }, clear)), "unsafe");
});

test("settling: clearing a column that already came down does not read the cells it left as a cave", () => {
  const beside = at(1, -1, 0);
  const clear = { clearFalling: true, stand: beside };
  const settle = { ...clear, settling: true };
  // two gravel came down into the cell: one is in it, one over it, and the cell it fell from is air under the same stone
  const pile = (extra: Array<[Pos, string]> = []) => grid([[at(0, 1, 0), "gravel"], [at(0, 2, 0), "gravel"], [at(0, 3, 0), "air"], ...extra]);
  assert.equal(reason(check(dig1, { nameAt: pile() }, clear)), "unsafe"); // the first, strict probe still calls it open
  assert.equal(reason(check(dig1, { nameAt: pile() }, settle)), "ok");
  // what still refuses while settling: liquid in or beside the vacated cell, no cap in reach, no stand beside
  assert.equal(reason(check(dig1, { nameAt: pile([[at(1, 3, 0), "water"]]) }, settle)), "unsafe");
  assert.equal(reason(check(dig1, { nameAt: pile([[at(0, 4, 0), "lava"]]) }, settle)), "unsafe");
  const cave = grid([[at(0, 1, 0), "gravel"], ...[2, 3, 4, 5, 6, 7, 8, 9].map((dy): [Pos, string] => [at(0, dy, 0), "air"])]);
  assert.equal(reason(check(dig1, { nameAt: cave }, settle)), "unsafe"); // air all the way up is not a vacated column
  assert.equal(reason(check(dig1, { nameAt: pile() }, { clearFalling: true, settling: true, stand: at(0, -1, 0) })), "unsafe");
});

test("physical: false asks only that the block is loaded", () => {
  const wet = grid([[at(1, 0, 0), "water"], [at(0, 2, 0), "sand"]], [at(0, 1, 0)]);
  assert.equal(reason(check(dig1, { nameAt: wet })), "unknown");
  assert.equal(reason(check(dig1, { nameAt: wet }, { physical: false })), "ok");
  assert.equal(reason(check(dig1, { nameAt: grid([[at(2, 0, 0), "oak_planks"]]) }, { physical: false })), "player_built");
  assert.equal(reason(check(dig1, { nameAt: grid([], [T]) }, { physical: false })), "unknown");
});

const grant = (over: Partial<Grant> = {}): Grant => ({ player: "u1", box: { min: at(-3, -3, -3), max: at(3, 12, 3) }, expires: 10_000, ops: ["dig"], ...over });
const house = grid([[at(2, 0, 0), "oak_planks"], [at(0, 6, 0), "oak_slab"]]);
const withGrants = (store: GrantStore, now = 1000): World => ({ nameAt: house, granted: (p, op) => store.covers(p, op, now) });
const asker: Op = { ...dig1, player: "u1" };

test("a grant lifts a build in its box for its player and ops, and nothing outside that", () => {
  const store = new GrantStore();
  assert.ok(store.add(grant(), 0));
  assert.equal(reason(check(asker, withGrants(store))), "ok");
  assert.equal(reason(check(dig1, withGrants(store))), "player_built"); // no player named on the job
  assert.equal(reason(check({ ...asker, player: "u2" }, withGrants(store))), "player_built"); // another player's grant
  assert.equal(reason(check(asker, withGrants(store, 10_000))), "player_built"); // expired
  assert.equal(reason(check({ ...asker, pos: at(20, 0, 0) }, { nameAt: grid([[at(22, 0, 0), "oak_planks"]]), granted: (p, o) => store.covers(p, o, 1000) })), "player_built"); // the build is out of the box

  const placeOnly = new GrantStore();
  placeOnly.add(grant({ ops: ["place"] }), 0);
  assert.equal(reason(check(asker, withGrants(placeOnly))), "player_built"); // the grant does not name dig
});

test("a grant never lifts liquid, falling, unknown or standing rules", () => {
  const store = new GrantStore();
  store.add(grant(), 0);
  const g = (names: NameAt, opts = {}) => check(asker, { nameAt: names, granted: (p, o) => store.covers(p, o, 1000) }, opts);
  assert.equal(reason(g(grid([[at(1, 0, 0), "lava"], [at(2, 0, 0), "oak_planks"]]))), "unsafe");
  assert.equal(reason(g(grid([[at(0, 1, 0), "water"]]))), "unsafe");
  assert.equal(reason(g(grid([[at(0, 2, 0), "gravel"]]))), "unsafe");
  assert.equal(reason(g(grid([], [at(0, 0, 1)]))), "unknown");
  assert.equal(reason(g(grid(), { stand: at(0, 1, 0) })), "unsafe");
});

test("a grant lifts a kept-out zone and a made target, at the positions in its box", () => {
  const store = new GrantStore();
  store.add(grant({ box: { min: at(0, 0, 0), max: at(0, 0, 0) } }), 0);
  const world = (names: NameAt): World => ({ nameAt: names, zonesAt: () => ["asked"], granted: (p, o) => store.covers(p, o, 1000) });
  assert.equal(reason(check(asker, world(grid()))), "ok");
  assert.equal(reason(check({ ...asker, pos: at(1, 0, 0) }, world(grid()))), "protected");
  assert.equal(reason(check(asker, world(grid([[T, "chest"]])))), "ok"); // the target is the one block in the box
});

test("grants: three live at most, 16 across at most, they expire, a restart ends them", () => {
  const s = new GrantStore();
  assert.ok(s.add(grant({ expires: 100 }), 0));
  assert.ok(s.add(grant(), 0));
  assert.ok(s.add(grant(), 0));
  assert.ok(!s.add(grant(), 0)); // the fourth
  assert.ok(s.add(grant(), 100)); // the first has lapsed
  assert.ok(!s.add(grant({ box: { min: at(0, 0, 0), max: at(16, 0, 0) } }), 200)); // 17 across
  assert.ok(!new GrantStore().add(grant({ expires: 0 }), 0)); // already over
  const t = new GrantStore();
  t.add(grant(), 0);
  t.clear();
  assert.equal(t.live(1).length, 0);
});

test("provenanceAt: own, player, natural, unknown", () => {
  const w = (extra: Partial<World> = {}) => ({ nameAt: grid(), ...extra });
  assert.equal(provenanceAt(T, "stone", w()), "natural");
  assert.equal(provenanceAt(T, "oak_planks", w()), "player");
  assert.equal(provenanceAt(T, "stone", w({ zonesAt: () => ["made"] })), "player");
  assert.equal(provenanceAt(T, "stone", w({ zonesAt: () => ["reverted"] })), "natural");
  assert.equal(provenanceAt(T, "cobblestone", w({ isOwn: () => true })), "own"); // the journal outranks the name list
  assert.equal(provenanceAt(T, null, w()), "unknown");
});

test("own blocks are exempt at their own position only", () => {
  const near = grid([[T, "cobblestone"], [at(2, 0, 0), "cobblestone"]]);
  const ownT = (p: Pos) => key(p) === key(T);
  assert.equal(reason(check(dig1, { nameAt: near })), "player_built");
  assert.equal(reason(check(dig1, { nameAt: near, isOwn: ownT })), "player_built"); // the other cobblestone is not its own
  assert.equal(reason(check(dig1, { nameAt: grid([[T, "cobblestone"]]), isOwn: ownT })), "ok");
  assert.equal(reason(check({ ...dig1, pos: at(5, 0, 0) }, { nameAt: grid([[at(5, 0, 0), "cobblestone"], [at(6, 0, 0), "cobblestone"]]), isOwn: ownT })), "player_built");
});

const floorAt = at(0, -1, 0);
const fill: Op = { kind: "place", pos: T, against: floorAt, block: "dirt", job: "j" };
const placeWorld = (over: Partial<World> = {}): World => ({ nameAt: grid([[T, "air"]]), solidAt: (p) => key(p) === key(floorAt), ...over });

test("place: allowlist, an air cell, something solid to set it against, nobody in it", () => {
  assert.equal(reason(check(fill, placeWorld())), "ok");
  assert.equal(reason(check({ ...fill, block: "tnt" }, placeWorld())), "not_allowed");
  assert.equal(reason(check({ ...fill, block: undefined }, placeWorld())), "not_allowed");
  assert.equal(reason(check(fill, { ...placeWorld(), nameAt: grid([[T, "stone"]]) })), "not_allowed");
  assert.equal(reason(check(fill, { ...placeWorld(), nameAt: grid([[T, "water"]]) })), "not_allowed");
  assert.equal(reason(check({ ...fill, against: at(3, 0, 0) }, placeWorld())), "not_allowed");
  assert.equal(reason(check(fill, placeWorld({ occupied: () => true }))), "not_allowed");
  assert.equal(reason(check(fill, { ...placeWorld(), nameAt: grid([], [T]) })), "unknown");
});

test("place ignores liquid, falling blocks and the made radius, which are about breaking", () => {
  const w = placeWorld({ nameAt: grid([[T, "air"], [at(1, 0, 0), "water"], [at(0, 1, 0), "sand"], [at(1, -1, 0), "cobblestone"]]) });
  assert.equal(reason(check(fill, w)), "ok");
});

test("place budgets: per job and per day", () => {
  const b = new PlaceBudget(2, 3);
  const world = (now: number): World => placeWorld({ budgetLeft: (job) => b.left(job, now) });
  assert.equal(reason(check(fill, world(0))), "ok");
  b.spend("j", 0);
  b.spend("j", 0);
  assert.equal(reason(check(fill, world(0))), "not_allowed"); // the job has had its two
  assert.equal(reason(check({ ...fill, job: "k" }, world(0))), "ok");
  b.spend("k", 0);
  assert.equal(reason(check({ ...fill, job: "m" }, world(0))), "not_allowed"); // three today
  assert.equal(reason(check({ ...fill, job: "m" }, world(24 * 60 * 60_000))), "ok"); // a day on
});

test("memoNames reads each cell once and never remembers an unloaded one", () => {
  let reads = 0;
  let loaded = false;
  const names = memoNames((p) => {
    reads++;
    return loaded ? "stone" : p.y > 0 ? "air" : null;
  });
  assert.equal(names(at(0, 0, 0)), "air");
  assert.equal(names(at(0, 0, 0)), "air");
  assert.equal(reads, 1);
  assert.equal(names({ x: 0, y: -1, z: 0 }), null);
  loaded = true;
  assert.equal(names({ x: 0, y: -1, z: 0 }), "stone");
  assert.equal(names({ x: 5_000_000, y: 5, z: 0 }), "stone"); // out of the key range: read straight
});

// ---- the doors, over a fake bot ----

function fakeBot(put: Array<[Pos, string]> = [], extra: Record<string, unknown> = {}) {
  const names = new Map(put.map(([p, n]) => [key(p), n]));
  const blocks = new Map<string, Block>();
  const blockAt = (v: Vec3): Block | null => {
    const k = key(v);
    const name = names.get(k) ?? "stone";
    if (name === "unloaded") return null;
    let b = blocks.get(k);
    if (!b || b.name !== name) {
      b = { name, type: name.length, position: new Vec3(v.x, v.y, v.z), boundingBox: name === "air" ? "empty" : "block", getProperties: () => ({}) } as unknown as Block;
      blocks.set(k, b);
    }
    return b;
  };
  const dug: string[] = [];
  const bot = { blockAt, entities: {}, entity: {}, targetDigBlock: null, heldItem: null, dig: async (b: Block) => void dug.push(key(b.position)), ...extra } as unknown as Bot;
  return { bot, names, dug, blockAt };
}
const at3 = (p: Pos) => new Vec3(p.x, p.y, p.z);

test("dig door: a clean block is dug, a stale plan, a build, a zone and a hazard are not", async () => {
  reverted.forget(-1); // no zones left from another test
  const f = fakeBot();
  const target = f.blockAt(at3(T)) as Block;
  assert.equal((await dig(f.bot, target, () => false)).ok, true);
  assert.deepEqual(f.dug, [key(T)]);

  // the world changed after the plan
  f.names.set(key(T), "dirt");
  const stale = await dig(f.bot, target, () => false);
  assert.equal(stale.ok === false && stale.reason, "unknown");

  const near = fakeBot([[at(2, 0, 0), "oak_planks"]]);
  const b1 = await dig(near.bot, near.blockAt(at3(T)) as Block, () => false);
  assert.equal(b1.ok === false && b1.reason, "player_built");

  const wet = fakeBot([[at(1, 0, 0), "lava"]]);
  assert.equal((await dig(wet.bot, wet.blockAt(at3(T)) as Block, () => false)).ok, false);
  const ground = fakeBot([[at(0, 2, 0), "gravel"]]);
  assert.equal((await dig(ground.bot, ground.blockAt(at3(T)) as Block, () => false)).ok, false);

  const blind = fakeBot([[at(0, 1, 0), "unloaded"]]);
  assert.equal((await dig(blind.bot, blind.blockAt(at3(T)) as Block, () => false)).ok, false);
  assert.deepEqual([near.dug, wet.dug, ground.dug, blind.dug], [[], [], [], []]); // none of them reached bot.dig

  noteRefused(T.x, T.z);
  const zoned = fakeBot();
  const z = await dig(zoned.bot, zoned.blockAt(at3(T)) as Block, () => false);
  assert.equal(z.ok === false && z.reason, "protected");
  assert.equal(zoned.dug.length, 0);
  reverted.forget(-1);
});

test("dig door with physical: false lets a log stand beside water but not beside a build", async () => {
  const wet = fakeBot([[at(1, 0, 0), "water"]]);
  assert.equal(gateDig(wet.bot, wet.blockAt(at3(T)) as Block, "tree", { physical: false }).ok, true);
  assert.equal(gateDig(wet.bot, wet.blockAt(at3(T)) as Block, "tree").ok, false);
  const build = fakeBot([[at(2, 0, 1), "oak_fence"]]);
  assert.equal(gateDig(build.bot, build.blockAt(at3(T)) as Block, "tree", { physical: false }).ok, false);
});

test("safeToBreak gate: a tree by a build is refused and every position is asked once", () => {
  let reads = 0;
  const f = fakeBot([[at(3, 0, 0), "oak_fence"]]);
  const counted = { ...f.bot, blockAt: (v: Vec3) => (reads++, f.blockAt(v)) } as unknown as Bot;
  const gate = breakGate(counted, "gather");
  assert.equal(gate(f.blockAt(at3(T)) as Block), false);
  const first = reads;
  assert.equal(gate(f.blockAt(at3(T)) as Block), false);
  assert.ok(reads <= first + 1, "the second ask reads nothing but the block handed in");
  assert.equal(breakGate(counted, "gather")(f.blockAt(at3(at(0, 0, 8))) as Block), true);
});

test("hooks.isOwn is how the journal exempts the body's own blocks", () => {
  const f = fakeBot([[at(1, 0, 0), "cobblestone"]]);
  const target = f.blockAt(at3(T)) as Block;
  assert.equal(gateDig(f.bot, target, "j").ok, false);
  const was = hooks.isOwn;
  hooks.isOwn = (p) => key(p) === key(at(1, 0, 0));
  try {
    assert.equal(gateDig(f.bot, target, "j").ok, true);
  } finally {
    hooks.isOwn = was;
  }
});

test("place door: sets the fill down once, refuses the rest, spends the budget", async () => {
  const placed: string[] = [];
  const f = fakeBot([[T, "air"]], {
    _placeBlockWithOptions: async (ref: Block, face: Vec3) => void placed.push(key(ref.position.plus(face))),
  });
  const floor = f.blockAt(at3(floorAt)) as Block;
  await placeBlock(f.bot, floor, new Vec3(0, 1, 0), "dirt", "door-test");
  assert.deepEqual(placed, [key(T)]);
  await assert.rejects(placeBlock(f.bot, floor, new Vec3(0, 1, 0), "tnt", "door-test"), (e: Error) => e.name === "Error" && e.message === "not_allowed");
  assert.equal(placed.length, 1);
  assert.equal(placeBudget.left("door-test", Date.now()), true);
  for (let i = 0; i < 16; i++) placeBudget.spend("door-test", Date.now());
  const spent = await placeBlock(f.bot, floor, new Vec3(0, 1, 0), "dirt", "door-test").then(() => "placed", (e: Error) => e.message);
  assert.equal(spent, "not_allowed");
});

test("the grant store the gate uses starts empty", () => {
  assert.equal(grants.live(Date.now()).length, 0);
});

test("a refusal at a door becomes the TaskError kinds the callers already use", () => {
  const word = (reason: "unsafe" | "player_built" | "protected" | "unknown" | "not_allowed") => taskErrorOf({ ok: false, reason, detail: "words" });
  assert.deepEqual(["player_built", "protected", "unsafe", "unknown", "not_allowed"].map((r) => word(r as never).reason), ["refused", "protected", "blocked", "blocked", "refused"]);
  assert.equal(word("player_built").detail, "words");
});
