import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startApiServer } from "../src/api/server";
import { createDispatcher, type BodyControl } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { FakeBody, TOKEN, sleep } from "./mcp-fake";

const bot = path.resolve(__dirname, "..");
const text = (r: any) => JSON.parse(r.content[0].text);

async function spawnAdapter(cwd: string, env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: path.join(bot, "node_modules/.bin/tsx"),
    args: [path.join(bot, "src/mcp/index.ts")],
    cwd, // somewhere that is not the repo, like the mind's own directory
    env: { ...getDefaultEnvironment(), ...env },
    stderr: "pipe",
  });
  const mcp = new Client({ name: "t", version: "0" });
  await mcp.connect(transport);
  return { mcp, transport };
}

test("over stdio from another directory: clean protocol, env file, default audit dir beside the cwd, exits when stdin closes", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mind-"));
  const fake = await FakeBody.start();
  writeFileSync(path.join(cwd, "bot.env"), `API_PORT=${fake.port}\nAPI_TOKENS=local:${TOKEN}\n`);
  const { mcp, transport } = await spawnAdapter(cwd, { BOT_ENV: "bot.env" });
  const pid = transport.pid!;
  try {
    assert.ok(Object.keys(text(await mcp.callTool({ name: "skills", arguments: {} })).tasks).includes("get_iron"));
    const s = text(await mcp.callTool({ name: "status", arguments: {} }));
    assert.equal(s.api, "connected");
    const a = text(await mcp.callTool({ name: "act", arguments: { action: "guard", player: "Sam", rationale: "test" } }));
    assert.equal(a.taskId, "t1");
    setTimeout(() => fake.emit("chat", { name: "Sam", message: "hi" }), 50);
    assert.equal(text(await mcp.callTool({ name: "wait", arguments: { taskId: "t1", timeout_s: 10 } })).reason, "chat");
    assert.ok(readdirSync(path.join(cwd, "mind-audit")).length === 1);
  } finally {
    await mcp.close();
    await fake.close();
  }
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
  assert.equal(alive(pid), false, "the adapter outlived its client");
  rmSync(cwd, { recursive: true, force: true });
});

test("over stdio with no settings: it still starts, skills answers, the rest say not_configured", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mind-"));
  const { mcp } = await spawnAdapter(cwd, { MIND_AUDIT_DIR: path.join(cwd, "audit") });
  try {
    assert.ok(text(await mcp.callTool({ name: "skills", arguments: {} })).tasks);
    assert.equal(text(await mcp.callTool({ name: "status", arguments: {} })).error, "not_configured");
  } finally {
    await mcp.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the adapter exits when its stdin ends, with a connection loop running", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mind-"));
  writeFileSync(path.join(cwd, "bot.env"), `API_PORT=1\nAPI_TOKENS=local:${TOKEN}\n`); // nothing listens: it is retrying
  const child = spawn(path.join(bot, "node_modules/.bin/tsx"), [path.join(bot, "src/mcp/index.ts")], {
    cwd,
    env: { ...getDefaultEnvironment(), BOT_ENV: "bot.env" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  try {
    await sleep(800);
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    child.stdin.end();
    await Promise.race([exited, sleep(5000).then(() => assert.fail("still running after stdin ended"))]);
  } finally {
    child.kill();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// the real server, dispatcher and protocol parser, so this fails if the adapter and the API drift apart
test("against the real body API server with a stub body", async () => {
  const { BodyClient } = await import("../src/mcp/client");
  const { TOOLS } = await import("../src/mcp/tools");
  let finish: () => void = () => {};
  const body: BodyControl = {
    inGame: () => true,
    fighting: () => false,
    danger: () => false,
    busy: () => false,
    canSee: () => true,
    vitals: () => ({ health: 20, food: 20 }),
    comeTo: () => new Promise<void>((res) => (finish = res)),
    follow: () => {},
    guard: () => new Promise<void>(() => {}),
    give: () => Promise.resolve(),
    runTask: () => new Promise<void>(() => {}),
    say: () => "sent",
    announce: () => {},
    stop: () => {},
    interrupt: () => {},
  };
  const events = new EventLog();
  const wss = startApiServer({ host: "127.0.0.1", port: 0, tokens: new Map([[TOKEN, "t"]]) }, createDispatcher(body, events), events);
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const client = new BodyClient({ url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, token: TOKEN });
  client.start();
  const call = async (n: string, a: object = {}) => (await TOOLS.find((t) => t.name === n)!.run({ client }, a)).out as any;
  try {
    assert.equal(await client.ready(2000), true);
    const a = await call("act", { action: "come_to", player: "Sam", rationale: "r" });
    assert.equal(a.accepted, true);
    assert.equal((await call("act", { action: "task", task: "get_wood", rationale: "r" })).reason, "busy");
    setTimeout(() => finish(), 30);
    const w = await call("wait", { taskId: a.taskId, timeout_s: 5 });
    assert.equal(w.reason, "task_ended");
    assert.match(w.ended, /task_finished taskId=t1/);
    assert.equal((await call("say", { text: "hello there" })).accepted, true);
    assert.equal((await call("act", { action: "give", player: "Sam", item: "oak_log", count: 3, rationale: "r" })).accepted, true);
  } finally {
    client.close();
    for (const c of wss.clients) c.terminate();
    wss.close();
  }
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

