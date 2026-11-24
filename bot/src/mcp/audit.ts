import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface AuditRecord {
  tool: string;
  args: unknown;
  outcome: unknown;
}

// One JSONL file per day. Outcomes are summaries the tools build (event names, never chat text).
export class Audit {
  constructor(
    readonly dir: string,
    private now: () => Date = () => new Date()
  ) {}

  write(rec: AuditRecord): void {
    const t = this.now();
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(path.join(this.dir, `${t.toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ time: t.toISOString(), ...rec }) + "\n");
    } catch (e) {
      // stdout is the protocol channel, so the only place to complain is stderr
      process.stderr.write(`mind audit write failed: ${(e as Error).message}\n`);
    }
  }
}
