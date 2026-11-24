import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backoffFor,
  decide,
  FAIL_BACKOFF_MS,
  HOME_RANGE,
  isNight,
  NIGHT_FROM,
  NIGHT_TO,
  SLEEP_REACH,
  START_IDLE_MS,
  whyFailed,
  type Facts,
} from "../src/behaviors/night";

const base: Facts = {
  timeOfDay: 14000,
  thunder: false,
  dimension: "overworld",
  homeDistance: 20,
  bedDistance: 20,
  idle: true,
  idleMs: START_IDLE_MS,
  asleep: false,
  walking: false,
  now: 100_000,
  retryAt: 0,
  sleptTonight: false,
};
const verdict = (over: Partial<Facts>) => decide({ ...base, ...over });

test("night is the window mineflayer's sleep accepts, or any thunderstorm", () => {
  assert.ok(!isNight(NIGHT_FROM - 1, false));
  assert.ok(isNight(NIGHT_FROM, false));
  assert.ok(isNight(NIGHT_TO, false));
  assert.ok(!isNight(NIGHT_TO + 1, false));
  assert.ok(!isNight(1000, false));
  assert.ok(isNight(1000, true), "thunder by day");
  assert.ok(!isNight(null, false), "no clock yet");
});

test("by day, or outside the overworld, it stays", () => {
  assert.equal(verdict({ timeOfDay: 6000 }), "stay");
  assert.equal(verdict({ dimension: "the_nether" }), "stay");
  assert.equal(verdict({ dimension: null }), "stay");
  assert.equal(verdict({ dimension: "minecraft:overworld" }), "go_home");
});

test("idle at night: walk home, or sleep when it is already at the bed", () => {
  assert.equal(verdict({}), "go_home");
  assert.equal(verdict({ bedDistance: SLEEP_REACH }), "sleep");
  assert.equal(verdict({ bedDistance: SLEEP_REACH + 0.1 }), "go_home");
  assert.equal(verdict({ timeOfDay: 6000, thunder: true }), "go_home");
});

test("anything owning the body keeps it from going to bed", () => {
  assert.equal(verdict({ idle: false }), "stay");
  assert.equal(verdict({ asleep: true }), "stay");
  assert.equal(verdict({ idleMs: START_IDLE_MS - 1 }), "stay");
});

test("beyond the range it says too_far and never walks", () => {
  assert.equal(verdict({ homeDistance: HOME_RANGE }), "go_home");
  assert.equal(verdict({ homeDistance: HOME_RANGE + 1 }), "too_far");
  // too far is only said once the body has been idle a moment, like a walk would wait
  assert.equal(verdict({ homeDistance: HOME_RANGE + 1, idle: false }), "stay");
});

test("back-off after a cut attempt holds until it passes", () => {
  assert.equal(verdict({ retryAt: base.now + 1 }), "stay");
  assert.equal(verdict({ retryAt: base.now }), "go_home");
});

test("a night the server already ended its sleep is over for the bot", () => {
  assert.equal(verdict({ sleptTonight: true }), "stay");
});

test("a walk in flight carries on until day, an order or a reflex", () => {
  assert.equal(verdict({ walking: true, idleMs: 0, retryAt: base.now + 1e6 }), "go_home");
  assert.equal(verdict({ walking: true, timeOfDay: 23_459 }), "stay");
  assert.equal(verdict({ walking: true, idle: false }), "stay");
  assert.equal(verdict({ walking: true, dimension: "the_end" }), "stay");
});

test("failures are told apart: cut, stuck, and the server's own refusals", () => {
  const free = { cancelled: false, reflex: false };
  assert.equal(whyFailed(new Error("stuck"), free), "stuck");
  assert.equal(whyFailed(Object.assign(new Error("No path to the goal!"), { name: "NoPath" }), free), "stuck");
  assert.equal(whyFailed(Object.assign(new Error("Took to long"), { name: "Timeout" }), free), "stuck");
  assert.equal(whyFailed(Object.assign(new Error("x"), { name: "GoalChanged" }), free), "cut");
  assert.equal(whyFailed(Object.assign(new Error("x"), { name: "PathStopped" }), free), "cut");
  assert.equal(whyFailed(new Error("interrupted"), free), "cut");
  assert.equal(whyFailed(new Error("stuck"), { cancelled: true, reflex: false }), "cut");
  assert.equal(whyFailed(new Error("stuck"), { cancelled: false, reflex: true }), "cut");
  assert.equal(whyFailed(new Error("there are monsters nearby"), free), "monsters_nearby");
  assert.equal(whyFailed(new Error("the bed is occupied"), free), "bed_occupied");
  assert.equal(whyFailed(new Error("wrong block : not a bed block"), free), "bed_missing");
  assert.equal(whyFailed(new Error("there's only half bed"), free), "bed_missing");
  assert.equal(whyFailed(new Error("it's not night and it's not a thunderstorm"), free), "not_night");
  assert.equal(whyFailed(new Error("bot is not sleeping"), free), "other");
  assert.equal(whyFailed(new Error("the bed is too far"), free), "other");
});

test("only real failures earn the long back-off", () => {
  assert.equal(backoffFor("cut"), 0);
  assert.equal(backoffFor("not_night"), 0);
  assert.equal(backoffFor("stuck"), FAIL_BACKOFF_MS);
  assert.equal(backoffFor("monsters_nearby"), FAIL_BACKOFF_MS);
});
