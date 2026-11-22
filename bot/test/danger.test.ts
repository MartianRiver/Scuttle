import assert from "node:assert/strict";
import { test } from "node:test";
import { calm, fleeTarget, FLEE_DISTANCE, step, threatening, type Mob } from "../src/behaviors/danger";

const me = { x: 0, y: 0, z: 0 };
const mob = (name: string, x: number, z = 0): Mob => ({ name, x, y: 0, z });

test("only mobs inside their radius count, creepers closer than skeletons", () => {
  assert.equal(threatening(me, [mob("zombie", 9)], false).length, 1);
  assert.equal(threatening(me, [mob("zombie", 11)], false).length, 0);
  assert.equal(threatening(me, [mob("creeper", 9.5)], false).length, 0);
  assert.equal(threatening(me, [mob("skeleton", 19)], false).length, 1);
});

test("a mob far above or below does not count, one level with the bot does", () => {
  assert.equal(threatening(me, [{ name: "zombie", x: 5, y: -20, z: 0 }], false).length, 0);
  assert.equal(threatening(me, [{ name: "skeleton", x: 5, y: 40, z: 0 }], false).length, 0);
  assert.equal(threatening(me, [{ name: "zombie", x: 5, y: 0, z: 0 }], false).length, 1);
});

test("a fleeing body keeps running until the mob is well clear", () => {
  const z = [mob("zombie", 13)];
  assert.equal(threatening(me, z, false).length, 0);
  assert.equal(threatening(me, z, true).length, 1);
  assert.equal(threatening(me, [mob("zombie", 17)], true).length, 0);
});

test("the flee point is away from the threats, nearest weighing most", () => {
  const t = fleeTarget(me, [mob("zombie", 5)]);
  assert.ok(t.x < 0 && Math.abs(Math.hypot(t.x, t.z) - FLEE_DISTANCE) < 1e-9);
  const both = fleeTarget(me, [mob("zombie", 3), mob("zombie", -8)]);
  assert.ok(both.x < 0, "the close one on the right wins over the far one on the left");
});

test("reaction delay is drawn once for a new threat and only then acts", () => {
  const z = [mob("zombie", 5)];
  let draws = 0;
  const draw = () => (draws++, 400);
  let r = step(calm(), z, 1000, draw);
  assert.equal(r.flee, false);
  r = step(r.state, z, 1300, draw);
  assert.equal(r.flee, false);
  r = step(r.state, z, 1400, draw);
  assert.equal(r.flee, true);
  r = step(r.state, z, 5000, draw);
  assert.equal(r.flee, true);
  assert.equal(draws, 1);
});

test("a threat that goes away resets the state, the next one waits again", () => {
  const z = [mob("zombie", 5)];
  let r = step(calm(), z, 0, () => 100);
  r = step(r.state, z, 200, () => 100);
  assert.equal(r.flee, true);
  r = step(r.state, [], 300, () => 100);
  assert.deepEqual(r.state, calm());
  r = step(r.state, z, 400, () => 100);
  assert.equal(r.flee, false);
});
