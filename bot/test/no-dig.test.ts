import assert from "node:assert/strict";
import { test } from "node:test";
import { NoDigMap, noteMade, type Zone } from "../src/behaviors/no-dig";

const p = (x: number, y: number, z: number) => ({ x, y, z });
const col = (x: number, z: number, r: number, reason: Zone["reason"], at = 0) => ({ x, z, r, reason, at });

test("covers is a circle on the ground; with y it is a ball", () => {
  const m = new NoDigMap();
  m.add({ x: 0, z: 0, r: 5, reason: "asked" }, 0);
  assert.ok(m.covers(p(3, -100, 4)));
  assert.ok(m.covers(p(5, 64, 0)));
  assert.ok(!m.covers(p(4, 64, 4)));
  m.add({ x: 100, z: 100, y: 70, r: 6, reason: "made" }, 0);
  assert.ok(m.covers(p(100, 76, 100)));
  assert.ok(!m.covers(p(100, 77, 100)));
  assert.equal(m.find(p(100, 70, 100))?.reason, "made");
});

test("overlapping zones of the same reason merge into one that holds both", () => {
  const m = new NoDigMap();
  m.add(col(0, 0, 5, "made", 1));
  m.add(col(8, 0, 5, "made", 2));
  assert.equal(m.size, 1);
  const [z] = m.list();
  assert.equal(z.r, 9);
  assert.equal(z.x, 4);
  assert.equal(z.at, 2);
  assert.ok(m.covers(p(-4, 0, 0)) && m.covers(p(12, 0, 0)));
});

test("a zone inside another is absorbed, different reasons and far zones stay apart", () => {
  const m = new NoDigMap();
  m.add(col(0, 0, 10, "made"));
  m.add(col(2, 0, 3, "made"));
  assert.equal(m.size, 1);
  assert.equal(m.list()[0].r, 10);
  m.add(col(2, 0, 3, "reverted"));
  m.add(col(50, 50, 3, "made"));
  assert.equal(m.size, 3);
});

test("a ball and a column of the same reason merge into a column, and a ball inside a column goes", () => {
  const m = new NoDigMap();
  m.add({ x: 0, z: 0, y: 70, r: 6, reason: "made" });
  m.add(col(4, 0, 6, "made"));
  assert.equal(m.size, 1);
  assert.equal(m.list()[0].y, undefined);
  assert.ok(m.covers(p(4, -50, 0)));
});

test("merging stops before one circle grows past the limit", () => {
  const m = new NoDigMap();
  for (let i = 0; i < 20; i++) m.add(col(i * 8, 0, 5, "made")); // a chain of touching circles, 150 long
  assert.ok(m.size > 1);
  for (const z of m.list()) assert.ok(z.r <= 48);
  for (let i = 0; i < 20; i++) assert.ok(m.covers(p(i * 8, 0, 0)));
});

test("forget drops only old reverted zones", () => {
  const m = new NoDigMap();
  m.add(col(0, 0, 3, "reverted", 0));
  m.add(col(20, 0, 3, "reverted", 900));
  m.add(col(40, 0, 3, "made", 0));
  m.add(col(60, 0, 3, "asked", 0));
  assert.equal(m.forget(500, 1000), 1);
  assert.deepEqual(m.list().map((z) => z.x).sort((a, b) => a - b), [20, 40, 60]);
});

test("over the cap the oldest reverted goes first, then asked, never made", () => {
  const m = new NoDigMap(3);
  m.add(col(0, 0, 1, "made", 1));
  m.add(col(10, 0, 1, "reverted", 5));
  m.add(col(20, 0, 1, "reverted", 2));
  m.add(col(30, 0, 1, "asked", 3));
  assert.deepEqual(m.list().map((z) => z.x).sort((a, b) => a - b), [0, 10, 30]);
  m.add(col(40, 0, 1, "made", 6));
  assert.deepEqual(m.list().map((z) => z.x).sort((a, b) => a - b), [0, 30, 40]); // reverted gone
  m.add(col(50, 0, 1, "made", 7));
  assert.deepEqual(m.list().map((z) => z.x).sort((a, b) => a - b), [0, 40, 50]); // asked gone
});

test("a map of only made zones at the cap folds the closest two and keeps covering both", () => {
  const m = new NoDigMap(3);
  m.add(col(0, 0, 1, "made"));
  m.add(col(10, 0, 1, "made"));
  m.add(col(50, 0, 1, "made"));
  m.add(col(100, 0, 1, "made"));
  assert.equal(m.size, 3);
  assert.ok(m.covers(p(0, 0, 0)) && m.covers(p(10, 0, 0)) && m.covers(p(50, 0, 0)) && m.covers(p(100, 0, 0)));
  assert.ok(m.list().every((z) => z.reason === "made"));
});

test("json round trip keeps zones, heights and ages", () => {
  const m = new NoDigMap();
  m.add({ x: 1.5, z: -2, y: 64, r: 7, reason: "made" }, 11);
  m.add(col(100, 100, 12, "reverted", 22));
  const text = JSON.stringify(m);
  const back = NoDigMap.fromJSON(text);
  assert.deepEqual(back.toJSON(), m.toJSON());
  assert.deepEqual(NoDigMap.fromJSON(JSON.parse(text)).toJSON(), m.toJSON());
});

test("bad input gives an empty map or skips the bad zones, never throws", () => {
  for (const raw of ["", "{not json", "null", "42", "[]", '{"zones":5}', undefined, null, 7, { zones: "x" }]) {
    assert.equal(NoDigMap.fromJSON(raw).size, 0, String(raw));
  }
  const mixed = {
    zones: [
      col(0, 0, 5, "made"),
      { x: "1", z: 0, r: 3, reason: "made", at: 0 },
      { x: 1, z: 0, r: -3, reason: "made", at: 0 },
      { x: 1, z: 0, r: 3, reason: "nope", at: 0 },
      { x: 1, z: 0, r: 3, reason: "made" },
      { x: 1, z: 0, r: NaN, reason: "made", at: 0 },
      { x: 1, z: 0, r: 3, y: "up", reason: "made", at: 0 },
      null,
      5,
      col(100, 100, 5, "asked"),
    ],
  };
  const m = NoDigMap.fromJSON(mixed);
  assert.equal(m.size, 2);
  assert.equal(NoDigMap.fromJSON({ zones: Array.from({ length: 50 }, (_, i) => col(i * 100, 0, 1, "reverted", i)) }, 10).size, 10);
});

// a made 3x3x3 block of planks at a corner
function cube(x: number, y: number, z: number) {
  const out = [];
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) for (let dz = 0; dz < 3; dz++) out.push(p(x + dx, y + dy, z + dz));
  return out;
}

test("noteMade makes one zone per cluster, centred on it, reaching 3 past the farthest block", () => {
  const m = new NoDigMap();
  noteMade(m, cube(10, 70, 10), 5);
  assert.equal(m.size, 1);
  const [z] = m.list();
  assert.deepEqual([z.x, z.y, z.z], [11, 71, 11]);
  assert.equal(z.reason, "made");
  assert.equal(z.at, 5);
  assert.equal(z.r, Math.ceil(Math.hypot(1, 1)) + 3);
  assert.ok(m.covers(p(11, 71, 11)) && m.covers(p(11, 71, 16)) && !m.covers(p(11, 71, 30)));
});

test("blocks within 4 of each other are one build, chained; far ones are another", () => {
  const m = new NoDigMap();
  // a line of single blocks 4 apart reads as one build, a second line far off as another
  noteMade(m, [p(0, 70, 0), p(4, 70, 0), p(8, 70, 0), p(200, 70, 200), p(204, 70, 200)]);
  assert.equal(m.size, 2);
  assert.ok(m.covers(p(0, 70, 0)) && m.covers(p(8, 70, 0)) && m.covers(p(204, 70, 200)));
  const m2 = new NoDigMap();
  noteMade(m2, [p(0, 70, 0), p(5, 70, 0)]); // 5 apart: two builds, though their circles touch and so merge
  assert.equal(m2.size, 1);
  noteMade(new NoDigMap(), []); // nothing seen is fine
});

test("noteMade on the same build twice doesn't pile up zones", () => {
  const m = new NoDigMap();
  noteMade(m, cube(10, 70, 10));
  noteMade(m, cube(10, 70, 10));
  noteMade(m, cube(12, 70, 10));
  assert.equal(m.size, 1);
});
