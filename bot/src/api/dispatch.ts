import { endFields, type EndInfo, type EventLog } from "./events";
import type { Observation } from "../senses/compose";
import { ACTION_INTENTS, type ActionIntent, type Intent, type TaskName } from "./protocol";

export type Got = Record<string, number>;
export interface TaskDone {
  got?: Got;
  stored?: Got; // a `store`: what went into the stash
  saw?: string; // an `explore`: kinds newly in view, in words
  detail?: string; // a `dig_down`, `tunnel` or short `collect`: where or why it ended, in words
}

// what a `recipe` answers: the first recipe that fits what it holds, else the simplest, in words
export interface RecipeAnswer {
  item: string;
  craftable?: false; // known, but no crafting recipe makes it
  makes?: number;
  needs?: Got;
  table?: boolean;
  have?: Got;
  missing?: Got;
}

// what a `stash` answers: what its own chests held when it last looked
export interface StashAnswer {
  items: Got;
  fresh: boolean;
  looked: string; // never, just now, minutes ago, a while ago
  unseen?: number; // chests it has never opened
}
export type Report = (p: { step: string; got?: Got }) => void;

// What the real bot (body.ts) or a test stub has to provide.
export interface BodyControl {
  inGame(): boolean;
  fighting(): boolean;
  danger(): boolean; // a reflex has the body: running from or fighting mobs, or getting out of a hazard
  dangerWhy?(): string | undefined; // that reflex in words (no digits), for the refusal
  busy(): boolean; // a task is still winding down after the dispatcher let go of it (stop)
  canSee(player: string): boolean;
  vitals(): { health: number | null; food: number | null };
  comeTo(player: string): Promise<void>; // resolves on arrival, rejects if cancelled or unreachable
  follow(player: string): void; // runs until stop or replaced
  // runs until stop or replaced, and carries on through reflexes; rejects "lost_ward" when the player is gone for good
  guard(player: string): Promise<void>;
  // walks to the player and throws the item at their feet; rejects "none_held" when it has none to spare
  give(player: string, item: string, count?: number): Promise<void>;
  // walks to what a handle points at; rejects "stale_handle" if it is gone by the time the walk starts or during it
  goTo(handle: string): Promise<void>;
  // the handle's words for the status text, or null when it is unknown, expired or points at nothing now
  handleLabel(handle: string): string | null;
  observe(): Observation; // what it can see, in words (senses/)
  // `near` is a block or place handle that moves the search centre; rejects "stale_handle" if it is gone by the start.
  // A failure's `detail` and `got` ride on the error; a finish may hand back `got`. `report` is for the progress lines.
  runTask(name: TaskName, near: string | undefined, report: Report): Promise<TaskDone | void>;
  // craft, collect, store, take, explore: run like a task. Failures carry `detail`, `got`, `missing` on the error
  runAction(a: ActionIntent, report: Report): Promise<TaskDone | void>;
  knowsItem(item: string): boolean; // an item the game has
  // null for an item the game does not have
  recipe(item: string): RecipeAnswer | null;
  stash(): StashAnswer;
  equip(item: string): boolean; // false: it holds none. The swap itself happens by itself, a moment later
  canExplore(dir: string, far: string | undefined): boolean; // false: the target is past the leash from home
  say(text: string): void; // one public chat line, already validated
  stop(): void; // the API's stop
  interrupt(): void; // the same cleanup, for the body's own reflexes taking over
}

export type Reject =
  | "busy"
  | "in_fight"
  | "in_danger"
  | "not_in_game"
  | "unknown_player"
  | "rate_limited"
  | "stale_handle"
  | "unknown_item"
  | "none_held"
  | "too_far";
export type Outcome =
  | { kind: "accepted"; taskId?: string }
  | { kind: "rejected"; reason: Reject; detail?: string }
  | { kind: "status"; snapshot: Snapshot }
  | { kind: "observation"; observation: Observation }
  | { kind: "recipe"; recipe: RecipeAnswer }
  | { kind: "stash"; stash: StashAnswer };

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

const isAction = (i: Intent): i is ActionIntent => (ACTION_INTENTS as readonly string[]).includes(i.intent);

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
  const settle = (c: Current, event: "task_finished" | "task_failed", reason?: string, info: EndInfo = {}) => {
    if (current?.taskId !== c.taskId) return;
    current = null;
    log.emit(event, { taskId: c.taskId, ...(reason && { reason }), ...endFields(info) });
  };

  const begin = (kind: string, isTask: boolean, run: Promise<TaskDone | void> | null, keepOnReflex = false): string => {
    const c: Current = { taskId: `t${++counter}`, kind, isTask, keepOnReflex };
    current = c;
    log.emit("task_started", { taskId: c.taskId, kind });
    run?.then(
      (done) => settle(c, "task_finished", undefined, done ?? {}),
      (err) => settle(c, "task_failed", (err as Error).message, err as EndInfo)
    );
    return c.taskId;
  };

  // progress lines belong to the task that is running; one from a stopped or replaced run is dropped
  const progress: Report = ({ step, got }) => {
    if (!current?.isTask) return;
    log.emit("task_progress", { taskId: current.taskId, step, ...endFields({ got }) });
  };

  const endCurrent = (event: "task_stopped" | "task_failed", reason?: string, detail?: string): string | undefined => {
    if (!current) return undefined;
    const { taskId } = current;
    current = null;
    log.emit(event, { taskId, ...(reason && { reason }), ...endFields({ detail }) });
    return taskId;
  };

  function handle(i: Intent): Outcome {
    if (i.intent === "status") return { kind: "status", snapshot: snapshot() };

    if (i.intent === "observe") {
      // read-only, like status: allowed mid-fight and in danger
      if (!body.inGame()) return { kind: "rejected", reason: "not_in_game" };
      return { kind: "observation", observation: body.observe() };
    }

    if (i.intent === "recipe") {
      if (!body.inGame()) return { kind: "rejected", reason: "not_in_game" };
      const recipe = body.recipe(i.item);
      return recipe ? { kind: "recipe", recipe } : { kind: "rejected", reason: "unknown_item" };
    }

    if (i.intent === "stash") {
      if (!body.inGame()) return { kind: "rejected", reason: "not_in_game" };
      return { kind: "stash", stash: body.stash() };
    }

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
    if (i.intent !== "guard" && body.danger()) {
      const { detail } = endFields({ detail: body.dangerWhy?.() });
      return { kind: "rejected", reason: "in_danger", ...(detail && { detail }) };
    }

    if (i.intent === "task") {
      if (current || body.busy()) return { kind: "rejected", reason: "busy" };
      if (i.near && !body.handleLabel(i.near)) return { kind: "rejected", reason: "stale_handle" };
      return { kind: "accepted", taskId: begin(i.intent + ":" + i.name, true, body.runTask(i.name, i.near, progress)) };
    }

    if (isAction(i)) {
      if (current || body.busy()) return { kind: "rejected", reason: "busy" };
      if ((i.intent === "craft" || i.intent === "take") && !body.knowsItem(i.item)) return { kind: "rejected", reason: "unknown_item" };
      if (i.intent === "collect" && !body.handleLabel(i.handle)) return { kind: "rejected", reason: "stale_handle" };
      if (i.intent === "explore" && !body.canExplore(i.dir, i.far)) return { kind: "rejected", reason: "too_far" };
      const what =
        i.intent === "collect" ? i.handle
        : i.intent === "explore" ? i.dir
        : i.intent === "store" ? (i.item ?? "all")
        : i.intent === "dig_down" ? (i.to ?? "stone")
        : i.intent === "tunnel" ? (i.dir ?? "ahead")
        : i.intent === "climb_up" ? "up"
        : i.item;
      return { kind: "accepted", taskId: begin(`${i.intent}:${what}`, true, body.runAction(i, progress)) };
    }

    if (i.intent === "equip") {
      // one swap, accepted at once like `say`; it is not a task, but it never lands in the middle of one
      if (current?.isTask || body.busy()) return { kind: "rejected", reason: "busy" };
      return body.equip(i.item) ? { kind: "accepted" } : { kind: "rejected", reason: "none_held" };
    }

    if (current?.isTask || body.busy()) return { kind: "rejected", reason: "busy" };
    if (i.intent === "go_to") {
      if (!body.handleLabel(i.handle)) return { kind: "rejected", reason: "stale_handle" };
      endCurrent("task_stopped"); // replaced by this one
      return { kind: "accepted", taskId: begin(`go_to:${i.handle}`, false, body.goTo(i.handle)) };
    }
    if (!body.canSee(i.player)) return { kind: "rejected", reason: "unknown_player" };
    endCurrent("task_stopped"); // replaced by this one
    if (i.intent === "follow") {
      body.follow(i.player);
      return { kind: "accepted", taskId: begin(`follow:${i.player}`, false, null) };
    }
    if (i.intent === "guard") return { kind: "accepted", taskId: begin(`guard:${i.player}`, false, body.guard(i.player), true) };
    if (i.intent === "give") return { kind: "accepted", taskId: begin(`give:${i.player}`, false, body.give(i.player, i.item, i.count)) };
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
    // a run of a reflex (mobs, a hazard) is over: `ok` false when it gave up. A mind refused in_danger waits on this
    reflexEnded(what: string, ok: boolean, detail?: string) {
      log.emit("reflex_ended", { what, ok, ...endFields({ detail }) });
    },
    // a reflex took the body: whatever was running ends with a typed reason
    interrupted(detail?: string) {
      body.interrupt();
      if (current?.keepOnReflex) return; // the guard resumes when the reflex lets go
      endCurrent("task_failed", "interrupted", detail);
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
