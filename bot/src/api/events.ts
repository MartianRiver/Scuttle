import { randomBytes } from "node:crypto";

export interface BotEvent {
  seq: number;
  ts: number;
  event: string;
  [field: string]: unknown;
}

// Sequenced ring buffer so a reconnecting consumer can resume without duplicates.
// `epoch` changes on every process start, because seq restarts from 0 then.
export class EventLog {
  readonly epoch = randomBytes(6).toString("hex");
  private buf: BotEvent[] = [];
  private seq = 0;
  private listeners = new Set<(e: BotEvent) => void>();

  constructor(private cap = 500) {}

  get head(): number {
    return this.seq;
  }

  get oldest(): number {
    return this.buf[0]?.seq ?? this.seq + 1;
  }

  emit(event: string, fields: Record<string, unknown> = {}): BotEvent {
    const e: BotEvent = { ...fields, seq: ++this.seq, ts: Date.now(), event };
    this.buf.push(e);
    if (this.buf.length > this.cap) this.buf.shift();
    for (const fn of this.listeners) fn(e);
    return e;
  }

  // gap is set when `seq` is older than what we still hold
  since(seq: number): { events: BotEvent[]; gap?: number } {
    const gap = seq + 1 < this.oldest ? this.oldest : undefined;
    return { events: this.buf.filter((e) => e.seq > seq), gap };
  }

  subscribe(fn: (e: BotEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
