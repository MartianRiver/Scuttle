import assert from "node:assert/strict";
import { test } from "node:test";
import { CALLOUT_GAP_MS, CalloutLimiter, clearLine, warnLine } from "../src/behaviors/callouts";
import { mergeThreats, watchWard, WARD_LOST_MS, WARD_MAX_BLOCKS, wardThreats } from "../src/behaviors/escort-policy";

const ward = { x: 0, y: 0, z: 0 };
const mob = (name: string, x: number, id = x, y = 0, z = 0) => ({ id, name, x, y, z });

test("ward threats: hostile mobs within 10 of the ward, 16 once a fight is on", () => {
  const mobs = [mob("zombie", 9), mob("zombie", 11), mob("skeleton", 15), mob("creeper", 0, 99, 17)];
  assert.deepEqual(wardThreats(ward, mobs, false).map((m) => m.id), [9]);
  assert.deepEqual(wardThreats(ward, mobs, true).map((m) => m.id), [9, 11, 15]);
});

test("ward threats are measured in 3D: a zombie in a cave under the ward is not one", () => {
  assert.equal(wardThreats(ward, [{ id: 1, name: "zombie", x: 2, y: -15, z: 0 }], false).length, 0);
});

test("merging the body's threats and the ward's keeps each mob once", () => {
  const merged = mergeThreats([mob("zombie", 1), mob("zombie", 2)], [mob("zombie", 2), mob("husk", 3)]);
  assert.deepEqual(merged.map((m) => m.id), [1, 2, 3]);
});

test("lost ward: 15 s out of view or past 48 blocks, any sight of it starts over", () => {
  let w = watchWard(null, 1000, 5);
  assert.deepEqual(w, { since: null, lost: false });
  w = watchWard(w.since, 2000, null);
  assert.deepEqual(w, { since: 2000, lost: false });
  w = watchWard(w.since, 2000 + WARD_LOST_MS - 1, null);
  assert.equal(w.lost, false);
  assert.equal(watchWard(w.since, 2000 + WARD_LOST_MS, null).lost, true);
  // seen again: the clock is cleared
  assert.deepEqual(watchWard(w.since, 9000, 10), { since: null, lost: false });
  // in view but too far counts as gone
  assert.equal(watchWard(3000, 3000 + WARD_LOST_MS, WARD_MAX_BLOCKS + 1).lost, true);
  assert.equal(watchWard(null, 3000, WARD_MAX_BLOCKS).lost, false);
});

test("callouts are fixed phrases with the player's name", () => {
  assert.equal(warnLine("zombie", "Sam"), "Zombie near you, Sam!");
  assert.equal(warnLine("husk", "Sam"), "Zombie near you, Sam!");
  assert.equal(warnLine("creeper", "Sam"), "Creeper near you, Sam!");
  assert.equal(warnLine("ravager", "Sam"), "Something nasty near you, Sam!");
  assert.equal(clearLine("Sam"), "All clear, Sam.");
});

test("callouts: once per mob, one line every 5 s", () => {
  const l = new CalloutLimiter();
  const z1 = { id: 1, name: "zombie" };
  const z2 = { id: 2, name: "zombie" };
  assert.equal(l.next(0, [z1], "Sam"), "Zombie near you, Sam!");
  assert.equal(l.next(250, [z1], "Sam"), null); // same mob
  assert.equal(l.next(1000, [z1, z2], "Sam"), null); // new mob but inside the gap
  assert.equal(l.next(CALLOUT_GAP_MS - 1, [z1, z2], "Sam"), null);
  assert.equal(l.next(CALLOUT_GAP_MS, [z1, z2], "Sam"), "Zombie near you, Sam!");
  assert.equal(l.next(CALLOUT_GAP_MS + 250, [z1, z2], "Sam"), null); // both said
});

test("callouts: a creeper is called before the zombie next to it", () => {
  const l = new CalloutLimiter();
  assert.equal(l.next(0, [{ id: 1, name: "zombie" }, { id: 2, name: "creeper" }], "Sam"), "Creeper near you, Sam!");
});

test("callouts: one all-clear after a fight, after it has been quiet, waiting for the gap", () => {
  const l = new CalloutLimiter();
  assert.equal(l.next(0, [], "Sam"), null); // nothing happened, nothing said
  l.next(1000, [{ id: 1, name: "zombie" }], "Sam");
  assert.equal(l.next(1500, [], "Sam"), null); // quiet only just began
  assert.equal(l.next(3000, [], "Sam"), null); // quiet for 1.5 s, and inside the 5 s gap
  assert.equal(l.next(6000, [], "Sam"), "All clear, Sam.");
  assert.equal(l.next(9000, [], "Sam"), null); // once
});

test("callouts: a new threat cancels a waiting all-clear", () => {
  const l = new CalloutLimiter();
  l.next(0, [{ id: 1, name: "zombie" }], "Sam");
  assert.equal(l.next(3000, [], "Sam"), null); // quiet begins
  assert.equal(l.next(5500, [{ id: 2, name: "skeleton" }], "Sam"), "Skeleton near you, Sam!"); // quiet cancelled
  assert.equal(l.next(6000, [], "Sam"), null);
  assert.equal(l.next(8100, [], "Sam"), null); // quiet for 2 s, but a line was said 2.6 s ago
  assert.equal(l.next(10500, [], "Sam"), "All clear, Sam.");
});
