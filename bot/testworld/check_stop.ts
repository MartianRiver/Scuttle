// Checks that `stop` reaches whatever the running bot is doing: walking, digging, crafting, chests.
// Needs the test server and testworld/bot.sh running (the bot is ScuttleTest). It clears that
// bot's inventory and the first stash chest. Run from bot/: npx tsx testworld/check_stop.ts
import { format } from "node:util";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { home } from "../src/lib/home";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");

const NAME = "ScuttleTest";
const chest = home.stashChests[0];
const at = `${chest.x} ${chest.y} ${chest.z}`;
const START = "0.5 68 -10"; // world spawn, well away from the chest and the table

const rcon = (cmd: string) => execFileSync("python3", ["testworld/rcon.py", cmd], { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (item: string) => Number(rcon(`clear ${NAME} ${item} 0`).match(/Found (\d+)/)?.[1] ?? 0);
const chestLogs = () => Number(rcon(`data get block ${at} Items[{id:"minecraft:oak_log"}].count`).match(/data: (\d+)\s*$/)?.[1] ?? 0);
const chestHoldsAny = () => /following block data/.test(rcon(`data get block ${at} Items[0]`));
const nearChest = () => rcon(`execute positioned ${at} if entity @a[name=${NAME},distance=..3]`).includes("Test passed");
const pos = () => (rcon(`data get entity ${NAME} Pos`).match(/-?[\d.]+(?=d)/g) ?? []).map(Number);
const moved = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const env = readFileSync("../run/bot.env", "utf8");
const token = env.match(/^API_TOKENS=[^:]+:(\S+)/m)?.[1];
const port = env.match(/^API_PORT=(\d+)/m)?.[1] ?? "8787";
if (!token) throw new Error("no API_TOKENS in run/bot.env; start testworld/bot.sh first");

const events: Array<{ event: string; taskId?: string; reason?: string }> = [];
const replies = new Map<string, { type: string; reason?: string }>();
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const ready = new Promise<void>((resolve) => {
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === "hello") resolve();
    else if (m.type === "event") events.push(m);
    else if (m.id) replies.set(m.id, m);
  });
});

let ids = 0;
async function send(intent: object): Promise<{ type: string; reason?: string }> {
  const id = `s${++ids}`;
  ws.send(JSON.stringify({ type: "intent", id, ...intent }));
  for (let i = 0; i < 50 && !replies.has(id); i++) await sleep(20);
  return replies.get(id) ?? { type: "none" };
}

async function waitEvent(name: string, from: number, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) {
    if (events.slice(from).some((e) => e.event === name)) return true;
  }
  return false;
}

// a stopped task takes a moment to wind down, and until it has, `task` is busy
async function start(): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const r = await send({ intent: "task", name: "get_wood" });
    if (r.type === "accepted") return true;
    await sleep(1000);
  }
  return false;
}

let failed = false;
function check(ok: boolean, what: string) {
  say(ok ? "PASS" : "FAIL", what);
  if (!ok) failed = true;
}

async function stopAndCheck(label: string, from: number) {
  await send({ intent: "stop" });
  check(await waitEvent("task_stopped", from, 3000), `${label}: task_stopped within 3 s`);
}

async function steady(label: string, what: () => string) {
  await sleep(500);
  const before = what();
  await sleep(3000);
  const after = what();
  check(before === after, `${label}: steady for 3 s (${before}${before === after ? "" : ` -> ${after}`})`);
}

async function reset() {
  await send({ intent: "stop" });
  await sleep(1500);
  rcon(`clear ${NAME}`);
  rcon(`tp ${NAME} ${START}`);
  await sleep(1000);
}

async function midWalk() {
  await reset();
  const from = events.length;
  await start();
  await sleep(1000);
  await stopAndCheck("mid-walk", from);
  await steady("mid-walk", () => pos().map((n) => Math.round(n)).join(","));
  check(count("oak_log") === 0, "mid-walk: no oak_log in inventory");
}

async function midDig() {
  await reset();
  const from = events.length;
  await start();
  for (let i = 0; i < 400 && count("#minecraft:logs") < 1; i++) await sleep(150);
  await sleep(800);
  await stopAndCheck("mid-dig", from);
  await steady("mid-dig", () => `${count("#minecraft:logs")} logs at ${pos().map((n) => Math.round(n))}`);
}

async function midCraft() {
  await reset();
  rcon(`give ${NAME} oak_log 16`);
  const from = events.length;
  await start();
  for (let i = 0; i < 400 && count("#minecraft:planks") < 1; i++) await sleep(100);
  await stopAndCheck("mid-craft", from);
  const again = events.length;
  check(await start(), "mid-craft: task accepted again");
  check(await waitEvent("task_finished", again, 120_000), "mid-craft: second run finishes");
  check(count("wooden_pickaxe") >= 1 && count("wooden_axe") >= 1, "mid-craft: pickaxe and axe made");
}

async function midDeposit() {
  await reset();
  rcon(`data modify block ${at} Items set value []`);
  for (const give of ["oak_log 16", "oak_planks 12", "stick 4", "wooden_pickaxe 1", "wooden_axe 1"]) rcon(`give ${NAME} ${give}`);
  const total = () => count("oak_log") + chestLogs();
  check(total() === 16, `mid-deposit: setup holds 16 logs, saw ${total()}`);
  const from = events.length;
  await start();
  for (let i = 0; i < 300 && !nearChest() && !chestHoldsAny(); i++) await sleep(50);
  await stopAndCheck("mid-deposit", from);
  await sleep(1500);
  check(total() === 16, `mid-deposit: logs after stop ${count("oak_log")} held + ${chestLogs()} chest`);
  const again = events.length;
  check(await start(), "mid-deposit: task accepted again");
  check(await waitEvent("task_finished", again, 60_000), "mid-deposit: second run finishes");
  check(total() === 16, `mid-deposit: logs after finish ${count("oak_log")} held + ${chestLogs()} chest`);
}

(async () => {
  await ready;
  for (const stage of [midWalk, midDig, midCraft, midDeposit]) await stage();
  await send({ intent: "stop" });
  say(failed ? "FAIL stop check" : "PASS stop check");
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  say("FAIL", String(e));
  process.exit(1);
});
setTimeout(() => (say("FAIL timed out"), process.exit(1)), 600_000);
