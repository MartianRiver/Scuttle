import { COMPASS_POINTS, EXPLORE_BANDS, TASKS, type TaskName } from "../api/protocol";

// What the mind is told it can do, kept by hand next to the API. test/mcp-skills.test.ts fails when
// a task in TASKS has no entry here. To add an action: one entry in ACTIONS, its argument names in
// ActArgs and WIRE, and the `act` schema in tools.ts.

export interface ActArgs {
  player?: string;
  item?: string;
  count?: number;
  task?: string;
  handle?: string;
  near?: string;
  dir?: string;
  far?: string;
  to?: string;
}

// where each act argument goes on the wire
const WIRE: Record<keyof ActArgs, string> = { player: "player", item: "item", count: "count", task: "name", handle: "handle", near: "near", dir: "dir", far: "far", to: "to" };

export interface ActionDef {
  does: string;
  required: (keyof ActArgs)[];
  optional: (keyof ActArgs)[];
  rejects: string[]; // the reasons it can be refused with, hints in REJECTS
  ends: string;
}

const MOVE_REJECTS = ["busy", "in_fight", "in_danger", "not_in_game", "unknown_player"];
const ACT_REJECTS = ["busy", "in_fight", "in_danger", "not_in_game"];

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
    does: "Walk to what a handle from observe points at (a mob, a player, a block), or to a place by name: home, table, stash, furnace, bed, and stair (the one dug with dig_down, once there is one).",
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
    does: "Start one of the named tasks (see tasks). It runs on its own for a while: mines, crafts, smelts, stashes at home. near (optional) is a handle of a block from observe (a tree) or a place (home, table, stash, furnace, bed): the search then centres there, with the same radius; crafting, stashing and smelting still happen at home, and the body still never digs under or beside what players built. Refused places are not valid targets (they have no handle). While it runs it sends task_progress lines (step, got).",
    required: ["task"],
    optional: ["near"],
    rejects: ["busy", "in_fight", "in_danger", "not_in_game", "stale_handle"],
    ends: "task_finished (got= what it gained, counting what it stashed), or task_failed with a reason from that task's list, a detail= in words about why (e.g. three digs undone near the trees, a fair way south-west) and got= what it had gathered before. Anything running makes a task busy: stop first.",
  },
  craft: {
    does: "Craft an item from the recipes the server has: count is how many you want made (default 1, max 64; the body rounds up to whole batches). Made in the inventory when the recipe fits a 2x2 grid, otherwise at a crafting table: one in reach or within about 16 blocks, else the home table. It does not make ingredients for you: planks come from logs (craft oak_planks), sticks from planks (craft stick), a pickaxe from planks and sticks; chain them yourself. Use the recipe tool first to see what an item takes.",
    required: ["item"],
    optional: ["count"],
    rejects: [...ACT_REJECTS, "unknown_item"],
    ends: "task_finished with got= what it made; task_failed missing (missing= what it lacks, in total for the count), no_table (no table in reach and none at home), no_recipe (nothing crafts it: mined, found or smelted), craft_failed, stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  collect: {
    does: "Dig the block a handle from observe points at, with the right tool from its inventory, and pick up the drops. A tree handle (the base log) takes that tree's logs within reach; a stone or ore handle takes that block, or up to count (default 1, max 16) of the same kind touching it. Natural blocks only (logs, stone, ores, dirt, sand, gravel), never under or beside what a player built, never where the server undid its digs. Aiming it: observe lists trees, ores and the nearest stone with handles.",
    required: ["handle"],
    optional: ["count"],
    rejects: [...ACT_REJECTS, "stale_handle"],
    ends: "task_finished with got= what it picked up; task_failed no_tool (detail says which pickaxe it needs), refused (not a natural block, a player's build too near, or a place where digs were undone; detail says which), protected (the server undid the dig), stale_handle (the block is gone), stuck (no way to reach it), interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  equip: {
    does: "Put an item it carries on: armour goes to its slot, a shield to the off hand, anything else into the hand. One swap, taken at once.",
    required: ["item"],
    optional: [],
    rejects: [...ACT_REJECTS, "none_held"],
    ends: "Accepted with no taskId; the swap happens a moment later (observe held and armor show it). Rejected none_held if it carries none. Refused busy while a task or action runs, since those choose their own tools.",
  },
  store: {
    does: "Walk to its own stash chests at home and put items in. With item (and optionally count) it stores that. With no item it stores everything except tools, weapons and armour it carries, food up to 16, and 4 cobblestone and 4 coal. Only its own stash, never anyone else's chest.",
    required: [],
    optional: ["item", "count"],
    rejects: ACT_REJECTS,
    ends: "task_finished with stored= what went in; task_failed none_held (nothing to spare), stash_full (no room), no_stash (not in the overworld, or no chest where expected), stuck, interrupted, died, disconnected. Like a task: busy while anything runs. The stash tool lists what the chests held when last seen.",
  },
  take: {
    does: "Walk to its own stash chests and take an item out: up to count (default a stack, max 64). Opens the chests that may hold it.",
    required: ["item"],
    optional: ["count"],
    rejects: [...ACT_REJECTS, "unknown_item"],
    ends: "task_finished with got= what it took (it may be less than asked); task_failed none_stashed (none of it in its chests), inventory_full, no_stash, stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  explore: {
    does: `Walk in a compass direction (${COMPASS_POINTS.join(", ")}) for a distance band far (${EXPLORE_BANDS.join(", ")}; default a short walk: near ends about 8 to 16 blocks away, a short walk 16 to 32, a fair way 32 to 48, far 48 to 128), from where it stands, never past 160 blocks from home. It goes round water and cliffs when it can. Use it when nothing useful is in view.`,
    required: ["dir"],
    optional: ["far"],
    rejects: [...ACT_REJECTS, "too_far"],
    ends: "task_finished with saw= kinds newly in view on the way, in words (trees, stone, iron ore, water, lava, doors, players; no handles: call observe next); task_failed blocked or stuck with detail= what is in the way (a cliff to the north, the sea to the east), interrupted, died, disconnected. Rejected too_far at once if the end point would be past the leash from home. Like a task: busy while anything runs.",
  },
  dig_down: {
    does: "Cut a one-block-wide staircase down from where it stands, toward natural stone (to: stone, the only target and the default), facing whichever way is clear. It stops on stone, at most twelve steps down, and remembers the stair. observe then lists that stair among the places (go_to stair walks to its top, climb_up goes there) and the stone it stopped at as a block with a handle, so collect or get_stone can take it. Refuses at once on or beside anything a player built, in a place where digs were undone, or with water or lava beside the way; stops before sand or gravel overhead. Never digs where it would let water or lava in.",
    required: [],
    optional: ["to"],
    rejects: ACT_REJECTS,
    ends: "task_finished with detail= where it stopped (stone ahead, a few blocks down); task_progress digging down, N steps in words; task_failed refused or blocked with detail= why, protected (the server undid a dig), stuck (no stone within twelve steps, or could not step down), interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  climb_up: {
    does: "Walk back up the stair dig_down cut, to the cell it started from.",
    required: [],
    optional: [],
    rejects: ACT_REJECTS,
    ends: "task_finished at the top; task_failed no_stair (it has dug none), stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
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
  in_danger: "a reflex has the body (mobs close, or a hazard like deep water, lava or fire); detail says which. Only stop, status and guard are taken. Wait for it: wait wakes on a reflex_ended event",
  not_in_game: "the body is not connected to the game server",
  unknown_item: "the game has no item by that name (lowercase_with_underscores, no namespace, like oak_planks)",
  none_held: "it does not carry that item",
  too_far: "the end point would be more than 160 blocks from home",
  stale_handle: "the body no longer has that handle (expired after 10 min unseen, from before a restart, the mob is gone, the block was mined); observe again for fresh ones",
  unknown_player: "that player is not in the body's loaded view (name wrong, offline or far away)",
  rate_limited: "too many requests (10 per 10 s) or more than one chat line per 2 s; slow down",
  bad_intent: "the body refused the request as malformed (player: 1 to 17 of letters digits _ . ; item: lowercase_with_underscores; handle: from observe or a place name; near: a block handle or a place name, not a mob)",
  bad_args: "wrong or missing arguments for that action",
  api_offline: "the adapter has no connection to the body API; it keeps retrying",
  no_reply: "the request went out but no answer came; check status before repeating it",
};

const COMMON_FAILS = {
  stuck: "a walk made no progress, even after nudges (detail says what it was doing, and whether it was in water)",
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
    fails: {
      no_trees: "no trees it may cut in range (detail says if every tree left is in a place where its digs were undone)",
      protected: "the server undid the digs (a protected area); the places are remembered for 30 minutes and shown in observe refused, so aim near a tree elsewhere or somewhere else",
      ...COMMON_FAILS,
    },
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
    other: {
      say: "say(text): one public chat line, up to 100 printable ASCII characters, one per 2 s.",
      recipe: "recipe(item): what crafting an item takes, answered at once: makes, needs, whether it needs a table, what it holds of that (have) and what is missing for one craft. A named kind of planks or logs fits only what it holds; with none it says planks for any wood.",
      stash: "stash(): what its own stash chests held when it last looked, counts per item, fresh (every chest looked at within 10 minutes), looked (just now, minutes ago, a while ago, never), unseen (chests it never opened). Answered from memory at once.",
      reasons: REJECTS,
    },
    not_possible: "Anything not listed. There are no coordinates, commands or free movement. If you need something that is not here, say so in your own notes as a skill request instead of retrying.",
  };
}
