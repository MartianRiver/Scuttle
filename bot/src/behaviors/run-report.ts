// What a task run has to show for itself: items gained, for the end events and the progress lines.
// Pure counting plus one run's state; the item counts are the only numbers that ever go out.
import type { Bot } from "mineflayer";

export type Counts = Record<string, number>;
export const GOT_LISTED = 4;

export function carried(bot: Bot): Counts {
  const out: Counts = {};
  for (const it of bot.inventory.items()) out[it.name] = (out[it.name] ?? 0) + it.count;
  return out;
}

// What was gained since `start`: what is held now and what was put in the stash, less what it started
// with, so a stashed log still counts and a log turned into planks does not. Net, not a tally of
// every pickup. Biggest first, at most `max` items.
export function gained(start: Counts, now: Counts, stashed: Counts, max = GOT_LISTED): Counts {
  const net: Counts = {};
  for (const name of new Set([...Object.keys(now), ...Object.keys(stashed)])) {
    const n = (now[name] ?? 0) + (stashed[name] ?? 0) - (start[name] ?? 0);
    if (n > 0) net[name] = n;
  }
  const top = Object.entries(net).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
  return Object.fromEntries(top);
}

let run: { start: Counts; stashed: Counts } | null = null;

export function beginRun(bot: Bot): void {
  run = { start: carried(bot), stashed: {} };
}

export function noteStashed(item: string, count: number): void {
  if (run && count > 0) run.stashed[item] = (run.stashed[item] ?? 0) + count;
}

export function gotNow(bot: Bot, max = GOT_LISTED): Counts | undefined {
  if (!run) return undefined;
  const got = gained(run.start, carried(bot), run.stashed, max);
  return Object.keys(got).length > 0 ? got : undefined;
}

export function endRun(): void {
  run = null;
}
