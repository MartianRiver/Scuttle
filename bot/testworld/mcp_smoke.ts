// Starts the MCP adapter over stdio, as a Claude Code session would, and calls `skills`, `status` and `observe`.
// Run from bot/ with the bot already up: BOT_ENV=<bot env file> npx tsx testworld/mcp_smoke.ts
// Add `act` as args to also send a `stop`, then walk home with go_to and wait for it to end.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const bot = path.resolve(__dirname, "..");
const out = (s: string) => process.stdout.write(s + "\n");
const show = (label: string, r: any) => out(`${label}: ${r.content[0].text.slice(0, 600)}`);

async function main() {
  const BOT_ENV = process.env.BOT_ENV;
  if (!BOT_ENV) throw new Error("set BOT_ENV to the bot's env file");
  const transport = new StdioClientTransport({
    command: path.join(bot, "node_modules/.bin/tsx"),
    args: [path.join(bot, "src/mcp/index.ts")],
    cwd: mkdtempSync(path.join(tmpdir(), "mind-smoke-")),
    env: { ...getDefaultEnvironment(), BOT_ENV: path.resolve(BOT_ENV), MIND_AUDIT_DIR: path.join(tmpdir(), "mind-smoke-audit") },
    stderr: "inherit",
  });
  const mcp = new Client({ name: "smoke", version: "0" });
  await mcp.connect(transport);
  out(`tools: ${(await mcp.listTools()).tools.map((t) => t.name).join(", ")}`);
  show("skills", await mcp.callTool({ name: "skills", arguments: {} }));
  show("status", await mcp.callTool({ name: "status", arguments: {} }));
  show("observe", await mcp.callTool({ name: "observe", arguments: {} }));
  if (process.argv[2] === "act") {
    show("stop", await mcp.callTool({ name: "act", arguments: { action: "stop", rationale: "smoke test" } }));
    const go = await mcp.callTool({ name: "act", arguments: { action: "go_to", handle: "home", rationale: "smoke test" } });
    show("go_to home", go);
    const taskId = JSON.parse((go as any).content[0].text).taskId;
    if (taskId) show("wait", await mcp.callTool({ name: "wait", arguments: { taskId, timeout_s: 60 } }, undefined, { timeout: 70_000 }));
  }
  await mcp.close();
}

main().catch((e) => {
  out(`smoke failed: ${e}`);
  process.exit(1);
});
