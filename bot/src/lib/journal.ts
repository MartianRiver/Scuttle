// What the body changed in the world: one line per dig or place, appended as it happens, so it can tell its own
// blocks from a player's after a restart. The core is pure (parse, rotate, the latest entry per cell, ownAt); the
// file is one thin layer under it, opened by index.ts with a path. Until then the journal is in memory only, which
// keeps unit tests off the disk. Positions stay in the file and the audit log, never in API output.
import fs from "node:fs";
import path from "node:path";
import type { Pos } from "./block-rules";

export type Entry = {
  t: number;
  op: "place" | "dig";
  pos: Pos;
  before: string;
  after: string;
  job: string;
  own: boolean; // a place for the body's own use; digs are never own
};

export const ROTATE_BYTES = 5 * 1024 * 1024;

export const keyOf = (p: Pos): string => `${p.x},${p.y},${p.z}`;

// a line that is not an entry (a half-written last line after a kill, an old format) is skipped
export function parseLines(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Entry;
      const p = e.pos;
      if ((e.op === "place" || e.op === "dig") && typeof e.after === "string" && typeof e.before === "string" && p && Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z)) {
        out.push({ t: Number(e.t) || 0, op: e.op, pos: { x: p.x, y: p.y, z: p.z }, before: e.before, after: e.after, job: String(e.job ?? ""), own: e.own === true });
      }
    } catch {
      // skipped
    }
  }
  return out;
}

// the job key of a run that undoes `job`: `undo|<job>|<ts>`. Its places are not for the body's own use, and what it
// takes out supersedes the original entries for those cells
export const UNDO_PREFIX = "undo|";
export const undoJob = (job: string, now: number): string => `${UNDO_PREFIX}${job}|${now}`;
export const isUndoJob = (job: string): boolean => job.startsWith(UNDO_PREFIX);

const HISTORY_CAP = 20_000;

export class Journal {
  private latest = new Map<string, Entry>();
  private log: Entry[] = []; // every entry, oldest first, for `undo`

  load(entries: readonly Entry[]): void {
    for (const e of entries) this.add(e);
  }

  add(e: Entry): void {
    this.latest.set(keyOf(e.pos), e);
    this.log.push(e);
    if (this.log.length > HISTORY_CAP * 2) this.log.splice(0, this.log.length - HISTORY_CAP);
  }

  history(): readonly Entry[] {
    return this.log;
  }

  latestAt(pos: Pos): Entry | undefined {
    return this.latest.get(keyOf(pos));
  }

  // the body placed this block for its own use, nothing has been journalled there since, and it is still what it placed
  ownAt(pos: Pos, blockNow: string): boolean {
    const e = this.latest.get(keyOf(pos));
    return e !== undefined && e.op === "place" && e.own && e.after === blockNow;
  }

  // an undo set this block back where it had been dug: not for the body's own use (nothing can pick it up as its own
  // table), but cobblestone and the like read as a build, and the body's own work must not look like one to its next dig
  restoredAt(pos: Pos, blockNow: string): boolean {
    const e = this.latest.get(keyOf(pos));
    return e !== undefined && e.op === "place" && isUndoJob(e.job) && e.after === blockNow;
  }

  // the cells the body placed and still owns, for the names `match` takes (observe, make_base, chest lookups)
  ownCells(match: (after: string) => boolean): Pos[] {
    const out: Pos[] = [];
    for (const e of this.latest.values()) if (e.op === "place" && e.own && match(e.after)) out.push(e.pos);
    return out;
  }
}

export const journal = new Journal();

let file: string | null = null;
let size = 0;
let limit = ROTATE_BYTES;

// the file for one bot name beside the restart state; both slots of the test world share a profiles folder, so the
// name (ScuttleTest, ScuttleTest1) is what keeps their journals apart
export const journalFile = (dir: string, name: string): string => path.join(dir, `journal-${name}.jsonl`);

// Loads the older file then the current one into the journal and starts appending. The journal never throws: a file
// that cannot be written leaves it in memory.
export function openJournal(dir: string, name: string, rotateAt = ROTATE_BYTES): void {
  limit = rotateAt;
  file = journalFile(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [`${file}.1`, file]) if (fs.existsSync(f)) journal.load(parseLines(fs.readFileSync(f, "utf8")));
    size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch {
    file = null;
  }
}

// Remembers the entry and appends it. At about 5 MB the current file becomes `.1` (replacing the one before) and a new
// one starts; the cells the old file named stay in memory for this run and are read back from the pair at the next start.
export function record(e: Entry): void {
  journal.add(e);
  if (!file) return;
  try {
    if (size >= limit) {
      fs.renameSync(file, `${file}.1`);
      size = 0;
    }
    const line = JSON.stringify(e) + "\n";
    fs.appendFileSync(file, line);
    size += Buffer.byteLength(line);
  } catch {
    // the entry still counts in memory
  }
}
