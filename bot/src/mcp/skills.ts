import { TASKS, type TaskName } from "../api/protocol";

// What the mind is told it can do, kept by hand next to the API. test/mcp-skills.test.ts fails when
// a task in TASKS has no entry here. To add an action: one entry in ACTIONS, its argument names in
// ActArgs and WIRE, and the `act` schema in tools.ts.

export interface ActArgs {
  player?: string;
  item?: string;
  count?: number;
  task?: string;
  handle?: string;
}

// where each act argument goes on the wire
const WIRE: Record<keyof ActArgs, string> = { player: "player", item: "item", count: "count", task: "name", handle: "handle" };

export interface ActionDef {
  does: string;
  required: (keyof ActArgs)[];
  optional: (keyof ActArgs)[];
  rejects: string[]; // the reasons it can be refused with, hints in REJECTS
  ends: string;
}

const MOVE_REJECTS = ["busy", "in_fight", "in_danger", "not_in_game", "unknown_player"];

export const ACTIONS: Record<string, ActionDef> = {
  come_to: {
    does: "Walk to a player and stop beside them.",
    required: ["player"],
    optional: [],
    rejects: MOVE_REJECTS,
    ends: "task_finished on arrival; task_failed stuck, interrupted, died, disconnected. Replaces a running come_to, follow, guard, give or go_to.",
  },
  follow: {
    does: "Keep walking after a player until told otherwise.",
    required: ["player"],
    optional: [],
    rejects: MOVE_REJECTS,
    ends: "Never finishes on its own. Ends with stop, a newer come_to/follow/guard/give/go_to (task_stopped), or task_failed interrupted, died, disconnected.",
  },
  guard: {
    does: "Follow a player like follow and fight hostile mobs near them (within 10 blocks of the player). Says a fixed line in chat per mob.",
    required: ["player"],
    optional: [],
    rejects: ["busy", "in_fight", "not_in_game", "unknown_player"],
    ends: "Never finishes on its own. Ends with stop, a newer order, task_failed lost_ward (player out of view or over 48 blocks for 15 s), died, disconnected. Reflexes (fleeing, fighting) pause it without ending it. Accepted even when mobs are near.",
  },
  go_to: {
    does: "Walk to what a handle from observe points at (a mob, a player, a block), or to a place by name: home, table, stash, furnace, bed.",
    required: ["handle"],
    optional: [],
    rejects: ["busy", "in_fight", "in_danger", "not_in_game", "stale_handle"],
    ends: "task_finished within about 2 blocks of a block or place (home 4) or 3 of a mob or player, which it re-walks as they move; task_failed stale_handle (the mob went away mid-walk), stuck, interrupted, died. At most 90 s. Replaces a running come_to, follow, guard, give or go_to.",
  },
  give: {
    does: "Walk to a player and throw items at their feet, one stack at a time, up to count (default everything held, max 64). Never throws a held tool, weapon or shield.",
    required: ["player", "item"],
    optional: ["count"],
    rejects: MOVE_REJECTS,
    ends: "task_finished once everything is thrown (the player still has to pick it up); task_failed none_held, stuck, interrupted, died, disconnected. Replaces a running come_to, follow, guard, give or go_to.",
  },
  task: {
    does: "Start one of the named tasks (see tasks). It runs on its own for a while: mines, crafts, smelts, stashes at home.",
    required: ["task"],
    optional: [],
    rejects: ["busy", "in_fight", "in_danger", "not_in_game"],
    ends: "task_finished, or task_failed with a reason from that task's list. Anything running makes a task busy: stop first.",
  },
  stop: {
    does: "Stop whatever the body is doing, at once. Always accepted. Returns the taskId of what was stopped, if anything.",
    required: [],
    optional: [],
    rejects: [],
    ends: "The stopped action ends with task_stopped. If hostile mobs are still near the body fights or flees again after a moment.",
  },
};

export const REJECTS: Record<string, string> = {
  busy: "a task is running, or the body is still winding one down; stop first, or wait",
  in_fight: "the body is in a fight; only stop and status are taken",
  in_danger: "hostile mobs are on the body; only stop, status and guard are taken",
  not_in_game: "the body is not connected to the game server",
  stale_handle: "the body no longer has that handle (expired after 10 min unseen, from before a restart, the mob is gone, the block was mined); observe again for fresh ones",
  unknown_player: "that player is not in the body's loaded view (name wrong, offline or far away)",
  rate_limited: "too many requests (10 per 10 s) or more than one chat line per 2 s; slow down",
  bad_intent: "the body refused the request as malformed (player: 1 to 17 of letters digits _ . ; item: lowercase_with_underscores)",
  bad_args: "wrong or missing arguments for that action",
  api_offline: "the adapter has no connection to the body API; it keeps retrying",
  no_reply: "the request went out but no answer came; check status before repeating it",
};

const COMMON_FAILS = {
  stuck: "a walk made no progress, even after nudges",
  interrupted: "hostile mobs, a hazard or a fall took the body",
  died: "the body died",
  disconnected: "the body lost its connection to the game",
};

export interface TaskDef {
  does: string;
  needs: string;
  fails: Record<string, string>;
}

export const TASK_SKILLS: Record<TaskName, TaskDef> = {
  get_wood: {
    does: "Chops trees near home, crafts a wooden pickaxe and axe at the home crafting table, stashes the surplus logs in the home chest.",
    needs: "nothing",
    fails: { no_trees: "no trees it may cut", protected: "the server undid the digs (a protected area)", ...COMMON_FAILS },
  },
  get_stone: {
    does: "Mines natural stone near home (not under or beside anything a player built) until it holds 16 more cobblestone, makes a stone pickaxe and sword if it has none, keeps 4 cobblestone and stashes the rest.",
    needs: "any pickaxe in the inventory",
    fails: {
      no_pickaxe: "no pickaxe held; run get_wood first",
      no_stone: "no natural stone it may dig within 40 blocks of home above y 30",
      protected: "the server undid the digs",
      ...COMMON_FAILS,
    },
  },
  get_iron: {
    does: "Mines coal (8) then iron ore that has a face in the open (surface outcrops, cave walls), smelts it at a home furnace, makes an iron pickaxe and sword, stashes the rest. Does nothing if it already has both iron tools.",
    needs: "a stone pickaxe or better; run get_stone first",
    fails: {
      no_pickaxe: "no stone-level or better pickaxe held",
      no_ore: "no iron ore in the open within 64 blocks of home, or none it could take",
      no_fuel: "no coal to smelt on",
      smelt_failed: "no furnace it may use, or no ingot came out",
      protected: "the server undid the digs",
      ...COMMON_FAILS,
    },
  },
};

export type Built = { ok: true; fields: Record<string, unknown> } | { ok: false; detail: string };

// act arguments to the wire intent (without type and id); no field outside the action's list gets through
export function buildIntent(action: string, args: ActArgs): Built {
  const def = ACTIONS[action];
  if (!def) return { ok: false, detail: `unknown action ${action}; one of ${Object.keys(ACTIONS).join(", ")}` };
  const allowed = [...def.required, ...def.optional];
  for (const k of Object.keys(WIRE) as (keyof ActArgs)[]) {
    if (args[k] !== undefined && !allowed.includes(k)) {
      return { ok: false, detail: `${action} takes ${allowed.length ? allowed.join(", ") : "no arguments"}, not ${k}` };
    }
  }
  for (const k of def.required) if (args[k] === undefined) return { ok: false, detail: `${action} needs ${k}` };
  if (action === "task" && !(TASKS as readonly string[]).includes(args.task ?? "")) {
    return { ok: false, detail: `task must be one of ${TASKS.join(", ")}` };
  }
  const fields: Record<string, unknown> = { intent: action };
  for (const k of allowed) if (args[k] !== undefined) fields[WIRE[k]] = args[k];
  return { ok: true, fields };
}

export function skillsTable() {
  const tasks = Object.fromEntries(Object.entries(TASK_SKILLS).map(([n, t]) => [n, t]));
  const actions = Object.fromEntries(
    Object.entries(ACTIONS).map(([n, a]) => [
      n,
      {
        does: a.does,
        args: [...a.required, ...a.optional.map((k) => `${k}?`)],
        refused_with: Object.fromEntries(a.rejects.map((r) => [r, REJECTS[r]])),
        ends: a.ends,
      },
    ])
  );
  return {
    tasks,
    actions,
    other: { say: "say(text): one public chat line, up to 100 printable ASCII characters, one per 2 s.", reasons: REJECTS },
    not_possible: "Anything not listed. There are no coordinates, commands or free movement. If you need something that is not here, say so in your own notes as a skill request instead of retrying.",
  };
}
