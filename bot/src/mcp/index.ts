// MCP adapter over the body API (stdio). Run from the mind's own working directory:
//   BOT_ENV=/path/to/bot.env npx tsx <repo>/bot/src/mcp/index.ts
// stdout carries the protocol, so nothing here logs to it.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Audit } from "./audit";
import { BodyClient } from "./client";
import { loadApiEnv } from "./env";
import { buildServer } from "./server";

async function main() {
  const env = loadApiEnv(process.env);
  const client = env.ok ? new BodyClient({ url: env.url, token: env.token }) : null;
  if (!env.ok) process.stderr.write(`scuttle mcp adapter: ${env.error}\n`);
  client?.start();

  const audit = new Audit(process.env.MIND_AUDIT_DIR || "./mind-audit");
  const server = buildServer(client, audit, env.ok ? "" : env.error);
  const shutdown = () => {
    client?.close();
    process.exit(0);
  };
  // the reconnect loop would keep the process alive after the session that started it is gone
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`scuttle mcp adapter failed: ${(e as Error).message}\n`);
  process.exit(1);
});
