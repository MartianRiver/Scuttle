import { randomBytes } from "node:crypto";

export const DETAIL_MAX = 120;
export const GOT_MAX_ITEMS = 4;
export const STORED_MAX_ITEMS = 8;

const wordsOnly = (s: string) => s.replace(/\d+/g, "").replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX);

// item counts, the biggest few; nothing but lowercase names and whole numbers gets through
function counts(v: unknown, max: number): Record<string, number> | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const items = Object.entries(v as Record<string, unknown>)
    .filter(([k, n]) => /^[a-z_]{1,48}$/.test(k) && Number.isInteger(n) && (n as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, max);
  return items.length > 0 ? (Object.fromEntries(items) as Record<string, number>) : undefined;
}

export interface EndInfo {
  detail?: unknown;
  got?: unknown;
  missing?: unknown;
  stored?: unknown;
  saw?: unknown;
}

// The extra fields on a task's ending or progress line: `detail` and `saw` are words only (a digit is dropped, so a
// distance or a position cannot slip through) and short; `got`, `missing` and `stored` are item counts, a few of the biggest.
export function endFields(info: EndInfo): { detail?: string; got?: Record<string, number>; missing?: Record<string, number>; stored?: Record<string, number>; saw?: string } {
  const out: ReturnType<typeof endFields> = {};
  for (const key of ["detail", "saw"] as const) {
    const v = info[key];
    if (typeof v === "string" && wordsOnly(v)) out[key] = wordsOnly(v);
  }
  const got = counts(info.got, GOT_MAX_ITEMS);
  if (got) out.got = got;
  const missing = counts(info.missing, GOT_MAX_ITEMS);
  if (missing) out.missing = missing;
  const stored = counts(info.stored, STORED_MAX_ITEMS);
  if (stored) out.stored = stored;
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
