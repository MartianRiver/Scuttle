import assert from "node:assert/strict";
import { test } from "node:test";
import { BodyClient } from "../src/mcp/client";
import { loadApiEnv } from "../src/mcp/env";
import { FakeBody, TOKEN, connected, sleep, until } from "./mcp-fake";

test("auth: hello gives the snapshot, the first auth frame has no resume fields", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake);
  try {
    assert.equal(fake.auths.length, 1);
    assert.deepEqual(Object.keys(fake.auths[0]).sort(), ["token", "type"]);
    assert.equal(c.epoch, "e1");
    assert.equal((await c.status()).snapshot?.food, 18);
  } finally {
    c.close();
    await fake.close();
  }
});

test("a refused token stops the client instead of retrying", async () => {
  const fake = await FakeBody.start();
  const c = new BodyClient({ url: fake.url, token: "w".repeat(32), backoffMs: [5] });
  c.start();
  try {
    await until(() => c.state === "auth_failed");
    await sleep(100);
    assert.equal(fake.auths.length, 1);
    assert.equal(await c.ready(50), false);
    assert.ok(c.drainNotices()[0].startsWith("auth_failed"));
    assert.deepEqual(await c.send({ intent: "status" }), { kind: "offline" });
  } finally {
    c.close();
    await fake.close();
  }
});

test("reconnect resumes with since and epoch, and replays what was missed", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake);
  try {
    fake.emit("task_started", { taskId: "t1", kind: "get_wood" });
    fake.emit("chat", { name: "Sam", message: "hi" });
    await until(() => c.head === 2);
    fake.dropClients();
    fake.emit("task_finished", { taskId: "t1" }); // while the client is away
    await until(() => c.head === 3);
    assert.equal(fake.auths.length, 2);
    assert.equal(fake.auths[1].since, 2);
    assert.equal(fake.auths[1].epoch, "e1");
    assert.deepEqual(c.eventsAfter(0).map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(c.drainNotices(), []); // a clean resume is not worth a notice
  } finally {
    c.close();
    await fake.close();
  }
});

test("a restarted body (new epoch) resets the buffer and says so", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake);
  try {
    fake.emit("chat", { name: "Sam", message: "hi" });
    await until(() => c.head === 1);
    let restarts = 0;
    c.onRestart(() => restarts++);
    fake.dropClients();
    fake.epoch = "e2";
    fake.seq = 0;
    fake.events = [];
    await until(() => restarts === 1);
    assert.equal(c.epoch, "e2");
    assert.deepEqual(c.eventsAfter(0), []);
    assert.deepEqual(c.drainNotices().map((n) => n.split(":")[0]), ["bot_restarted"]); // and no second notice for the gap frame
  } finally {
    c.close();
    await fake.close();
  }
});

test("the event buffer drops the oldest past its cap", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake, { cap: 3 });
  try {
    for (let i = 0; i < 5; i++) fake.emit("chat", { name: "Sam", message: `m${i}` });
    await until(() => c.head === 5);
    assert.deepEqual(c.eventsAfter(0).map((e) => e.seq), [3, 4, 5]);
    assert.equal(c.dropped, 2);
    assert.equal(c.oldest, 3);
  } finally {
    c.close();
    await fake.close();
  }
});

test("a dropped connection while a request is out ends it as no_reply", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake, { backoffMs: [5000] });
  try {
    fake.reply = () => null; // never answers
    const p = c.send({ intent: "come_to", player: "Sam" });
    await until(() => fake.intents.length === 1);
    fake.dropClients();
    assert.deepEqual(await p, { kind: "no_reply" });
    assert.equal(c.state, "reconnecting");
  } finally {
    c.close();
    await fake.close();
  }
});

test("status is cached so a polling mind does not spend the body's rate limit", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake, { snapshotMaxAgeMs: 500 });
  try {
    for (let i = 0; i < 5; i++) await c.status();
    assert.equal(fake.intents.length, 0); // hello's snapshot was fresh
    await sleep(550);
    await c.status();
    await c.status();
    assert.equal(fake.intents.length, 1);
  } finally {
    c.close();
    await fake.close();
  }
});

test("nothing that fails the protocol parser is sent", async () => {
  const fake = await FakeBody.start();
  const c = await connected(fake);
  try {
    assert.deepEqual(await c.send({ intent: "come_to", player: "Sam", x: 1 }), { kind: "invalid" });
    assert.deepEqual(await c.send({ intent: "command", text: "op me" }), { kind: "invalid" });
    assert.deepEqual(await c.send({ intent: "say", text: "/op me" }), { kind: "invalid" });
    assert.equal(fake.intents.length, 0);
  } finally {
    c.close();
    await fake.close();
  }
});

test("env: file values, real env wins, first token, and what is missing", () => {
  const file = `API_HOST=10.0.0.5\nAPI_PORT=8787\nAPI_TOKENS=local:${TOKEN},other:${"z".repeat(30)}\nMC_HOST=ignored\n`;
  const read = () => file;
  assert.deepEqual(loadApiEnv({ BOT_ENV: "x.env" }, read), { ok: true, url: "ws://10.0.0.5:8787", token: TOKEN });
  assert.deepEqual(loadApiEnv({ BOT_ENV: "x.env", API_PORT: "9000" }, read), { ok: true, url: "ws://10.0.0.5:9000", token: TOKEN });
  assert.deepEqual(loadApiEnv({ API_PORT: "1", API_TOKENS: `a:${TOKEN}` }), { ok: true, url: "ws://127.0.0.1:1", token: TOKEN });
  assert.equal(loadApiEnv({}).ok, false);
  assert.equal(loadApiEnv({ API_PORT: "1", API_TOKENS: "nocolon" }).ok, false);
  assert.equal(loadApiEnv({ BOT_ENV: "missing.env" }, () => { throw new Error("ENOENT"); }).ok, false);
});
