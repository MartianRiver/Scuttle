// Sends one intent to the local bot's API and prints events until the task ends.
// Run from bot/: npx tsx testworld/drive.ts task get_wood | come_to <player> | stop | status
import { format } from "node:util";
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");

const env = readFileSync("../run/bot.env", "utf8");
const token = env.match(/^API_TOKENS=[^:]+:(\S+)/m)?.[1];
const port = env.match(/^API_PORT=(\d+)/m)?.[1] ?? "8787";
if (!token) throw new Error("no API_TOKENS in run/bot.env; start testworld/bot.sh first");

const [intent = "status", arg] = process.argv.slice(2);
const msg: Record<string, string> = { type: "intent", id: "d1", intent };
if (intent === "task") msg.name = arg ?? "get_wood";
if (intent === "come_to" || intent === "follow") msg.player = arg ?? "";

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const t0 = Date.now();
const out = (s: string) => say(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === "hello") return ws.send(JSON.stringify(msg));
  if (m.type === "event" && m.event === "chat") return;
  out(JSON.stringify(m));
  const finished = ["task_finished", "task_failed", "task_stopped"].includes(m.event);
  if (m.type === "rejected" || m.type === "status" || finished || (intent === "stop" && m.type === "accepted")) {
    ws.close();
  }
});
ws.on("close", () => process.exit(0));
ws.on("error", (e) => {
  out(`error ${e}`);
  process.exit(1);
});
