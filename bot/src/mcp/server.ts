import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Audit } from "./audit";
import type { BodyClient } from "./client";
import { TOOLS } from "./tools";

const text = (o: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(o) }], ...(isError && { isError: true }) });

// An argument the tool does not have is said so, in words, rather than dropped: a `seconds` to wait was silently read as the
// default 30 s. The schema is loose so the unknown names reach the handler (a strict one answers with a schema error).
export function unknownArgs(tool: string, known: string[], args: unknown): Record<string, unknown> | null {
  const extra = Object.keys((args ?? {}) as object).filter((k) => !known.includes(k));
  if (extra.length === 0) return null;
  const time = known.includes("timeout_s") && extra.some((k) => /^(seconds?|secs?|s|ms|time|timeout|duration|wait)$/i.test(k));
  const hint = `${tool} takes ${known.join(", ")}, not ${extra.join(", ")}${time ? "; timeout_s is the wait in seconds, 1 to 120" : ""}`;
  return { accepted: false, reason: "bad_args", hint };
}

// `client` is null when the adapter has no usable API settings: every tool that needs the body says so
export function buildServer(client: BodyClient | null, audit: Audit, notConfigured = "not configured"): McpServer {
  const server = new McpServer({ name: "scuttle-body", version: "0.1.0" });
  for (const def of TOOLS) {
    server.registerTool(def.name, { description: def.description, inputSchema: z.looseObject(def.shape) }, async (args: unknown) => {
      const wrong = unknownArgs(def.name, Object.keys(def.shape), args);
      if (wrong) {
        audit.write({ tool: def.name, args, outcome: wrong });
        return text(wrong);
      }
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
