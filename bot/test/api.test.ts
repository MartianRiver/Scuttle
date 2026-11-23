import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket, type WebSocketServer } from "ws";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { parseFrame } from "../src/api/protocol";
import { startApiServer } from "../src/api/server";

function stubBody(over: Partial<BodyControl> = {}) {
  const calls: string[] = [];
  let finishWalk: () => void = () => {};
  let failWalk: (e: Error) => void = () => {};
  const body: BodyControl = {
    inGame: () => true,
    fighting: () => false,
    danger: () => false,
    busy: () => false,
    canSee: (p) => p !== "Ghost",
    vitals: () => ({ health: 20, food: 18 }),
    comeTo: (p) => {
      calls.push(`come_to:${p}`);
      return new Promise((res, rej) => ((finishWalk = res), (failWalk = rej)));
    },
    follow: (p) => void calls.push(`follow:${p}`),
    guard: (p) => {
      calls.push(`guard:${p}`);
      return new Promise((res, rej) => ((finishWalk = res), (failWalk = rej)));
    },
    give: (p, item, n) => {
      calls.push(`give:${p}:${item}:${n ?? "all"}`);
      return new Promise((res, rej) => ((finishWalk = res), (failWalk = rej)));
    },
    runTask: () => new Promise((res, rej) => ((finishWalk = res), (failWalk = rej))),
    say: (t) => void calls.push(`say:${t}`),
    stop: () => void calls.push("stop"),
    interrupt: () => void calls.push("interrupt"),
    ...over,
  };
  return { body, calls, finish: () => finishWalk(), fail: (e: Error) => failWalk(e) };
}

test("parseFrame is strict", () => {
  const ok = (o: object) => parseFrame(JSON.stringify(o)).ok;
  assert.ok(ok({ type: "intent", id: "1", intent: "come_to", player: "Sam" }));
  assert.ok(ok({ type: "intent", id: "1", intent: "task", name: "get_wood" }));
  assert.ok(ok({ type: "intent", id: "1", intent: "task", name: "get_stone" }));
  assert.ok(ok({ type: "intent", id: "1", intent: "guard", player: "Sam" }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "guard" })); // a player is required
  assert.ok(!ok({ type: "intent", id: "1", intent: "guard", player: "Sam", x: 1 }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "come_to", player: "Sam", x: 1 })); // no coordinates
  assert.ok(!ok({ type: "intent", id: "1", intent: "come_to", player: "a b" }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "task", name: "get wood" }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "task", name: "get_stone", count: 3 }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "task", name: "get_diamonds" }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "command", text: "op me" }));
  assert.ok(!ok({ type: "intent", intent: "stop" })); // id required
  assert.ok(!ok({ type: "auth", token: "x", extra: 1 }));
  assert.ok(!parseFrame("not json").ok);
});

test("event log resumes, reports gaps, and has an epoch", () => {
  const log = new EventLog(3);
  for (let i = 0; i < 5; i++) log.emit("e", { i });
  assert.equal(log.head, 5);
  assert.deepEqual(log.since(3).events.map((e) => e.seq), [4, 5]);
  assert.equal(log.since(3).gap, undefined);
  assert.equal(log.since(0).gap, 3);
  assert.notEqual(new EventLog().epoch, new EventLog().epoch);
});

test("dispatcher: one action at a time, rejections, stop always works", () => {
  const log = new EventLog();
  const s = stubBody();
  const d = createDispatcher(s.body, log);

  assert.deepEqual(d.handle({ intent: "come_to", player: "Ghost" }), { kind: "rejected", reason: "unknown_player" });
  const a = d.handle({ intent: "task", name: "get_wood" });
  assert.equal(a.kind, "accepted");
  assert.deepEqual(d.handle({ intent: "task", name: "get_wood" }), { kind: "rejected", reason: "busy" });
  assert.deepEqual(d.handle({ intent: "follow", player: "Sam" }), { kind: "rejected", reason: "busy" });

  const stopped = d.handle({ intent: "stop" });
  assert.equal(stopped.kind === "accepted" && stopped.taskId, a.kind === "accepted" && a.taskId);
  assert.ok(log.since(0).events.some((e) => e.event === "task_stopped"));
  s.fail(new Error("stopped")); // late failure from the cancelled task must not surface
  return Promise.resolve().then(() => {
    assert.ok(!log.since(0).events.some((e) => e.event === "task_failed"));
  });
});

test("dispatcher: replacing a walk, fight and not-in-game guards", async () => {
  const log = new EventLog();
  let fighting = false;
  let inGame = true;
  const s = stubBody({ fighting: () => fighting, inGame: () => inGame });
  const d = createDispatcher(s.body, log);

  d.handle({ intent: "come_to", player: "Sam" });
  d.handle({ intent: "follow", player: "Sam" }); // replaces the walk
  assert.deepEqual(log.since(0).events.map((e) => e.event), ["task_started", "task_stopped", "task_started"]);

  fighting = true;
  assert.deepEqual(d.handle({ intent: "come_to", player: "Sam" }), { kind: "rejected", reason: "in_fight" });
  assert.equal(d.handle({ intent: "status" }).kind, "status");
  assert.equal(d.handle({ intent: "stop" }).kind, "accepted");

  fighting = false;
  inGame = false;
  assert.deepEqual(d.handle({ intent: "task", name: "get_wood" }), { kind: "rejected", reason: "not_in_game" });
});

test("dispatcher: guard is taken in danger, refused in a fight and needs the player in view", () => {
  const log = new EventLog();
  let danger = true;
  let fighting = false;
  const s = stubBody({ danger: () => danger, fighting: () => fighting });
  const d = createDispatcher(s.body, log);

  assert.deepEqual(d.handle({ intent: "follow", player: "Sam" }), { kind: "rejected", reason: "in_danger" });
  assert.deepEqual(d.handle({ intent: "guard", player: "Ghost" }), { kind: "rejected", reason: "unknown_player" });
  fighting = true;
  assert.deepEqual(d.handle({ intent: "guard", player: "Sam" }), { kind: "rejected", reason: "in_fight" });
  fighting = false;
  assert.equal(d.handle({ intent: "guard", player: "Sam" }).kind, "accepted");
  assert.equal(d.snapshot().task, "guard:Sam");
  assert.deepEqual(s.calls, ["guard:Sam"]);
});

test("dispatcher: a reflex does not end a guard, stop, a newer order, losing the ward, death and disconnect do", async () => {
  const kinds = (log: EventLog) => log.since(0).events.map((e) => (e.reason ? `${e.event}:${e.reason}` : e.event));

  let log = new EventLog();
  let s = stubBody();
  let d = createDispatcher(s.body, log);
  d.handle({ intent: "guard", player: "Sam" });
  d.interrupted();
  d.interrupted();
  assert.deepEqual(s.calls, ["guard:Sam", "interrupt", "interrupt"]); // the body still clears its goal for the reflex
  assert.deepEqual(kinds(log), ["task_started"]);
  assert.equal(d.snapshot().task, "guard:Sam");

  d.handle({ intent: "follow", player: "Sam" }); // a newer order replaces it
  assert.deepEqual(kinds(log), ["task_started", "task_stopped", "task_started"]);
  d.interrupted(); // a follow still ends as before
  assert.equal(kinds(log).at(-1), "task_failed:interrupted");

  log = new EventLog();
  s = stubBody();
  d = createDispatcher(s.body, log);
  d.handle({ intent: "guard", player: "Sam" });
  d.handle({ intent: "stop" });
  assert.deepEqual(kinds(log), ["task_started", "task_stopped"]);

  log = new EventLog();
  s = stubBody();
  d = createDispatcher(s.body, log);
  d.handle({ intent: "guard", player: "Sam" });
  s.fail(new Error("lost_ward"));
  await Promise.resolve();
  assert.deepEqual(kinds(log), ["task_started", "task_failed:lost_ward"]);
  assert.equal(d.snapshot().task, null);

  for (const end of [(x: typeof d) => x.bodyDied(), (x: typeof d) => x.bodyDisconnected("kicked")]) {
    log = new EventLog();
    s = stubBody();
    d = createDispatcher(s.body, log);
    d.handle({ intent: "guard", player: "Sam" });
    end(d);
    assert.equal(d.snapshot().task, null);
    assert.equal(kinds(log)[1].startsWith("task_failed"), true);
  }
});

test("dispatcher: finish and disconnect events carry the task id", async () => {
  const log = new EventLog();
  const s = stubBody();
  const d = createDispatcher(s.body, log);
  const a = d.handle({ intent: "come_to", player: "Sam" });
  s.finish();
  await Promise.resolve();
  const fin = log.since(0).events.find((e) => e.event === "task_finished");
  assert.equal(fin?.taskId, a.kind === "accepted" && a.taskId);

  d.handle({ intent: "task", name: "get_wood" });
  d.bodyDisconnected("kicked");
  const evs = log.since(0).events;
  assert.equal(evs.at(-2)?.reason, "disconnected");
  assert.equal(evs.at(-1)?.event, "body_disconnected");
});

// --- over a real socket ---

const TOKEN = "t".repeat(32);

async function withServer(fn: (url: string, log: EventLog, s: ReturnType<typeof stubBody>) => Promise<void>) {
  const log = new EventLog();
  const s = stubBody();
  const wss: WebSocketServer = startApiServer(
    { host: "127.0.0.1", port: 0, tokens: new Map([[TOKEN, "test"]]) },
    createDispatcher(s.body, log),
    log
  );
  await new Promise((r) => wss.once("listening", r));
  const addr = wss.address() as { port: number };
  try {
    await fn(`ws://127.0.0.1:${addr.port}`, log, s);
  } finally {
    for (const c of wss.clients) c.terminate();
    wss.close();
  }
}

function client(url: string) {
  const ws = new WebSocket(url);
  const inbox: any[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (d) => {
    inbox.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (pred: (m: any) => boolean = () => true) => {
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const open = new Promise<void>((r) => ws.once("open", () => r()));
  const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
  return { ws, next, open, closed, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}

test("socket: bad token is closed, good token gets hello and can act", async () => {
  await withServer(async (url, log) => {
    const bad = client(url);
    await bad.open;
    bad.send({ type: "auth", token: "nope" });
    assert.equal(await bad.closed, 1008);

    const c = client(url);
    await c.open;
    c.send({ type: "auth", token: TOKEN });
    const hello = await c.next((m) => m.type === "hello");
    assert.equal(hello.epoch, log.epoch);
    assert.equal(hello.snapshot.inGame, true);

    c.send({ type: "intent", id: "a", intent: "come_to", player: "Sam" });
    assert.equal((await c.next((m) => m.type === "accepted")).taskId, "t1");
    assert.equal((await c.next((m) => m.type === "event")).event, "task_started");

    c.send({ type: "intent", id: "b", intent: "come_to", player: "Sam", x: 5 });
    assert.deepEqual(await c.next((m) => m.type === "rejected"), { type: "rejected", id: "b", reason: "bad_intent" });
    c.ws.close();
  });
});

test("socket: unauthenticated intent is refused, resume replays, rate limit spares stop", async () => {
  await withServer(async (url, log) => {
    const pre = client(url);
    await pre.open;
    pre.send({ type: "intent", id: "x", intent: "stop" });
    assert.equal(await pre.closed, 1008);

    log.emit("chat", { uuid: "u", name: "Sam", message: "hi" }); // seq 1
    log.emit("chat", { uuid: "u", name: "Sam", message: "again" }); // seq 2
    const c = client(url);
    await c.open;
    c.send({ type: "auth", token: TOKEN, since: 1, epoch: log.epoch });
    await c.next((m) => m.type === "hello");
    const e = await c.next((m) => m.type === "event");
    assert.equal(e.seq, 2);

    const wrongEpoch = client(url);
    await wrongEpoch.open;
    wrongEpoch.send({ type: "auth", token: TOKEN, since: 1, epoch: "stale" });
    assert.equal((await wrongEpoch.next((m) => m.type === "gap")).oldest, 1);

    for (let i = 0; i < 10; i++) c.send({ type: "intent", id: `s${i}`, intent: "status" });
    c.send({ type: "intent", id: "over", intent: "status" });
    assert.equal((await c.next((m) => m.id === "over")).reason, "rate_limited");
    c.send({ type: "intent", id: "halt", intent: "stop" });
    assert.equal((await c.next((m) => m.id === "halt")).type, "accepted");
    c.ws.close();
    wrongEpoch.ws.close();
  });
});

test("a reflex taking the body ends the action as interrupted, and new orders wait", () => {
  const log = new EventLog();
  let danger = false;
  const s = stubBody({ danger: () => danger });
  const d = createDispatcher(s.body, log);

  d.handle({ intent: "task", name: "get_wood" });
  d.interrupted();
  const events = log.since(0).events;
  assert.deepEqual(events.map((e) => e.event), ["task_started", "task_failed"]);
  assert.equal((events[1] as { reason?: string }).reason, "interrupted");
  assert.ok(s.calls.includes("interrupt"));
  assert.ok(!s.calls.includes("stop"), "an interrupt is not the API's stop");

  danger = true;
  assert.deepEqual(d.handle({ intent: "come_to", player: "Sam" }), { kind: "rejected", reason: "in_danger" });
  assert.equal(d.handle({ intent: "stop" }).kind, "accepted");
});

test("say: plain text only, own rate limit, never touches the running action", () => {
  const ok = (text: unknown) => parseFrame(JSON.stringify({ type: "intent", id: "1", intent: "say", text })).ok;
  assert.ok(ok("hi there, I can't do that yet"));
  assert.ok(!ok("/op Sam"));
  assert.ok(!ok("  /op Sam")); // leading space doesn't hide a command
  assert.ok(!ok("two\nlines"));
  assert.ok(!ok("zero\u200bwidth")); // format characters
  assert.ok(!ok("caf\u00e9")); // printable ASCII only
  assert.ok(!ok("\u0430pple")); // a Cyrillic a
  assert.ok(!ok("colour \u00a7c codes")); // the server disconnects a client that sends a section sign
  assert.ok(!ok(""));
  assert.ok(!ok("   "));
  assert.ok(!ok("x".repeat(101)));
  assert.ok(ok("x".repeat(100)));
  assert.ok(!ok(42));
  assert.ok(!parseFrame(JSON.stringify({ type: "intent", id: "1", intent: "say", text: "hi", extra: 1 })).ok);

  let t = 1000;
  let fighting = false;
  const s = stubBody({ fighting: () => fighting });
  const d = createDispatcher(s.body, new EventLog(), () => t);
  d.handle({ intent: "follow", player: "Sam" });
  fighting = true;
  assert.deepEqual(d.handle({ intent: "say", text: "behind you!" }), { kind: "accepted" });
  assert.deepEqual(d.handle({ intent: "say", text: "again" }), { kind: "rejected", reason: "rate_limited" });
  t += 2000;
  assert.deepEqual(d.handle({ intent: "say", text: "now" }), { kind: "accepted" });
  assert.deepEqual(s.calls, ["follow:Sam", "say:behind you!", "say:now"]);
  assert.equal(d.snapshot().task, "follow:Sam"); // still following

  const out = createDispatcher(stubBody({ inGame: () => false }).body, new EventLog());
  assert.deepEqual(out.handle({ intent: "say", text: "hi" }), { kind: "rejected", reason: "not_in_game" });
});

test("give: item and count are strict, the player must be in view, and it fails with its own reason", async () => {
  const ok = (o: object) => parseFrame(JSON.stringify({ type: "intent", id: "1", intent: "give", player: "Sam", item: "oak_log", ...o })).ok;
  assert.ok(ok({}));
  assert.ok(ok({ count: 1 }));
  assert.ok(ok({ count: 64 }));
  assert.ok(!ok({ count: 0 }));
  assert.ok(!ok({ count: 65 }));
  assert.ok(!ok({ count: 1.5 }));
  assert.ok(!ok({ count: "5" }));
  assert.ok(!ok({ item: "minecraft:oak_log" }));
  assert.ok(!ok({ item: "Oak_Log" }));
  assert.ok(!ok({ item: "" }));
  assert.ok(!ok({ item: "a".repeat(49) }));
  assert.ok(!ok({ item: 5 }));
  assert.ok(!ok({ player: "a b" }));
  assert.ok(!ok({ x: 1 }));
  assert.ok(!parseFrame(JSON.stringify({ type: "intent", id: "1", intent: "give", item: "oak_log" })).ok); // a player is required
  assert.ok(!parseFrame(JSON.stringify({ type: "intent", id: "1", intent: "give", player: "Sam" })).ok); // so is an item

  const log = new EventLog();
  let danger = false;
  let fighting = false;
  let busy = false;
  const s = stubBody({ danger: () => danger, fighting: () => fighting, busy: () => busy });
  const d = createDispatcher(s.body, log);

  assert.deepEqual(d.handle({ intent: "give", player: "Ghost", item: "oak_log" }), { kind: "rejected", reason: "unknown_player" });
  danger = true;
  assert.deepEqual(d.handle({ intent: "give", player: "Sam", item: "oak_log" }), { kind: "rejected", reason: "in_danger" });
  danger = false;
  fighting = true;
  assert.deepEqual(d.handle({ intent: "give", player: "Sam", item: "oak_log" }), { kind: "rejected", reason: "in_fight" });
  fighting = false;
  busy = true;
  assert.deepEqual(d.handle({ intent: "give", player: "Sam", item: "oak_log" }), { kind: "rejected", reason: "busy" });
  busy = false;
  assert.deepEqual(s.calls, []);

  const a = d.handle({ intent: "give", player: "Sam", item: "oak_log", count: 12 });
  assert.equal(a.kind, "accepted");
  assert.equal(d.snapshot().task, "give:Sam");
  assert.deepEqual(s.calls, ["give:Sam:oak_log:12"]);
  s.fail(new Error("none_held"));
  await Promise.resolve();
  const failed = log.since(0).events.find((e) => e.event === "task_failed");
  assert.equal((failed as { reason?: string }).reason, "none_held");
  assert.equal(d.snapshot().task, null);

  // finishing ends it cleanly; the count is optional
  d.handle({ intent: "give", player: "Sam", item: "oak_log" });
  assert.equal(s.calls[1], "give:Sam:oak_log:all");
  s.finish();
  await Promise.resolve();
  assert.ok(log.since(0).events.some((e) => e.event === "task_finished"));

  // a task blocks it, like come_to
  const t = createDispatcher(stubBody().body, new EventLog());
  t.handle({ intent: "task", name: "get_wood" });
  assert.deepEqual(t.handle({ intent: "give", player: "Sam", item: "oak_log" }), { kind: "rejected", reason: "busy" });
});

test("get_stone: runs as a task, one at a time, and fails with the body's own reason", async () => {
  const kinds = (log: EventLog) => log.since(0).events.map((e) => (e.reason ? `${e.event}:${e.reason}` : e.event));
  const ran: string[] = [];
  const log = new EventLog();
  const s = stubBody({
    runTask: (name) => {
      ran.push(name);
      return new Promise<void>((res, rej) => setTimeout(() => (name === "get_stone" ? rej(new Error("no_stone")) : res()), 0));
    },
  });
  const d = createDispatcher(s.body, log);

  assert.equal(d.handle({ intent: "task", name: "get_stone" }).kind, "accepted");
  assert.equal(d.snapshot().task, "task:get_stone");
  assert.deepEqual(d.handle({ intent: "task", name: "get_stone" }), { kind: "rejected", reason: "busy" });
  assert.deepEqual(d.handle({ intent: "task", name: "get_wood" }), { kind: "rejected", reason: "busy" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(kinds(log), ["task_started", "task_failed:no_stone"]);
  assert.deepEqual(ran, ["get_stone"]);

  // stop mid-run: task_stopped, and the late failure from the cancelled run is dropped
  const log2 = new EventLog();
  const s2 = stubBody();
  const d2 = createDispatcher(s2.body, log2);
  d2.handle({ intent: "task", name: "get_stone" });
  d2.handle({ intent: "stop" });
  s2.fail(new Error("stopped"));
  await Promise.resolve();
  assert.deepEqual(kinds(log2), ["task_started", "task_stopped"]);
});
