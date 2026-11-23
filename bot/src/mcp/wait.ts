import type { BotEvent } from "../api/events";
import type { BodyClient } from "./client";

export type WakeReason = "task_ended" | "chat" | "died" | "no_food" | "disconnected" | "interrupted" | "reflex_ended" | "restarted" | "timeout";

const ENDS = ["task_finished", "task_failed", "task_stopped"];

// Why an event should wake a waiting mind, if it should. `died` and `disconnected` come from their own
// events only: the task_failed that precedes them ends the awaited task (reason=died in its line) but is
// not a second wake-up. interrupted has no event of its own, so it comes from task_failed.
export function wakeReason(e: BotEvent, taskId?: string): WakeReason | undefined {
  switch (e.event) {
    case "chat":
      return "chat";
    case "died":
      return "died";
    case "no_food":
      return "no_food";
    case "body_disconnected":
      return "disconnected";
    case "reflex_ended":
      return "reflex_ended";
  }
  if (e.event === "task_failed" && e.reason === "interrupted") return "interrupted";
  if (taskId && ENDS.includes(e.event) && e.taskId === taskId) return "task_ended";
  return undefined;
}

const endsTask = (e: BotEvent, taskId?: string) => taskId !== undefined && ENDS.includes(e.event) && e.taskId === taskId;

export interface Woke {
  reason: WakeReason;
  ended?: BotEvent; // the ending event of the awaited task, when there is one
}

// Returns at once if the awaited task already ended (even before the mind last looked) or something
// unseen is worth waking for; otherwise blocks until one arrives, the bot restarts, or the timeout.
export function waitForWake(client: BodyClient, taskId: string | undefined, timeoutMs: number): Promise<Woke> {
  const ended = client.find((e) => endsTask(e, taskId));
  if (ended) return Promise.resolve({ reason: wakeReason(ended, taskId) ?? "task_ended", ended });
  for (const e of client.eventsAfter(client.seen)) {
    const reason = wakeReason(e, taskId);
    if (reason) return Promise.resolve({ reason, ended: endsTask(e, taskId) ? e : undefined });
  }

  return new Promise((resolve) => {
    const finish = (w: Woke) => {
      clearTimeout(timer);
      off();
      offRestart();
      resolve(w);
    };
    const timer = setTimeout(() => finish({ reason: "timeout" }), timeoutMs);
    const off = client.onEvent((e) => {
      const reason = wakeReason(e, taskId);
      if (reason) finish({ reason, ended: endsTask(e, taskId) ? e : undefined });
    });
    const offRestart = client.onRestart(() => finish({ reason: "restarted" }));
  });
}
