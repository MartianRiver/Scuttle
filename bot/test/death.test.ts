import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { AT_HOME, BANDS, deathCause, describePlace, direction } from "../src/behaviors/place";

const home = { x: 4, y: 68, z: -28 };
const at = (dx: number, dz: number, y = 68) => ({ x: home.x + dx, y, z: home.z + dz });

test("direction follows the compass: +x east, +z south", () => {
  assert.equal(direction(0, -10), "north");
  assert.equal(direction(10, -10), "north-east");
  assert.equal(direction(10, 0), "east");
  assert.equal(direction(10, 10), "south-east");
  assert.equal(direction(0, 10), "south");
  assert.equal(direction(-10, 10), "south-west");
  assert.equal(direction(-10, 0), "west");
  assert.equal(direction(-10, -10), "north-west");
  assert.equal(direction(1, -100), "north"); // a sliver off north is still north
});

test("place: distance band, direction, height", () => {
  assert.equal(describePlace(home, home), "at home, on the surface");
  assert.equal(describePlace(at(AT_HOME - 1, 0), home), "at home, on the surface");
  assert.equal(describePlace(at(30, -30), home), "a short walk to the north-east of home, on the surface");
  assert.equal(describePlace(at(-100, 0), home), "a fair way to the west of home, on the surface");
  assert.equal(describePlace(at(0, 200), home), "a long way to the south of home, on the surface");
  assert.equal(describePlace(at(-2000, 0), home), "far to the west of home, on the surface");
  assert.equal(describePlace(at(0, 0, 30), home), "at home, underground");
  assert.equal(describePlace(at(0, 40, -20), home), "a short walk to the south of home, deep underground");
  assert.equal(describePlace(at(0, 0, 150), home), "at home, high up");
});

test("place: a band starts at its lower edge", () => {
  let from = AT_HOME;
  for (const [max, words] of BANDS) {
    assert.ok(describePlace(at(from, 0), home).startsWith(words), `${words} from ${from}`);
    from = max;
  }
});

test("place: the other dimensions are named and not measured against home", () => {
  assert.equal(describePlace(at(500, 500, 40), home, "the_nether"), "in the Nether");
  assert.equal(describePlace(at(500, 500), home, "the_end"), "in the End");
  assert.equal(describePlace(at(500, 500), home, "somewhere_else"), "in another world");
  assert.equal(describePlace(home, home, "overworld"), "at home, on the surface");
});

test("place never contains a digit that could be read as a coordinate", () => {
  for (const dx of [-3000, -250, -40, 0, 5, 90, 700, 40000])
    for (const dz of [-3000, -77, 0, 31, 400, 40000])
      for (const y of [-60, -1, 0, 47, 48, 63, 100, 111, 300])
        for (const dim of [undefined, "overworld", "the_nether", "the_end", "x1"])
          assert.doesNotMatch(describePlace(at(dx, dz, y), home, dim), /\d/);
});

test("death cause comes from the message key, from a closed list", () => {
  const cases: Array<[string | undefined, string]> = [
    ["death.attack.mob", "mob"],
    ["death.attack.mob.item", "mob"],
    ["death.attack.arrow", "mob"],
    ["death.attack.explosion.player", "mob"],
    ["death.attack.player", "mob"],
    ["death.fell.accident.generic", "fall"],
    ["death.fell.killer", "fall"],
    ["death.attack.fall", "fall"],
    ["death.attack.lava", "lava"],
    ["death.attack.lava.player", "lava"],
    ["death.attack.inFire", "fire"],
    ["death.attack.onFire", "fire"],
    ["death.attack.hotFloor", "fire"],
    ["death.attack.drown", "drowning"],
    ["death.attack.genericKill", "other"],
    ["death.attack.starve", "other"],
    ["death.attack.outOfWorld", "other"],
    ["chat.type.text", "other"],
    [undefined, "other"],
  ];
  for (const [key, cause] of cases) assert.equal(deathCause(key), cause, String(key));
});

function stubBody(calls: string[]): BodyControl {
  return {
    inGame: () => true,
    fighting: () => false,
    danger: () => false,
    busy: () => false,
    canSee: () => true,
    vitals: () => ({ health: 20, food: 20 }),
    comeTo: () => new Promise(() => {}),
    follow: () => void calls.push("follow"),
    runTask: () => new Promise(() => {}),
    stop: () => void calls.push("stop"),
    interrupt: () => void calls.push("interrupt"),
  };
}

test("a death mid-task interrupts the body, fails the task as died, then reports where", () => {
  const log = new EventLog();
  const calls: string[] = [];
  const d = createDispatcher(stubBody(calls), log);
  d.handle({ intent: "task", name: "get_wood" });
  d.bodyDied();
  d.died("far to the west of home, on the surface", "fall");
  assert.deepEqual(calls, ["interrupt"]);
  const events = log.since(0).events;
  assert.deepEqual(events.map((e) => e.event), ["task_started", "task_failed", "died"]);
  assert.equal(events[1].reason, "died");
  assert.equal(events[2].place, "far to the west of home, on the surface");
  assert.equal(events[2].cause, "fall");
  assert.equal(d.snapshot().task, null);
});

test("a death while idle is still reported", () => {
  const log = new EventLog();
  const d = createDispatcher(stubBody([]), log);
  d.bodyDied();
  d.died("at home, underground", "other");
  assert.deepEqual(log.since(0).events.map((e) => e.event), ["died"]);
});
