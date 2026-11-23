import { WebSocketServer, type WebSocket } from "ws";
import { BodyClient, type ClientOptions } from "../src/mcp/client";

export const TOKEN = "t".repeat(32);

type Frame = Record<string, any>;

// An in-process stand-in for the body API on a random port. Mirrors server.ts: auth first,
// hello, replay or gap for `since`, then live events.
export class FakeBody {
  epoch = "e1";
  seq = 0;
  events: Frame[] = [];
  frames: Frame[] = []; // every frame received, auth included
  snapshot = { inGame: true, task: null as string | null, taskId: null as string | null, health: 20, food: 18 };
  reply: (m: Frame) => Frame | null = (m) => {
    if (m.intent === "status") return { type: "status", id: m.id, snapshot: this.snapshot };
    return { type: "accepted", id: m.id, ...(m.intent === "say" ? {} : { taskId: `t${++this.tasks}` }) };
  };
  private tasks = 0;
  private live = new Set<WebSocket>();
  private wss!: WebSocketServer;
  port = 0;

  static async start(): Promise<FakeBody> {
    const f = new FakeBody();
    f.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((r) => f.wss.once("listening", () => r()));
    f.port = (f.wss.address() as { port: number }).port;
    f.wss.on("connection", (ws) => f.serve(ws));
    return f;
  }

  get url() {
    return `ws://127.0.0.1:${this.port}`;
  }

  get auths() {
    return this.frames.filter((f) => f.type === "auth");
  }

  get intents() {
    return this.frames.filter((f) => f.type === "intent");
  }

  private serve(ws: WebSocket) {
    let authed = false;
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      this.frames.push(m);
      if (!authed) {
        if (m.type !== "auth" || m.token !== TOKEN) return void ws.close(1008, "auth failed");
        authed = true;
        ws.send(JSON.stringify({ type: "hello", epoch: this.epoch, seq: this.seq, snapshot: this.snapshot }));
        if (m.since !== undefined) {
          if (m.epoch !== this.epoch) ws.send(JSON.stringify({ type: "gap", oldest: this.events[0]?.seq ?? this.seq + 1 }));
          else for (const e of this.events.filter((e) => e.seq > m.since)) ws.send(JSON.stringify({ type: "event", ...e }));
        }
        this.live.add(ws);
        return;
      }
      const r = this.reply(m);
      if (r) ws.send(JSON.stringify(r));
    });
    ws.on("close", () => this.live.delete(ws));
  }

  emit(event: string, fields: Frame = {}) {
    const e = { ...fields, seq: ++this.seq, ts: Date.now(), event };
    this.events.push(e);
    for (const ws of this.live) ws.send(JSON.stringify({ type: "event", ...e }));
    return e;
  }

  dropClients() {
    for (const ws of this.live) ws.terminate();
    this.live.clear();
  }

  async close() {
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}

export async function connected(fake: FakeBody, opts: Partial<ClientOptions> = {}): Promise<BodyClient> {
  const c = new BodyClient({ url: fake.url, token: TOKEN, backoffMs: [10], replyTimeoutMs: 500, ...opts });
  c.start();
  if (!(await c.ready(2000))) throw new Error("fake never connected");
  return c;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("until: timed out");
    await sleep(5);
  }
}
