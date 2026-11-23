// One long-lived MCP session against the running bot, driven a line at a time: `tool {json args}`.
// Keeps the adapter's event cursor across calls, as a real mind would. From bot/, with the bot up:
//   touch /tmp/mind.cmds; tail -f /tmp/mind.cmds | BOT_ENV=<env> npx tsx testworld/mind_repl.ts > /tmp/mind.out
// then append lines like `observe` or `act {"action":"go_to","handle":"home","rationale":"r"}` to /tmp/mind.cmds.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const bot = path.resolve(__dirname, "..");
const out = (s: string) => process.stdout.write(s + "\n");

async function main() {
  const BOT_ENV = process.env.BOT_ENV;
  if (!BOT_ENV) throw new Error("set BOT_ENV to the bot's env file");
  const transport = new StdioClientTransport({
    command: path.join(bot, "node_modules/.bin/tsx"),
    args: [path.join(bot, "src/mcp/index.ts")],
    cwd: mkdtempSync(path.join(tmpdir(), "mind-repl-")),
    env: { ...getDefaultEnvironment(), BOT_ENV: path.resolve(BOT_ENV), MIND_AUDIT_DIR: path.join(tmpdir(), "mind-repl-audit") },
    stderr: "inherit",
  });
  const mcp = new Client({ name: "repl", version: "0" });
  await mcp.connect(transport);
  out("ready");

  // one call at a time, in order, so a wait never overlaps the next order
  let chain = Promise.resolve();
  for await (const raw of readline.createInterface({ input: process.stdin })) {
    const text = raw.trim();
    if (!text) continue;
    const [name, ...rest] = text.split(" ");
    chain = chain.then(async () => {
      try {
        const args = rest.length ? JSON.parse(rest.join(" ")) : {};
        // the SDK's own request timeout would cut a long wait short
        const r: any = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 130_000 });
        out(`${new Date().toISOString().slice(11, 19)} ${name}: ${r.content[0].text}`);
      } catch (e) {
        out(`${name} failed: ${e}`);
      }
    });
  }
  await chain;
  await mcp.close();
}

main().catch((e) => {
  out(`repl failed: ${e}`);
  process.exit(1);
});
