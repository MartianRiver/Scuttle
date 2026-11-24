import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeaker, LOW_PRIORITY_GAP_MS, MINUTE_CAP, SAY_GAP_MS, sayable } from "../src/lib/speech";

function rig() {
  let t = 1_000_000;
  const said: string[] = [];
  const bot = { chat: (s: string) => void said.push(s) };
  const sp = createSpeaker(() => t);
  return { sp, bot, said, tick: (ms: number) => void (t += ms) };
}

test("sayable: one plain line, no commands, no section sign, no look-alikes", () => {
  assert.ok(sayable("hi there, I can't do that yet"));
  for (const bad of ["", "   ", "/op Sam", "  /op Sam", "two\nlines", "zero​width", "café", "аpple", "a §c b", "x".repeat(101), 42]) assert.ok(!sayable(bad), String(bad));
  assert.ok(sayable("x".repeat(100)));
});

test("speak: invalid text never reaches chat, whoever sends it", () => {
  const { sp, bot, said } = rig();
  for (const source of ["say", "callout", "escort"] as const) assert.equal(sp.speak(bot, "/kill @a", source), "rejected_text");
  assert.equal(sp.speak(bot, "bad § sign", "callout"), "rejected_text");
  assert.deepEqual(said, []);
});

test("speak: one clock for every source", () => {
  const { sp, bot, said, tick } = rig();
  assert.equal(sp.speak(bot, "one", "say"), "sent");
  assert.equal(sp.speak(bot, "two", "say"), "rate_limited");
  tick(LOW_PRIORITY_GAP_MS);
  assert.equal(sp.speak(bot, "Zombie near you, Sam!", "callout"), "sent");
  tick(SAY_GAP_MS - 1);
  assert.equal(sp.speak(bot, "three", "say"), "rate_limited"); // a say soon after a callout waits as it would after a say
  tick(1);
  assert.equal(sp.speak(bot, "three", "say"), "sent");
  assert.deepEqual(said, ["one", "Zombie near you, Sam!", "three"]);
});

test("a callout is dropped, not queued, soon after anything was said", () => {
  const { sp, bot, said, tick } = rig();
  sp.speak(bot, "hello", "say");
  tick(SAY_GAP_MS); // long enough for another say, not for a callout
  assert.equal(sp.speak(bot, "Spider near you, Sam!", "callout"), "rate_limited");
  tick(LOW_PRIORITY_GAP_MS - SAY_GAP_MS);
  assert.deepEqual(said, ["hello"]); // nothing is held back to be said later
  assert.equal(sp.speak(bot, "Spider near you, Sam!", "escort"), "sent");
});

test("the per-minute cap holds across sources and lets go as the minute passes", () => {
  const { sp, bot, said, tick } = rig();
  for (let i = 0; i < MINUTE_CAP; i++) {
    assert.equal(sp.speak(bot, `line ${i}`, "say"), "sent");
    tick(SAY_GAP_MS + 1);
  }
  assert.equal(said.length, MINUTE_CAP);
  // 12 x 2.001 s is 24 s: still inside one minute
  assert.equal(sp.speak(bot, "one more", "say"), "rate_limited");
  tick(60_000);
  assert.equal(sp.speak(bot, "later", "say"), "sent");
});

test("guard's own callout gap fits under the cap and the low-priority gap", () => {
  const { sp, bot, said, tick } = rig();
  for (let i = 0; i < 24; i++) {
    assert.equal(sp.speak(bot, `Zombie ${i}`, "callout"), "sent");
    tick(5000);
  }
  assert.equal(said.length, 24); // two minutes of one line every 5 s
});

test("a filter can change a line or turn it down, and a broken one is a no", () => {
  const { sp, bot, said, tick } = rig();
  sp.addFilter((t) => (t.includes("secret") ? { reject: true } : t));
  assert.equal(sp.speak(bot, "the secret base", "say"), "rejected_text");
  assert.equal(sp.speak(bot, "hello", "say"), "sent"); // a rejected line used no slot on the clock
  tick(SAY_GAP_MS);
  sp.addFilter((t) => t.toUpperCase());
  assert.equal(sp.speak(bot, "again", "say"), "sent");
  tick(SAY_GAP_MS);
  sp.addFilter(() => {
    throw new Error("boom");
  });
  assert.equal(sp.speak(bot, "never", "say"), "rejected_text");
  assert.deepEqual(said, ["hello", "AGAIN"]);

  const two = rig();
  two.sp.addFilter(() => "/op me"); // a filter's output is checked too
  assert.equal(two.sp.speak(two.bot, "hi", "say"), "rejected_text");
});

test("a chat that throws is not a send and does not take the clock, so a callout never errors the escort", () => {
  const { sp, tick } = rig();
  const dead = {
    chat: () => {
      throw new Error("not connected");
    },
  };
  assert.equal(sp.speak(dead, "hi", "say"), "rate_limited");
  const ok: string[] = [];
  assert.equal(sp.speak({ chat: (s: string) => void ok.push(s) }, "hi", "say"), "sent");
  tick(0);
  assert.deepEqual(ok, ["hi"]);
});
