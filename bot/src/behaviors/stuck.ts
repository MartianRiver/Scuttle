// The decision half of the no-progress watchdog: position samples in, ok / nudge / give_up out. No
// mineflayer here; unstuck.ts reads the body and acts on the answer.

export const WINDOW_MS = 8_000; // a walk that has gone nowhere for this long is stuck (slow real walking covers 1 block in under a second)
export const MIN_MOVE = 1; // blocks, sideways from where it is now or up/down end to end; a jump on the spot peaks at 1.25 but ends where it began
export const MAX_NUDGES = 2; // per action, then give up
export const SAMPLE_MS = 250;

export interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface Context {
  goalSet: boolean; // the walk is still on
  busy: boolean; // something legitimate holds the body still: a dig, an open window, a reflex, a nudge in progress
  nudges: number; // already spent on this action
}

export type Verdict = "ok" | "nudge" | "give_up";

// keep a little more than the window, so one late tick never leaves the judge short of history
export function trim(samples: Sample[], now: number): Sample[] {
  return samples.filter((s) => now - s.t <= WINDOW_MS + 2 * SAMPLE_MS);
}

// how far the body has really gone: the widest sideways reach from where it is now, or its net rise
// or fall. Vertical is net, not widest, so a bot jumping against a wall does not look like progress.
export function spread(samples: Sample[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return 0;
  const sideways = samples.reduce((far, s) => Math.max(far, Math.hypot(s.x - last.x, s.z - last.z)), 0);
  return Math.max(sideways, Math.abs(last.y - first.y));
}

export function judge(samples: Sample[], now: number, ctx: Context): Verdict {
  if (!ctx.goalSet || ctx.busy) return "ok";
  const oldest = samples[0];
  if (!oldest || now - oldest.t < WINDOW_MS) return "ok"; // not watched long enough to say
  const inWindow = samples.filter((s) => now - s.t <= WINDOW_MS);
  if (spread(inWindow) >= MIN_MOVE) return "ok";
  return ctx.nudges < MAX_NUDGES ? "nudge" : "give_up";
}

// ---- how a stuck walk is described to the mind: words only, never a player's name or a number ----

// what the body was doing, from its status text
export function activityWords(status: string): string {
  const s = status.replace(/\d+/g, "").trim();
  if (s === "" || s === "idle") return "walking";
  if (s.startsWith("walking to ")) {
    const rest = s.slice("walking to ".length);
    return rest === "home" || rest.startsWith("the ") ? s : "walking to a player";
  }
  if (s.startsWith("bringing ")) return "bringing items to a player";
  if (s.startsWith("following ") || s.startsWith("guarding ")) return `${s.split(" ")[0]} a player`;
  return s;
}

export type StuckKind = "dry" | "no_bank" | "twice";

// `deep` is whether the head was under; only the water kinds read it
export function stuckWords(kind: StuckKind, status: string, deep = false): string {
  const act = activityWords(status);
  if (kind === "no_bank") return `in ${deep ? "deep water" : "the water"} while ${act}, no way out found`;
  if (kind === "twice") return `stuck in the water twice while ${act}, the way on crosses water`;
  return `no progress while ${act}`;
}
