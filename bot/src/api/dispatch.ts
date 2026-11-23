import type { EventLog } from "./events";
import type { Intent, TaskName } from "./protocol";

// What the real bot (body.ts) or a test stub has to provide.
export interface BodyControl {
  inGame(): boolean;
  fighting(): boolean;
  danger(): boolean; // the defence reflex is running from hostile mobs
  busy(): boolean; // a task is still winding down after the dispatcher let go of it (stop)
  canSee(player: string): boolean;
  vitals(): { health: number | null; food: number | null };
  comeTo(player: string): Promise<void>; // resolves on arrival, rejects if cancelled or unreachable
  follow(player: string): void; // runs until stop or replaced
  // runs until stop or replaced, and carries on through reflexes; rejects "lost_ward" when the player is gone for good
  guard(player: string): Promise<void>;
  runTask(name: TaskName): Promise<void>;
  say(text: string): void; // one public chat line, already validated
  stop(): void; // the API's stop
  interrupt(): void; // the same cleanup, for the body's own reflexes taking over
}

export type Reject = "busy" | "in_fight" | "in_danger" | "not_in_game" | "unknown_player" | "rate_limited";
export type Outcome =
  | { kind: "accepted"; taskId?: string }
  | { kind: "rejected"; reason: Reject }
  | { kind: "status"; snapshot: Snapshot };

export interface Snapshot {
  inGame: boolean;
  task: string | null;
  taskId: string | null;
  health: number | null;
  food: number | null;
}

interface Current {
  taskId: string;
  kind: string;
  isTask: boolean;
  keepOnReflex?: boolean; // a reflex taking the body does not end it (guard)
}

// Owns "one action at a time" and turns each action's life into events.
export const SAY_GAP_MS = 2000;

export function createDispatcher(body: BodyControl, log: EventLog, now: () => number = Date.now) {
  let current: Current | null = null;
  let counter = 0;
  let lastSay = -Infinity;

  const snapshot = (): Snapshot => ({
    inGame: body.inGame(),
    task: current?.kind ?? null,
    taskId: current?.taskId ?? null,
    ...body.vitals(),
  });

  // late results from a stopped or replaced action are dropped here
  const settle = (c: Current, event: "task_finished" | "task_failed", reason?: string) => {
    if (current?.taskId !== c.taskId) return;
    current = null;
    log.emit(event, reason ? { taskId: c.taskId, reason } : { taskId: c.taskId });
  };

  const begin = (kind: string, isTask: boolean, run: Promise<void> | null, keepOnReflex = false): string => {
    const c: Current = { taskId: `t${++counter}`, kind, isTask, keepOnReflex };
    current = c;
    log.emit("task_started", { taskId: c.taskId, kind });
    run?.then(
      () => settle(c, "task_finished"),
      (err) => settle(c, "task_failed", (err as Error).message)
    );
    return c.taskId;
  };

  const endCurrent = (event: "task_stopped" | "task_failed", reason?: string): string | undefined => {
    if (!current) return undefined;
    const { taskId } = current;
    current = null;
    log.emit(event, reason ? { taskId, reason } : { taskId });
    return taskId;
  };

  function handle(i: Intent): Outcome {
    if (i.intent === "status") return { kind: "status", snapshot: snapshot() };

    if (i.intent === "stop") {
      body.stop();
      return { kind: "accepted", taskId: endCurrent("task_stopped") };
    }

    if (i.intent === "say") {
      // talking never touches the running action, even mid-fight
      if (!body.inGame()) return { kind: "rejected", reason: "not_in_game" };
      const t = now();
      if (t - lastSay < SAY_GAP_MS) return { kind: "rejected", reason: "rate_limited" };
      lastSay = t;
      body.say(i.text);
      return { kind: "accepted" };
    }

    if (!body.inGame()) return { kind: "rejected", reason: "not_in_game" };
    if (body.fighting()) return { kind: "rejected", reason: "in_fight" };
    // a guard order is exactly what gets typed when a player is in trouble, so mobs near the body don't refuse it
    if (i.intent !== "guard" && body.danger()) return { kind: "rejected", reason: "in_danger" };

    if (i.intent === "task") {
      if (current || body.busy()) return { kind: "rejected", reason: "busy" };
      return { kind: "accepted", taskId: begin(i.intent + ":" + i.name, true, body.runTask(i.name)) };
    }

    if (current?.isTask || body.busy()) return { kind: "rejected", reason: "busy" };
    if (!body.canSee(i.player)) return { kind: "rejected", reason: "unknown_player" };
    endCurrent("task_stopped"); // replaced by this one
    if (i.intent === "follow") {
      body.follow(i.player);
      return { kind: "accepted", taskId: begin(`follow:${i.player}`, false, null) };
    }
    if (i.intent === "guard") return { kind: "accepted", taskId: begin(`guard:${i.player}`, false, body.guard(i.player), true) };
    return { kind: "accepted", taskId: begin(`come_to:${i.player}`, false, body.comeTo(i.player)) };
  }

  return {
    handle,
    snapshot,
    bodyConnected() {
      log.emit("body_connected");
    },
    bodyDisconnected(reason: string) {
      endCurrent("task_failed", "disconnected");
      log.emit("body_disconnected", { reason });
    },
    // the death ends the action at once; the `died` event follows when its place and cause are known
    bodyDied() {
      body.interrupt();
      endCurrent("task_failed", "died");
    },
    died(place: string, cause: string) {
      log.emit("died", { place, cause });
    },
    // a reflex took the body: whatever was running ends with a typed reason
    interrupted() {
      body.interrupt();
      if (current?.keepOnReflex) return; // the guard resumes when the reflex lets go
      endCurrent("task_failed", "interrupted");
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
