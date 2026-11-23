import { createHash, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../lib/logger";
import type { Dispatcher } from "./dispatch";
import type { EventLog } from "./events";
import { parseFrame, type ClientMsg } from "./protocol";

const log = logger("api");

const AUTH_TIMEOUT_MS = 5000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 10;
const MAX_BUFFERED_BYTES = 1_000_000;

export interface ApiOptions {
  host: string;
  port: number;
  tokens: Map<string, string>; // token -> label
}

const digest = (s: string) => createHash("sha256").update(s).digest();

function labelFor(tokens: Map<string, string>, given: string): string | null {
  const want = digest(given);
  let found: string | null = null;
  // no early exit, so timing doesn't say which token was close
  for (const [token, label] of tokens) if (timingSafeEqual(digest(token), want)) found = label;
  return found;
}

export function startApiServer(opts: ApiOptions, dispatcher: Dispatcher, events: EventLog): WebSocketServer {
  const wss = new WebSocketServer({ host: opts.host, port: opts.port, maxPayload: 4096 });
  wss.on("listening", () => log.info("body API listening", { host: opts.host, port: opts.port }));
  wss.on("error", (err) => log.error("body API server error", { message: err.message }));
  wss.on("connection", (ws) => serve(ws, opts, dispatcher, events));
  return wss;
}

function serve(ws: WebSocket, opts: ApiOptions, dispatcher: Dispatcher, events: EventLog): void {
  const send = (o: unknown) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return void ws.close(1013, "slow consumer");
    ws.send(JSON.stringify(o));
  };
  let label: string | null = null;
  let unsubscribe = () => {};
  const recent: number[] = [];

  const authTimer = setTimeout(() => ws.close(1008, "auth timeout"), AUTH_TIMEOUT_MS);
  ws.on("close", () => {
    clearTimeout(authTimer);
    unsubscribe();
    if (label) log.info("consumer disconnected", { label });
  });
  ws.on("error", () => ws.terminate());

  ws.on("message", (data) => {
    const parsed = parseFrame(data.toString());

    if (!label) {
      if (!parsed.ok || parsed.msg.type !== "auth") return void ws.close(1008, "auth required");
      const who = labelFor(opts.tokens, parsed.msg.token);
      if (!who) {
        log.warn("auth failed");
        return void ws.close(1008, "auth failed");
      }
      label = who;
      clearTimeout(authTimer);
      log.info("consumer connected", { label });
      unsubscribe = begin(parsed.msg, send, events, dispatcher);
      return;
    }

    if (!parsed.ok) return send({ type: "rejected", id: parsed.id, reason: "bad_intent" });
    if (parsed.msg.type !== "intent") return send({ type: "rejected", reason: "bad_intent" });
    const m = parsed.msg;

    if (m.intent !== "stop") {
      const now = Date.now();
      while (recent.length && now - recent[0] > RATE_WINDOW_MS) recent.shift();
      if (recent.length >= RATE_MAX) return send({ type: "rejected", id: m.id, reason: "rate_limited" });
      recent.push(now);
    }

    log.debug("intent", { label, intent: m.intent });
    const out = dispatcher.handle(m);
    if (out.kind === "status") send({ type: "status", id: m.id, snapshot: out.snapshot });
    else if (out.kind === "observation") send({ type: "observation", id: m.id, observation: out.observation });
    else if (out.kind === "accepted") send({ type: "accepted", id: m.id, ...(out.taskId && { taskId: out.taskId }) });
    else send({ type: "rejected", id: m.id, reason: out.reason });
  });
}

// hello, optional replay, then live events — all in one tick so nothing slips between
function begin(
  auth: Extract<ClientMsg, { type: "auth" }>,
  send: (o: unknown) => void,
  events: EventLog,
  dispatcher: Dispatcher
): () => void {
  send({ type: "hello", epoch: events.epoch, seq: events.head, snapshot: dispatcher.snapshot() });
  if (auth.since !== undefined) {
    const { events: missed, gap } =
      auth.epoch === events.epoch ? events.since(auth.since) : { events: [], gap: events.oldest };
    if (gap !== undefined) send({ type: "gap", oldest: gap });
    for (const e of missed) send({ type: "event", ...e });
  }
  return events.subscribe((e) => send({ type: "event", ...e }));
}
