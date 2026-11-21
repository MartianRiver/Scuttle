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
    busy: () => false,
    canSee: (p) => p !== "Ghost",
    vitals: () => ({ health: 20, food: 18 }),
    comeTo: (p) => {
      calls.push(`come_to:${p}`);
      return new Promise((res, rej) => ((finishWalk = res), (failWalk = rej)));
    },
    follow: (p) => void calls.push(`follow:${p}`),
    runTask: () => new Promise((res, rej) => ((finishWalk = res), (failWalk = rej))),
    stop: () => void calls.push("stop"),
    ...over,
  };
  return { body, calls, finish: () => finishWalk(), fail: (e: Error) => failWalk(e) };
}

test("parseFrame is strict", () => {
  const ok = (o: object) => parseFrame(JSON.stringify(o)).ok;
  assert.ok(ok({ type: "intent", id: "1", intent: "come_to", player: "Sam" }));
  assert.ok(ok({ type: "intent", id: "1", intent: "task", name: "get_wood" }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "come_to", player: "Sam", x: 1 })); // no coordinates
  assert.ok(!ok({ type: "intent", id: "1", intent: "come_to", player: "a b" }));
  assert.ok(!ok({ type: "intent", id: "1", intent: "task", name: "get wood" }));
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
