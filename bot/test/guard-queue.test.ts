import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { comingLine, fullLine, queuedLine } from "../src/behaviors/callouts";
import { GuardQueue, QUEUE_CAP } from "../src/behaviors/guard-queue";
import { EventLog } from "../src/api/events";
import { sayable } from "../src/lib/speech";

test("queue: nobody guarded means start, the ward again is the same, a stranger waits", () => {
  const q = new GuardQueue();
  assert.equal(q.ask(null, "A"), "start");
  assert.equal(q.ask("A", "A"), "same");
  assert.equal(q.ask("A", "B"), "queued");
  assert.equal(q.ask("A", "B"), "waiting");
  assert.equal(q.size, 1);
});

test("queue: four wait, the fifth is told it is full and is not kept", () => {
  const q = new GuardQueue();
  for (let i = 0; i < QUEUE_CAP; i++) assert.equal(q.ask("A", `P${i}`), "queued");
  assert.equal(q.ask("A", "P9"), "full");
  assert.equal(q.size, QUEUE_CAP);
  assert.equal(q.ask("A", "P0"), "waiting"); // already in line, not "full"
});

test("queue: first in, first out, and players who are gone are skipped and dropped", () => {
  const q = new GuardQueue();
  for (const p of ["B", "C", "D"]) q.ask("A", p);
  assert.equal(q.next((p) => p !== "B"), "C");
  assert.equal(q.size, 1);
  assert.equal(q.next(() => true), "D");
  assert.equal(q.next(() => true), null);
  q.ask("A", "E");
  assert.equal(q.next(() => false), null);
  assert.equal(q.size, 0);
});

test("queue: the five stops", () => {
  const q = new GuardQueue();
  for (const p of ["B", "C"]) q.ask("A", p);
  assert.equal(q.stop("A", "C"), "dequeue"); // a waiting player leaves the line, only them
  assert.equal(q.size, 1);
  assert.equal(q.stop("A", "A"), "handover"); // the ward: the line stays for the hand-over
  assert.equal(q.size, 1);
  assert.equal(q.stop("A", "Z"), "all"); // anyone else stops everything
  assert.equal(q.size, 0);
  q.ask("A", "B");
  assert.equal(q.stop("A", undefined), "all"); // the API has no speaker
  assert.equal(q.size, 0);
  assert.equal(q.stop(null, "A"), "all"); // no guard running
});

test("the queue lines are plain chat text with the longest names", () => {
  const long = "A".repeat(16);
  for (const line of [queuedLine(long, long), fullLine(long), comingLine(long)]) assert.ok(sayable(line), line);
  assert.equal(queuedLine("Sam", "Kit"), "I'm with Sam right now, Kit. You're next.");
  assert.equal(comingLine("Kit"), "Coming, Kit.");
});

function rig(over: Partial<BodyControl> = {}) {
  const calls: string[] = [];
  const here = new Set(["A", "B", "C", "D", "E", "F"]);
  let fail: (e: Error) => void = () => {};
  const body = {
    inGame: () => true,
    fighting: () => false,
    danger: () => false,
    busy: () => false,
    canSee: (p: string) => here.has(p),
    vitals: () => ({ health: 20, food: 20 }),
    guard: (p: string) => {
      calls.push(`guard:${p}`);
      return new Promise<void>((_, rej) => (fail = rej));
    },
    comeTo: () => new Promise<void>(() => {}),
    stop: () => void calls.push("stop"),
    interrupt: () => void calls.push("interrupt"),
    announce: (t: string) => void calls.push(`say:${t}`),
    ...over,
  } as unknown as BodyControl;
  const log = new EventLog();
  const later: Array<() => void> = [];
  const d = createDispatcher(body, log, Date.now, (fn) => void later.push(fn));
  const events = () => log.since(0).events.map((e) => [e.event, e.kind ?? e.reason].filter(Boolean).join(":"));
  const chat = (name: string, intent: "guard" | "stop") => d.handle(intent === "guard" ? { intent, player: name } : { intent }, name);
  return { d, calls, here, later, events, chat, lose: (e = "lost_ward") => fail(new Error(e)) };
}

test("guard me from the ward again does nothing: no restart, nothing said", () => {
  const r = rig();
  const first = r.chat("A", "guard");
  const again = r.chat("A", "guard");
  assert.deepEqual(r.calls, ["guard:A"]);
  assert.deepEqual(r.events(), ["task_started:guard:A"]);
  assert.equal(again.kind, "accepted");
  assert.equal(again.kind === "accepted" && again.taskId, first.kind === "accepted" && first.taskId);
});

test("guard me from a second player queues them and says one line; the guard stays on the first", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.chat("B", "guard");
  assert.deepEqual(r.calls, ["guard:A", "say:I'm with A right now, B. You're next."]);
  assert.deepEqual(r.events(), ["task_started:guard:A"]);
  assert.equal(r.d.snapshot().task, "guard:A");
});

test("a full queue says its own line once per ask and keeps nobody extra", () => {
  const r = rig();
  r.chat("A", "guard");
  for (const p of ["B", "C", "D", "E"]) r.chat(p, "guard");
  r.chat("F", "guard");
  assert.equal(r.calls.at(-1), "say:I've got a few waiting already, F, try again in a bit.");
  for (const p of ["A", "B", "C", "D", "E"]) r.chat(p, "stop"); // each hands over to the next in line
  assert.equal(r.calls.filter((c) => c.startsWith("guard:")).join(), "guard:A,guard:B,guard:C,guard:D,guard:E");
  assert.equal(r.d.snapshot().task, null, "F was not kept");
});

test("the ward's stop hands over in order: task_stopped, then task_started for the next", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.chat("C", "guard");
  r.chat("A", "stop");
  assert.deepEqual(r.events(), ["task_started:guard:A", "task_stopped", "task_started:guard:B"]);
  assert.equal(r.calls.at(-1), "say:Coming, B.");
  assert.equal(r.d.snapshot().task, "guard:B");
  r.chat("B", "stop");
  assert.equal(r.d.snapshot().task, "guard:C"); // C was still waiting
});

test("a waiting player's stop removes only them and the guard carries on", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.chat("C", "guard");
  const out = r.chat("B", "stop");
  assert.deepEqual(out, { kind: "accepted" });
  assert.deepEqual(r.events(), ["task_started:guard:A"]);
  assert.ok(!r.calls.includes("stop"));
  r.chat("A", "stop");
  assert.equal(r.d.snapshot().task, "guard:C"); // B is gone from the line
});

test("a stop from a third player or over the API stops everything and empties the queue", () => {
  for (const speaker of ["Z", undefined]) {
    const r = rig();
    r.chat("A", "guard");
    r.chat("B", "guard");
    r.d.handle({ intent: "stop" }, speaker);
    assert.deepEqual(r.events(), ["task_started:guard:A", "task_stopped"]);
    assert.equal(r.d.snapshot().task, null);
    r.chat("A", "guard");
    r.chat("A", "stop");
    assert.equal(r.d.snapshot().task, null, "B was not left waiting");
  }
});

test("the ward stopping with nobody waiting is a plain stop", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("A", "stop");
  assert.deepEqual(r.events(), ["task_started:guard:A", "task_stopped"]);
  assert.equal(r.d.snapshot().task, null);
});

test("hand-over skips a queued player who left and drops them", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.chat("C", "guard");
  r.here.delete("B");
  r.chat("A", "stop");
  assert.equal(r.d.snapshot().task, "guard:C");
  r.chat("C", "stop");
  assert.equal(r.d.snapshot().task, null);
});

test("with everyone waiting gone the body just goes idle", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.here.delete("B");
  r.chat("A", "stop");
  assert.equal(r.d.snapshot().task, null);
  assert.deepEqual(r.events(), ["task_started:guard:A", "task_stopped"]);
});

test("losing the ward hands over after the task_failed lost_ward event", async () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.lose();
  await Promise.resolve();
  assert.deepEqual(r.events(), ["task_started:guard:A", "task_failed:lost_ward", "task_started:guard:B"]);
});

test("a death hands over later, not in the death itself; a disconnect forgets the queue", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.d.bodyDied();
  assert.equal(r.d.snapshot().task, null);
  assert.equal(r.later.length, 1);
  r.later[0]();
  assert.equal(r.d.snapshot().task, "guard:B");

  const q = rig();
  q.chat("A", "guard");
  q.chat("B", "guard");
  q.d.bodyDisconnected("kicked");
  assert.equal(q.later.length, 0);
  q.chat("C", "guard");
  q.chat("C", "stop");
  assert.equal(q.d.snapshot().task, null);
});

test("an order that replaces the guard empties the queue, and an API guard replaces without queueing", () => {
  const r = rig();
  r.chat("A", "guard");
  r.chat("B", "guard");
  r.d.handle({ intent: "come_to", player: "A" });
  r.d.handle({ intent: "guard", player: "C" }); // API: no speaker
  assert.equal(r.d.snapshot().task, "guard:C");
  r.chat("C", "stop");
  assert.equal(r.d.snapshot().task, null, "B was not left waiting");

  const s = rig();
  s.chat("A", "guard");
  s.d.handle({ intent: "guard", player: "B" });
  assert.equal(s.d.snapshot().task, "guard:B");
  assert.deepEqual(s.events(), ["task_started:guard:A", "task_stopped", "task_started:guard:B"]);
});

test("a request from a player out of view is refused as before, not queued", () => {
  const r = rig();
  r.chat("A", "guard");
  r.here.delete("B");
  assert.deepEqual(r.chat("B", "guard"), { kind: "rejected", reason: "unknown_player" });
  assert.deepEqual(r.calls, ["guard:A"]);
});
