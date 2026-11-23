import WebSocket from "ws";
import type { RecipeAnswer, Snapshot, StashAnswer } from "../api/dispatch";
import type { Observation } from "../senses/compose";
import type { BotEvent } from "../api/events";
import { parseFrame } from "../api/protocol";

// A client for the body's WebSocket API (API.md): auth, resume after a drop, an event buffer,
// request/reply by id. Writes nothing to stdout (it is the MCP channel).

export type ConnState = "connecting" | "connected" | "reconnecting" | "auth_failed" | "closed";

export type Reply =
  | { kind: "accepted"; taskId?: string }
  | { kind: "rejected"; reason: string }
  | { kind: "status"; snapshot: Snapshot }
  | { kind: "observation"; observation: Observation }
  | { kind: "recipe"; recipe: RecipeAnswer }
  | { kind: "stash"; stash: StashAnswer }
  | { kind: "invalid" } // our own frame failed the protocol's parser; nothing was sent
  | { kind: "offline" } // no connection to the body API
  | { kind: "no_reply" }; // sent, but the connection dropped or the reply timed out: outcome unknown

export interface ClientOptions {
  url: string;
  token: string;
  backoffMs?: number[]; // the last value repeats
  cap?: number; // buffered events, oldest dropped
  replyTimeoutMs?: number;
  snapshotMaxAgeMs?: number; // status is cached this long, the body rate-limits intents
}

const READ_ONLY = ["status", "observe", "recipe", "stash"];
const BACKOFF = [500, 1000, 2000, 4000, 8000, 10_000];

export class BodyClient {
  state: ConnState = "connecting";
  epoch: string | undefined;
  head = 0; // last event seq seen
  seen = 0; // last seq handed to the mind
  dropped = 0;
  private buf: BotEvent[] = [];
  private notices: string[] = [];
  private snapshot: Snapshot | undefined;
  private snapshotAt = 0;
  private ws: WebSocket | null = null;
  private timer: NodeJS.Timeout | undefined;
  private attempts = 0;
  private counter = 0;
  private pending = new Map<string, (r: Reply) => void>();
  private eventFns = new Set<(e: BotEvent) => void>();
  private restartFns = new Set<() => void>();
  private connectedFns = new Set<() => void>();
  private opts: Required<ClientOptions>;

  constructor(opts: ClientOptions) {
    this.opts = { backoffMs: BACKOFF, cap: 500, replyTimeoutMs: 5000, snapshotMaxAgeMs: 2000, ...opts };
  }

  start(): void {
    this.open();
  }

  close(): void {
    this.state = "closed";
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.terminate();
    this.failPending();
    for (const fn of this.connectedFns) fn();
  }

  get connected(): boolean {
    return this.state === "connected";
  }

  // resolves true once connected, false if it can't be (timeout, bad token, closed)
  ready(timeoutMs: number): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    if (this.state === "auth_failed" || this.state === "closed") return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.connectedFns.delete(done);
        resolve(this.connected);
      };
      const t = setTimeout(done, timeoutMs);
      this.connectedFns.add(done);
    });
  }

  drainNotices(): string[] {
    return this.notices.splice(0);
  }

  eventsAfter(seq: number): BotEvent[] {
    return this.buf.filter((e) => e.seq > seq);
  }

  find(pred: (e: BotEvent) => boolean): BotEvent | undefined {
    return this.buf.find(pred);
  }

  findLast(pred: (e: BotEvent) => boolean): BotEvent | undefined {
    for (let i = this.buf.length - 1; i >= 0; i--) if (pred(this.buf[i])) return this.buf[i];
    return undefined;
  }

  get oldest(): number {
    return this.buf[0]?.seq ?? this.head + 1;
  }

  onEvent(fn: (e: BotEvent) => void): () => void {
    this.eventFns.add(fn);
    return () => this.eventFns.delete(fn);
  }

  onRestart(fn: () => void): () => void {
    this.restartFns.add(fn);
    return () => this.restartFns.delete(fn);
  }

  // the last snapshot, asked for again only when older than snapshotMaxAgeMs
  async status(force = false): Promise<{ snapshot: Snapshot | undefined; fresh: boolean }> {
    const age = Date.now() - this.snapshotAt;
    if (!force && this.snapshot && this.connected && age < this.opts.snapshotMaxAgeMs) return { snapshot: this.snapshot, fresh: true };
    const r = await this.send({ intent: "status" });
    if (r.kind === "status") return { snapshot: r.snapshot, fresh: true };
    return { snapshot: this.snapshot, fresh: false };
  }

  // `fields` is the intent without type and id. Whatever is sent has passed the protocol's own parser.
  async send(fields: Record<string, unknown>): Promise<Reply> {
    if (!(await this.ready(3000))) return { kind: "offline" };
    const ws = this.ws;
    if (!ws) return { kind: "offline" };
    const id = `m${++this.counter}`;
    const raw = JSON.stringify({ type: "intent", id, ...fields });
    if (!parseFrame(raw).ok) return { kind: "invalid" };
    return new Promise<Reply>((resolve) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        resolve({ kind: "no_reply" });
      }, this.opts.replyTimeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      ws.send(raw, (err) => {
        if (err) this.pending.get(id)?.({ kind: "no_reply" });
      });
      if (!READ_ONLY.includes(fields.intent as string)) this.snapshotAt = 0; // the world just changed under the cache
    });
  }

  private open(): void {
    if (this.state === "closed") return;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    let welcomed = false;
    let restarted = false;

    ws.on("open", () => {
      const resume = this.epoch !== undefined ? { since: this.head, epoch: this.epoch } : {};
      ws.send(JSON.stringify({ type: "auth", token: this.opts.token, ...resume }));
    });

    ws.on("message", (data) => {
      let m: Record<string, any>;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (m.type) {
        case "hello":
          welcomed = true;
          this.attempts = 0;
          restarted = this.hello(m.epoch, m.seq, m.snapshot);
          break;
        case "gap":
          if (!restarted) this.notices.push(`events_lost: the body only holds events from #${m.oldest} on, some before that were never seen`);
          break;
        case "event":
          this.event(m as BotEvent);
          break;
        case "status":
          this.snapshot = m.snapshot;
          this.snapshotAt = Date.now();
          this.reply(m.id, { kind: "status", snapshot: m.snapshot });
          break;
        case "observation":
          this.reply(m.id, { kind: "observation", observation: m.observation });
          break;
        case "recipe":
          this.reply(m.id, { kind: "recipe", recipe: m.recipe });
          break;
        case "stash":
          this.reply(m.id, { kind: "stash", stash: m.stash });
          break;
        case "accepted":
          this.reply(m.id, { kind: "accepted", ...(m.taskId && { taskId: m.taskId }) });
          break;
        case "rejected":
          this.reply(m.id, { kind: "rejected", reason: String(m.reason) });
          break;
      }
    });

    ws.on("error", () => {}); // a close always follows

    ws.on("close", (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failPending();
      if (this.state === "closed") return;
      if (code === 1008 && !welcomed) {
        this.state = "auth_failed"; // retrying a bad token only fills the body's log
        this.notices.push("auth_failed: the body API refused the token; fix API_TOKENS and restart the adapter");
        for (const fn of this.connectedFns) fn();
        return;
      }
      this.state = "reconnecting";
      const wait = this.opts.backoffMs[Math.min(this.attempts++, this.opts.backoffMs.length - 1)];
      this.timer = setTimeout(() => this.open(), wait);
    });
  }

  // returns true when the bot has restarted since we last saw it (event numbers start over)
  private hello(epoch: string, seq: number, snapshot: Snapshot): boolean {
    let restarted = false;
    if (this.epoch !== undefined && this.epoch !== epoch) {
      restarted = true;
      this.buf = [];
      this.notices.push("bot_restarted: the body process restarted; event numbers start over and any task ids from before are gone");
    }
    if (this.epoch === undefined || restarted) this.head = this.seen = seq;
    this.epoch = epoch;
    this.snapshot = snapshot;
    this.snapshotAt = Date.now();
    this.state = "connected";
    if (restarted) for (const fn of this.restartFns) fn();
    for (const fn of this.connectedFns) fn();
    return restarted;
  }

  private event(frame: BotEvent & { type?: string }): void {
    const { type: _type, ...e } = frame; // the wire frame's own type is not part of the event
    if (e.seq <= this.head) return;
    this.head = e.seq;
    this.buf.push(e);
    if (this.buf.length > this.opts.cap) {
      this.buf.shift();
      this.dropped++;
    }
    for (const fn of this.eventFns) fn(e);
  }

  private reply(id: unknown, r: Reply): void {
    if (typeof id !== "string") return;
    const fn = this.pending.get(id);
    if (!fn) return;
    this.pending.delete(id);
    fn(r);
  }

  private failPending(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn({ kind: "no_reply" });
  }
}
