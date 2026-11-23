import assert from "node:assert/strict";
import { test } from "node:test";
import { judge, MAX_NUDGES, MIN_MOVE, SAMPLE_MS, spread, trim, WINDOW_MS, type Context, type Sample } from "../src/behaviors/stuck";

const walking: Context = { goalSet: true, busy: false, nudges: 0 };

// one sample per tick from t = 0, position given by `at`
function run(seconds: number, at: (t: number) => [number, number, number]): { samples: Sample[]; now: number } {
  const samples: Sample[] = [];
  let now = 0;
  for (let t = 0; t <= seconds * 1000; t += SAMPLE_MS) {
    const [x, y, z] = at(t);
    samples.push({ t, x, y, z });
    now = t;
  }
  return { samples, now };
}

const still = () => [5, 64, 5] as [number, number, number];

test("not enough history is ok, however still the body is", () => {
  const { samples, now } = run(WINDOW_MS / 1000 - 1, still);
  assert.equal(judge(samples, now, walking), "ok");
});

test("a full window without moving a block is a nudge, and give_up once the nudges are spent", () => {
  const { samples, now } = run(WINDOW_MS / 1000, still);
  assert.equal(judge(samples, now, walking), "nudge");
  assert.equal(judge(samples, now, { ...walking, nudges: MAX_NUDGES - 1 }), "nudge");
  assert.equal(judge(samples, now, { ...walking, nudges: MAX_NUDGES }), "give_up");
});

test("slow but real walking is never stuck", () => {
  // a block and a half over the window, 0.19 blocks a second
  const { samples, now } = run(20, (t) => [t * 0.00019, 64, 0]);
  assert.equal(judge(samples, now, walking), "ok");
});

test("just under a block over the window is stuck, a block is not", () => {
  const under = run(WINDOW_MS / 1000, (t) => [(t / WINDOW_MS) * (MIN_MOVE - 0.05), 64, 0]);
  assert.equal(judge(under.samples, under.now, walking), "nudge");
  const enough = run(WINDOW_MS / 1000, (t) => [(t / WINDOW_MS) * (MIN_MOVE + 0.05), 64, 0]);
  assert.equal(judge(enough.samples, enough.now, walking), "ok");
});

test("only the last window counts: a long walk that then stalls is stuck", () => {
  const { samples, now } = run(30, (t) => [Math.min(t, 10_000) / 1000, 64, 0]);
  assert.equal(judge(trim(samples, now), now, walking), "nudge");
});

test("jumping on the spot is not progress, climbing is", () => {
  const hop = run(WINDOW_MS / 1000, (t) => [5, 64 + (Math.floor(t / SAMPLE_MS) % 4 === 2 ? 1.25 : 0), 5]);
  assert.equal(judge(hop.samples, hop.now, walking), "nudge");
  const climb = run(WINDOW_MS / 1000, (t) => [5, 64 + (t / WINDOW_MS) * 6, 5]);
  assert.equal(judge(climb.samples, climb.now, walking), "ok");
});

test("a dig, an open window or a reflex holding the body is legitimate, as is no goal", () => {
  const { samples, now } = run(WINDOW_MS / 1000, still);
  assert.equal(judge(samples, now, { ...walking, busy: true }), "ok");
  assert.equal(judge(samples, now, { ...walking, goalSet: false }), "ok");
});

test("trim drops what is older than the window plus a margin", () => {
  const { samples, now } = run(30, still);
  const kept = trim(samples, now);
  assert.ok(now - kept[0].t <= WINDOW_MS + 2 * SAMPLE_MS);
  assert.ok(now - kept[0].t >= WINDOW_MS);
});

test("spread of nothing is nothing", () => {
  assert.equal(spread([]), 0);
});
