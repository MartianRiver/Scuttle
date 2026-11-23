import { randomBytes } from "node:crypto";

export const DETAIL_MAX = 120;
export const GOT_MAX_ITEMS = 4;

// The extra fields on a task's ending or progress line: `detail` is words only (a digit is dropped, so a
// distance or a position cannot slip through) and short; `got` is item counts, a few of the biggest.
export function endFields(info: { detail?: unknown; got?: unknown }): { detail?: string; got?: Record<string, number> } {
  const out: { detail?: string; got?: Record<string, number> } = {};
  if (typeof info.detail === "string") {
    const detail = info.detail.replace(/\d+/g, "").replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX);
    if (detail) out.detail = detail;
  }
  if (typeof info.got === "object" && info.got !== null) {
    const items = Object.entries(info.got as Record<string, unknown>)
      .filter(([k, v]) => /^[a-z_]{1,48}$/.test(k) && Number.isInteger(v) && (v as number) > 0)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, GOT_MAX_ITEMS);
    if (items.length > 0) out.got = Object.fromEntries(items) as Record<string, number>;
  }
  return out;
}

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
