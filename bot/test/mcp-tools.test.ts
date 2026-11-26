import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TASKS } from "../src/api/protocol";
import { Audit } from "../src/mcp/audit";
import type { BodyClient } from "../src/mcp/client";
import { buildServer } from "../src/mcp/server";
import { ACTIONS, REJECTS, TASK_SKILLS, skillsTable } from "../src/mcp/skills";
import { line } from "../src/mcp/format";
import { TOOLS, withoutStaleProgress } from "../src/mcp/tools";
import { wakeReason } from "../src/mcp/wait";
import { FakeBody, connected, sleep, until } from "./mcp-fake";

const call = async (client: BodyClient, name: string, args: object = {}) => (await TOOLS.find((t) => t.name === name)!.run({ client }, args)).out as any;

async function withBody(fn: (fake: FakeBody, client: BodyClient) => Promise<void>) {
  const fake = await FakeBody.start();
  const client = await connected(fake);
  try {
    await fn(fake, client);
  } finally {
    client.close();
    await fake.close();
  }
}

test("act: accepted with a taskId, rejections come back as data, the rationale never goes on the wire", async () => {
  await withBody(async (fake, client) => {
    const ok = await call(client, "act", { action: "come_to", player: "Sam", rationale: "he asked for me" });
    assert.deepEqual(ok, { accepted: true, action: "come_to", taskId: "t1" });
    assert.deepEqual(Object.keys(fake.intents[0]).sort(), ["id", "intent", "player", "type"]);

    fake.reply = (m) => ({ type: "rejected", id: m.id, reason: "busy" });
    const busy = await call(client, "act", { action: "task", task: "get_wood", rationale: "need logs" });
    assert.equal(busy.accepted, false);
    assert.equal(busy.reason, "busy");
    assert.ok(busy.hint.length > 0);
    assert.deepEqual(Object.keys(fake.intents[1]).sort(), ["id", "intent", "name", "type"]); // task -> name

    await call(client, "act", { action: "give", player: "Sam", item: "oak_log", count: 5, rationale: "r" });
    await call(client, "act", { action: "stop", rationale: "r" });
    await call(client, "say", { text: "hello" });
    assert.ok(!JSON.stringify(fake.frames).includes("rationale"));
    assert.deepEqual(fake.intents.slice(2).map((f) => f.intent), ["give", "stop", "say"]);
  });
});

test("act: bad arguments are refused locally and nothing is sent", async () => {
  await withBody(async (fake, client) => {
    const cases: object[] = [
      { action: "come_to" },
      { action: "come_to", player: "Sam", count: 3 },
      { action: "give", player: "Sam" },
      { action: "task", task: "get_diamonds" },
      { action: "task" },
      { action: "stop", player: "Sam" },
      { action: "come_to", player: "not a name" }, // caught by the protocol's own parser
    ];
    for (const c of cases) {
      const r = await call(client, "act", { ...c, rationale: "r" });
      assert.equal(r.accepted, false, JSON.stringify(c));
      assert.ok(["bad_args", "bad_intent"].includes(r.reason));
    }
    assert.equal(fake.intents.length, 0);
  });
});

test("observe and go_to: the observation passes through, go_to sends only the handle", async () => {
  await withBody(async (fake, client) => {
    const seen = { health: 20, food: 18, near: [{ h: "e4kq", what: "cow", d: "close", dir: "east" }], blocks: [], places: { home: "here" } };
    const base = fake.reply;
    fake.reply = (m) => (m.intent === "observe" ? { type: "observation", id: m.id, observation: seen } : base(m));
    assert.deepEqual(await call(client, "observe"), seen);

    const ok = await call(client, "act", { action: "go_to", handle: "e4kq", rationale: "milk" });
    assert.equal(ok.accepted, true);
    assert.deepEqual(fake.intents[1], { type: "intent", id: fake.intents[1].id, intent: "go_to", handle: "e4kq" });
    await call(client, "act", { action: "go_to", handle: "home", rationale: "r" });

    for (const c of [{ handle: "e4" }, { handle: "x9kq" }, {}, { handle: "e4kq", player: "Sam" }]) {
      const r = await call(client, "act", { action: "go_to", ...c, rationale: "r" });
      assert.equal(r.accepted, false, JSON.stringify(c));
    }
    assert.equal(fake.intents.length, 3);

    fake.reply = (m) => ({ type: "rejected", id: m.id, reason: m.intent === "observe" ? "not_in_game" : "stale_handle" });
    assert.equal((await call(client, "observe")).reason, "not_in_game");
    const stale = await call(client, "act", { action: "go_to", handle: "b17kq", rationale: "r" });
    assert.equal(stale.reason, "stale_handle");
    assert.ok(stale.hint.includes("observe"));
  });
});

test("act and say when the body API is down: api_offline as data", async () => {
  const fake = await FakeBody.start();
  const client = await connected(fake, { backoffMs: [5000] });
  try {
    await fake.close();
    await sleep(50);
    const r = await call(client, "act", { action: "stop", rationale: "r" });
    assert.equal(r.reason, "api_offline");
    assert.equal((await call(client, "say", { text: "hi" })).reason, "api_offline");
    assert.equal((await call(client, "status")).api, "reconnecting");
  } finally {
    client.close();
  }
});

test("wait: returns when the task fails, with the reason", async () => {
  await withBody(async (fake, client) => {
    const { taskId } = await call(client, "act", { action: "task", task: "get_stone", rationale: "r" });
    setTimeout(() => fake.emit("task_failed", { taskId, reason: "no_pickaxe" }), 30);
    const w = await call(client, "wait", { taskId, timeout_s: 5 });
    assert.equal(w.reason, "task_ended");
    assert.match(w.ended, /task_failed taskId=t1 reason=no_pickaxe/);
  });
});

test("wait: an ending that happened before the call is returned at once, and again after it was read", async () => {
  await withBody(async (fake, client) => {
    fake.emit("task_started", { taskId: "t1", kind: "come_to:Sam" });
    fake.emit("task_finished", { taskId: "t1" });
    await until(() => client.head === 2);
    const t0 = Date.now();
    const w = await call(client, "wait", { taskId: "t1", timeout_s: 5 });
    assert.equal(w.reason, "task_ended");
    assert.ok(Date.now() - t0 < 500);
    assert.equal((await call(client, "events")).events.length, 0); // wait already marked them read
    assert.equal((await call(client, "wait", { taskId: "t1", timeout_s: 5 })).reason, "task_ended");
  });
});

test("wait: times out with the current status", async () => {
  await withBody(async (fake, client) => {
    fake.snapshot = { ...fake.snapshot, task: "follow:Sam", taskId: "t4" };
    const w = await call(client, "wait", { taskId: "t4", timeout_s: 1 });
    assert.equal(w.reason, "timeout");
    assert.equal(w.status.task, "follow:Sam");
    assert.equal(w.api, "connected");
  });
});

test("wait: wakes early on a chat line from another player, the task still running", async () => {
  await withBody(async (fake, client) => {
    const { taskId } = await call(client, "act", { action: "follow", player: "Sam", rationale: "r" });
    setTimeout(() => fake.emit("chat", { uuid: "u", name: "Sam", message: "Scuttle, come here" }), 30);
    const t0 = Date.now();
    const w = await call(client, "wait", { taskId, timeout_s: 30 });
    assert.equal(w.reason, "chat");
    assert.equal(w.ended, undefined);
    assert.ok(Date.now() - t0 < 2000);
    assert.deepEqual(w.events, ['#1 chat Sam said: "Scuttle, come here"']);
  });
});

test("wait with no taskId: idle, ignores a task ending, wakes on chat, died, no_food, interrupted, disconnect", async () => {
  await withBody(async (fake, client) => {
    setTimeout(() => {
      fake.emit("task_finished", { taskId: "t9" }); // not a wake-up when idle
      setTimeout(() => fake.emit("chat", { name: "Alex", message: "hey" }), 40);
    }, 20);
    const w = await call(client, "wait", { timeout_s: 5 });
    assert.equal(w.reason, "chat");
    assert.equal(w.events.length, 2); // the finished task comes along, as an ordinary event

    for (const [event, fields, reason] of [
      ["died", { place: "somewhere", cause: "mob" }, "died"],
      ["no_food", { food: 3 }, "no_food"],
      ["task_failed", { taskId: "t2", reason: "interrupted" }, "interrupted"],
      ["body_disconnected", { reason: "kicked" }, "disconnected"],
    ] as const) {
      setTimeout(() => fake.emit(event, fields), 20);
      assert.equal((await call(client, "wait", { timeout_s: 5 })).reason, reason);
    }
  });
});

test("wait: unread chat that arrived between calls wakes the next wait at once, then not again", async () => {
  await withBody(async (fake, client) => {
    fake.emit("chat", { name: "Sam", message: "yo" });
    await until(() => client.head === 1);
    const t0 = Date.now();
    assert.equal((await call(client, "wait", { timeout_s: 5 })).reason, "chat");
    assert.ok(Date.now() - t0 < 500);
    assert.equal((await call(client, "wait", { timeout_s: 1 })).reason, "timeout");
  });
});

test("wakeReason", () => {
  const ev = (event: string, f: object = {}) => ({ seq: 1, ts: 0, event, ...f });
  assert.equal(wakeReason(ev("task_finished", { taskId: "t1" })), undefined);
  assert.equal(wakeReason(ev("task_finished", { taskId: "t1" }), "t1"), "task_ended");
  assert.equal(wakeReason(ev("task_stopped", { taskId: "t1" }), "t2"), undefined);
  assert.equal(wakeReason(ev("task_failed", { taskId: "t1", reason: "stuck" }), "t1"), "task_ended");
  // the task_failed before a death or disconnect ends the task but is not a second wake-up: the died event is
  assert.equal(wakeReason(ev("task_failed", { taskId: "t1", reason: "died" }), "t1"), "task_ended");
  assert.equal(wakeReason(ev("task_failed", { taskId: "t1", reason: "died" })), undefined);
  assert.equal(wakeReason(ev("task_failed", { taskId: "t1", reason: "disconnected" })), undefined);
  assert.equal(wakeReason(ev("task_failed", { taskId: "t1", reason: "interrupted" })), "interrupted");
  assert.equal(wakeReason(ev("task_started", { taskId: "t1" }), "t1"), undefined);
});

test("events: since the last read, capped with a pointer to the rest, and loss is reported", async () => {
  const fake = await FakeBody.start();
  const client = await connected(fake, { cap: 4 });
  try {
    for (let i = 0; i < 3; i++) fake.emit("task_started", { taskId: `t${i}`, kind: "x" });
    await until(() => client.head === 3);
    let r = await call(client, "events", { limit: 2 });
    assert.equal(r.events.length, 2);
    assert.match(r.more, /1 further/);
    r = await call(client, "events");
    assert.deepEqual(r.events, ["#3 task_started taskId=t2 kind=x"]);
    assert.deepEqual((await call(client, "events")).events, []);
    for (let i = 0; i < 4; i++) fake.emit("no_food", { food: i });
    await until(() => client.head === 7);
    r = await call(client, "events", { since: 0 });
    assert.equal(r.events.length, 4);
    assert.ok(r.notices.some((n: string) => n.startsWith("events #1 to #3")));
    assert.equal(r.head, 7);
  } finally {
    client.close();
    await fake.close();
  }
});

test("status: body state and event counters", async () => {
  await withBody(async (fake, client) => {
    fake.emit("chat", { name: "Sam", message: "x" });
    await until(() => client.head === 1);
    const s = await call(client, "status");
    assert.equal(s.api, "connected");
    assert.deepEqual(s.body, { in_game: true, task: null, taskId: null, health: 20, food: 18 });
    assert.equal(s.last_event, 1);
    assert.equal(s.unread_events, 1);
  });
});

test("skills: every task in TASKS has an entry and failure reasons, every action a line", () => {
  assert.deepEqual(Object.keys(TASK_SKILLS).sort(), [...TASKS].sort());
  for (const [name, t] of Object.entries(TASK_SKILLS)) {
    assert.ok(t.does.length > 20 && t.needs.length > 0, name);
    assert.ok(Object.keys(t.fails).length > 0 && Object.values(t.fails).every((s) => s.length > 0), name);
  }
  assert.deepEqual(Object.keys(ACTIONS).sort(), ["clear_trees", "climb_up", "collect", "come_to", "craft", "dig_down", "dig_shaft", "ensure", "equip", "explore", "follow", "give", "go_to", "guard", "make_base", "make_mine", "pick_up", "place", "shear", "stop", "store", "take", "task", "tunnel", "undo"]);
  for (const [name, a] of Object.entries(ACTIONS)) {
    assert.ok(a.does.length > 0 && a.ends.length > 0, name);
    for (const r of a.rejects) assert.ok(REJECTS[r], `${name}: no hint for ${r}`);
  }
  const act = TOOLS.find((t) => t.name === "act")!;
  assert.ok(Object.keys(skillsTable().actions).every((n) => (act.shape.action as any).options.includes(n)));
});

test("through MCP: tools list, an audit line per call with the rationale and no chat text", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mind-audit-"));
  const fake = await FakeBody.start();
  const body = await connected(fake);
  const server = buildServer(body, new Audit(dir));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" });
  try {
    await Promise.all([server.connect(a), mcp.connect(b)]);
    assert.deepEqual((await mcp.listTools()).tools.map((t) => t.name).sort(), ["act", "events", "observe", "recipe", "say", "skills", "stash", "status", "wait"]);

    const act: any = await mcp.callTool({ name: "act", arguments: { action: "follow", player: "Sam", rationale: "keep him company" } });
    assert.equal(JSON.parse(act.content[0].text).accepted, true);
    const missing: any = await mcp.callTool({ name: "act", arguments: { action: "stop" } }); // rationale is required
    assert.equal(missing.isError, true);

    setTimeout(() => fake.emit("chat", { name: "SecretKid", message: "my password is hunter2" }), 30);
    const w: any = await mcp.callTool({ name: "wait", arguments: { timeout_s: 5 } });
    assert.match(w.content[0].text, /hunter2/); // the mind does get to read it

    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const raw = readFileSync(path.join(dir, files[0]), "utf8");
    assert.ok(raw.includes("keep him company"));
    assert.ok(!raw.includes("hunter2") && !raw.includes("SecretKid"));
    const recs = raw.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(recs.map((r) => r.tool), ["act", "wait"]);
    assert.deepEqual(recs[1].outcome.events, { chat: 1 });
  } finally {
    body.close();
    await mcp.close();
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an argument a tool does not have is refused in words, not dropped: wait seconds names timeout_s", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mind-audit-"));
  const fake = await FakeBody.start();
  const body = await connected(fake);
  const server = buildServer(body, new Audit(dir));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" });
  try {
    await Promise.all([server.connect(a), mcp.connect(b)]);
    const r: any = await mcp.callTool({ name: "wait", arguments: { seconds: 90 } });
    const out = JSON.parse(r.content[0].text);
    assert.equal(out.accepted, false);
    assert.equal(out.reason, "bad_args");
    assert.match(out.hint, /timeout_s/);
    assert.match(out.hint, /not seconds/);
    const ok: any = await mcp.callTool({ name: "wait", arguments: { timeout_s: 1 } });
    assert.equal(JSON.parse(ok.content[0].text).reason, "timeout");
    const act: any = await mcp.callTool({ name: "act", arguments: { action: "stop", rationale: "r", flavour: "x" } });
    assert.equal(JSON.parse(act.content[0].text).reason, "bad_args");
  } finally {
    body.close();
    await mcp.close();
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("not configured: tools that need the body say so, skills still works", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mind-audit-"));
  const server = buildServer(null, new Audit(dir), "API_PORT is not set");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" });
  try {
    await Promise.all([server.connect(a), mcp.connect(b)]);
    const s: any = await mcp.callTool({ name: "status", arguments: {} });
    assert.equal(s.isError, true);
    assert.match(s.content[0].text, /not_configured/);
    const k: any = await mcp.callTool({ name: "skills", arguments: {} });
    assert.ok(!k.isError && JSON.parse(k.content[0].text).tasks.get_wood);
  } finally {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("act task near: a block or place handle goes on the wire as near, nothing else may carry it", async () => {
  await withBody(async (fake, client) => {
    const ok = await call(client, "act", { action: "task", task: "get_wood", near: "b17kq", rationale: "trees by the lake" });
    assert.equal(ok.accepted, true);
    assert.deepEqual(fake.intents[0], { type: "intent", id: fake.intents[0].id, intent: "task", name: "get_wood", near: "b17kq" });
    await call(client, "act", { action: "task", task: "get_stone", near: "table", rationale: "r" });
    assert.equal(fake.intents[1].near, "table");
    await call(client, "act", { action: "task", task: "get_wood", rationale: "r" });
    assert.ok(!("near" in fake.intents[2]), "no near unless given");
    for (const c of [
      { action: "go_to", handle: "home", near: "home" },
      { action: "come_to", player: "Sam", near: "home" },
      { action: "task", task: "get_wood", near: "e4kq" }, // a mob moves: not valid
      { action: "task", task: "get_wood", near: "12 64 -30" },
    ]) {
      const r = await call(client, "act", { ...c, rationale: "r" });
      assert.equal(r.accepted, false, JSON.stringify(c));
    }
    assert.equal(fake.intents.length, 3);
    // the body can still say the handle went stale
    fake.reply = (m) => ({ type: "rejected", id: m.id, reason: "stale_handle" });
    assert.equal((await call(client, "act", { action: "task", task: "get_wood", near: "b9kq", rationale: "r" })).reason, "stale_handle");
  });
  const t = skillsTable();
  assert.ok(t.actions.task.args.includes("near?"));
  assert.ok("stale_handle" in t.actions.task.refused_with);
  assert.match(t.actions.task.does, /near/);
});

test("event lines show got and detail, and a task_progress step", () => {
  const ev = (event: string, f: object) => ({ seq: 9, ts: 0, event, ...f });
  assert.equal(
    line(ev("task_failed", { taskId: "t3", reason: "protected", detail: "three digs undone near the trees, a fair way south-west", got: { oak_log: 4 } })),
    '#9 task_failed taskId=t3 reason=protected detail="three digs undone near the trees, a fair way south-west" got=oak_log:4'
  );
  assert.equal(line(ev("task_finished", { taskId: "t3", got: { cobblestone: 16, oak_planks: 6 } })), "#9 task_finished taskId=t3 got=cobblestone:16,oak_planks:6");
  assert.equal(line(ev("task_progress", { taskId: "t3", step: "mining stone", got: { cobblestone: 7 } })), '#9 task_progress taskId=t3 step="mining stone" got=cobblestone:7');
});

test("task_progress never wakes wait, wait's timeout carries the last one, and a read keeps only the newest per task", async () => {
  await withBody(async (fake, client) => {
    const { taskId } = await call(client, "act", { action: "task", task: "get_wood", rationale: "r" });
    assert.equal(wakeReason({ seq: 1, ts: 0, event: "task_progress", taskId, step: "gathering wood" }, taskId), undefined);
    fake.snapshot = { ...fake.snapshot, task: "task:get_wood", taskId };
    setTimeout(() => {
      fake.emit("task_progress", { taskId, step: "gathering wood" });
      fake.emit("task_progress", { taskId, step: "gathering wood", got: { oak_log: 4 } });
      fake.emit("task_progress", { taskId, step: "crafting tools", got: { oak_log: 8 } });
    }, 20);
    const w = await call(client, "wait", { taskId, timeout_s: 1 });
    assert.equal(w.reason, "timeout", "progress lines do not wake it");
    assert.equal(w.progress, `#3 task_progress taskId=${taskId} step="crafting tools" got=oak_log:8`);
    assert.deepEqual(w.events, [w.progress], "one line for the task, the older ones are read");
    assert.equal((await call(client, "events")).events.length, 0);
    // another task's last line is not this one's
    fake.emit("task_progress", { taskId: "t99", step: "other" });
    await until(() => client.head === 4);
    assert.equal((await call(client, "wait", { taskId, timeout_s: 1 })).progress, w.progress);
  });
});

test("withoutStaleProgress: a long task cannot crowd the events that matter out of a capped read", () => {
  const e = (seq: number, event: string, taskId = "t1") => ({ seq, ts: 0, event, taskId });
  const kept = withoutStaleProgress([e(1, "task_progress"), e(2, "task_progress"), e(3, "chat"), e(4, "task_progress", "t2"), e(5, "task_progress"), e(6, "task_failed")]);
  assert.deepEqual(kept.map((x) => x.seq), [3, 4, 5, 6]);
  assert.deepEqual(withoutStaleProgress([]), []);
});
