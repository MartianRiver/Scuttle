import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Audit } from "./audit";
import type { BodyClient } from "./client";
import { TOOLS } from "./tools";

const text = (o: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(o) }], ...(isError && { isError: true }) });

// `client` is null when the adapter has no usable API settings: every tool that needs the body says so
export function buildServer(client: BodyClient | null, audit: Audit, notConfigured = "not configured"): McpServer {
  const server = new McpServer({ name: "scuttle-body", version: "0.1.0" });
  for (const def of TOOLS) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, async (args: unknown) => {
      if (def.needsBody && !client) {
        const out = { error: "not_configured", detail: notConfigured };
        audit.write({ tool: def.name, args, outcome: out });
        return text(out, true);
      }
      try {
        const r = await def.run({ client: client as BodyClient }, args);
        audit.write({ tool: def.name, args, outcome: r.audit });
        return text(r.out);
      } catch (e) {
        const out = { error: "adapter_error", detail: (e as Error).message };
        audit.write({ tool: def.name, args, outcome: out });
        return text(out, true);
      }
    });
  }
  return server;
}
