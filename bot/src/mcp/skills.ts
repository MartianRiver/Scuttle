import { COMPASS_POINTS, EXPLORE_BANDS, TASKS, type TaskName } from "../api/protocol";
import { CLEAR_DEFAULT, CLEAR_MAX, CLEAR_MIN } from "../behaviors/clear-plan";
import { CARDINALS, isLengthBand, TUNNEL_DEFAULT, TUNNEL_MAX } from "../behaviors/tunnel-plan";

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
  to?: string | number;
  length?: number | string;
  through?: boolean;
  torches?: boolean;
  x?: number;
  y?: number;
  z?: number;
  radius?: number;
  where?: string;
  chest?: string;
}

// where each act argument goes on the wire
const WIRE: Record<keyof ActArgs, string> = {
  player: "player", item: "item", count: "count", task: "name", handle: "handle", near: "near", dir: "dir", far: "far", to: "to", length: "length", through: "through", torches: "torches", radius: "radius", x: "x", y: "y", z: "z", where: "where", chest: "chest",
};

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
    does: "Walk to what a handle from observe points at (a mob, a player, a block), or to a place by name: home, table, stash, furnace, bed, and stair (the one dug with dig_down or tunnel, once there is one), or to a cell: x, y and z, the same numbers as pos in observe (the cell the feet are in). Give a handle or the three numbers, never both. A cell is how you stand at a branch point along your own tunnel (a point a few blocks back from where you are). On foot only, always: it never digs and never sets a block down, so a cell behind rock it would have to dig through is stuck.",
    required: [],
    optional: ["handle", "x", "y", "z"],
    rejects: ["busy", "in_fight", "in_danger", "not_in_game", "stale_handle"],
    ends: "task_finished within about 2 blocks of a block, a place (home 4) or a cell, or 3 of a mob or player, which it re-walks as they move; task_failed stale_handle (the mob went away mid-walk), refused (a cell where its digs were undone or beside something a player built; detail says which, and it does not go there), stuck (no way there on foot, the cell is too far to see, or it ran out of time), interrupted, died. At most 90 s. Replaces a running come_to, follow, guard, give or go_to.",
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
    does: "Craft an item from the recipes the server has: count is how many you want made (default 1, max 64; the body rounds up to whole batches). Made in the inventory when the recipe fits a 2x2 grid, otherwise at a crafting table: one in reach or within about 16 blocks; failing that, one it carries (it sets it down beside itself, crafts, and picks it up again; only where placing is on); failing that, the table at its base. It does not make ingredients for you: planks come from logs (craft oak_planks), sticks from planks (craft stick), a pickaxe from planks and sticks; chain them yourself. Use the recipe tool first to see what an item takes.",
    required: ["item"],
    optional: ["count"],
    rejects: [...ACT_REJECTS, "unknown_item"],
    ends: "task_finished with got= what it made; task_failed missing (missing= what it lacks, in total for the count), no_table (no table in reach, none carried to set down, and none at its base), refused or protected (a carried table had nowhere it may be set down: detail says why), no_recipe (nothing crafts it: mined, found or smelted), craft_failed, stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  collect: {
    does: "Dig the block a handle from observe points at, with the right tool from its inventory, and pick up the drops. A tree handle (the base log) takes that tree's logs within reach; a stone or ore handle takes that block, or up to count (default 1, max 16) of the same kind touching it. Natural blocks only (logs, stone, ores, dirt, sand, gravel), never under or beside what a player built, never where the server undid its digs. Aiming it: observe lists trees, ores and the nearest stone with handles.",
    required: ["handle"],
    optional: ["count"],
    rejects: [...ACT_REJECTS, "stale_handle"],
    ends: "task_finished with got= what it picked up, and detail= why when it got fewer than count (no more in reach, the rest is under a build, the rest is where digs are undone); task_failed no_tool (detail says which pickaxe it needs), refused (not a natural block, a player's build too near, or a place where digs were undone; detail says which), protected (the server undid the dig), stale_handle (the block is gone), stuck (no way to reach it), interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  equip: {
    does: "Put an item it carries on: armour goes to its slot, a shield to the off hand, anything else into the hand. One swap, taken at once.",
    required: ["item"],
    optional: [],
    rejects: [...ACT_REJECTS, "none_held"],
    ends: "Accepted with no taskId; the swap happens a moment later (observe held and armor show it). Rejected none_held if it carries none. Refused busy while a task or action runs, since those choose their own tools.",
  },
  store: {
    does: "Walk to one of its own chests and put items in: a chest it set down itself (place chest) or the stash chests at its base, never anyone else's. chest (optional) is a handle from observe of one of those (your chest in blocks) or the place stash; without it, a chest of its own within about 16 blocks, else the base's stash. With item (and optionally count) it stores that. With no item it stores everything except tools, weapons and armour it carries, food up to 16, and 4 cobblestone and 4 coal.",
    required: [],
    optional: ["item", "count", "chest"],
    rejects: [...ACT_REJECTS, "stale_handle"],
    ends: "task_finished with stored= what went in; task_failed none_held (nothing to spare), stash_full (no room), no_stash (not in the overworld, or no chest where expected), not_yours (the chest handle is a chest that is not its own), stuck, interrupted, died, disconnected. Like a task: busy while anything runs. The stash tool lists what its chests held when last seen.",
  },
  take: {
    does: "Walk to its own chests and take an item out: up to count (default a stack, max 64). chest (optional) names one of its own chests as store does; without it, it opens the chests that may hold it: its own nearby ones first, then the base's stash.",
    required: ["item"],
    optional: ["count", "chest"],
    rejects: [...ACT_REJECTS, "unknown_item", "stale_handle"],
    ends: "task_finished with got= what it took (it may be less than asked); task_failed none_stashed (none of it in its chests), inventory_full, no_stash, not_yours (the chest is not its own), stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  explore: {
    does: `Walk in a compass direction (${COMPASS_POINTS.join(", ")}) for a distance band far (${EXPLORE_BANDS.join(", ")}; default a short walk: near ends about 8 to 16 blocks away, a short walk 16 to 32, a fair way 32 to 48, far 48 to 128), from where it stands, never past 160 blocks from home. It goes round water and cliffs when it can. Use it when nothing useful is in view.`,
    required: ["dir"],
    optional: ["far"],
    rejects: [...ACT_REJECTS, "too_far"],
    ends: "task_finished with saw= kinds newly in view on the way, in words (trees, stone, iron ore, water, lava, doors, players; no handles: call observe next); task_failed blocked or stuck with detail= what is in the way (a cliff to the north, the sea to the east), interrupted, died, disconnected. Rejected too_far at once if the end point would be past the leash from home. Like a task: busy while anything runs.",
  },
  place: {
    does: "Set a block it carries down, as a player does. item: crafting_table, furnace, chest, torch, any bed, or dirt, cobblestone, cobbled_deepslate, netherrack (scaffolding); nothing else, and never a fluid, fire, TNT, sign or redstone. where is a word, never a position: here (default: on the ground beside it), ahead (the cell in front of it), wall (a torch on a wall within reach) or on <handle> (on top of that block: on b17kq, or on table). The body chooses the exact cell: free, with something solid to set it on, nobody standing there, and not near anything a player built or where the server undid its work. A bed takes two cells in line away from it. What it sets down is its own: observe then lists it in blocks as your crafting table, your chest, your furnace or your bed, with a handle, so go_to, pick_up, store and take can use it. A crafting table and a furnace it carries are also set down for it by craft and by a smelt when none is near.",
    required: ["item"],
    optional: ["where"],
    rejects: [...ACT_REJECTS, "unknown_item", "stale_handle", "not_enabled"],
    ends: "task_finished with detail= what and where in words (a crafting table beside it); task_failed none_held (it carries none), not_allowed (not on the list of what it sets down), no_room (no free ground, wall or top within reach; detail says which), refused (something a player built is too close; detail says so, try somewhere else), protected (the server undid it, so it may not build near there; that place is remembered), stale_handle, stuck, interrupted, died, disconnected. Like a task: busy while anything runs. not_enabled: placing is switched off in this world.",
  },
  pick_up: {
    does: "Break a block it set down itself and take it back into its pack: handle is a block handle from observe (your crafting table, your furnace, your chest, your bed, a torch) or a place name (table, furnace, stash, bed) that points at one. It never takes up anything it did not place, and never a block that has been replaced with a different kind since. A chest or furnace with things in it is refused so they do not spill: empty it first. A furnace needs a pickaxe.",
    required: ["handle"],
    optional: [],
    rejects: [...ACT_REJECTS, "stale_handle", "not_enabled"],
    ends: "task_finished with got= the block back in its pack and detail=; task_failed not_yours (it did not place that, or not that block), not_empty (it still holds things), no_tool (a furnace needs a pickaxe), stale_handle (the block is gone), refused or protected (the gate or the server said no), stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  make_base: {
    does: "Make where it stands its base: home for everything it does from now on (get_wood, get_stone and get_iron walk back to its table, chest and furnace here; it sleeps in its bed here; the leash for explore is measured from here; observe shows it as home, your base). It needs its own bed, crafting table and a chest set down (place) within a few blocks of where it stands, and refuses on a place where the server undid its work or beside what a player built. A furnace of its own near them is added. It keeps the base across restarts. Without making one, home stays the fixed place it began at.",
    required: [],
    optional: [],
    rejects: [...ACT_REJECTS, "not_enabled"],
    ends: "task_finished with detail= this is its base now; task_failed not_ready (detail names what it lacks: a bed, a crafting table, a chest within a few blocks), refused (something a player built is too close, or not in the overworld), protected (a place where its digs were undone), interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  dig_down: {
    does: "Cut a one-block-wide staircase down from where it stands, facing whichever way is clear. to: stone (the default) stops on natural stone, at most twelve steps down. to: a y (a whole number, like -50) digs on through stone, deepslate and whatever else it may dig, with the pickaxe the rock needs, to the step at that y: at most sixty-four steps a call, so a long way down is two calls in a row from the foot of the stair (the second goes on the same way, and the stair is remembered as one). A y above where it stands is refused, and so is one below the bottom of the world. torches: true sets a torch on the wall every eight blocks of the way (and one at the start when it is dark there), from the torches it carries; it never runs short silently (see ends). It remembers the stair: observe lists it among the places (go_to stair walks to its top, climb_up goes there over its whole length) and the stone it stopped at as a block with a handle, so collect or get_stone can take it; tunnel then digs sideways from its foot. Refuses at once on or beside anything a player built, in a place where digs were undone, or with water or lava beside the way; stops before sand or gravel overhead, a hollow below, a cave opened into, water or lava. Never digs where it would let water or lava in. It stops with pack full rather than dig on into drops it has no room for.",
    required: [],
    optional: ["to", "torches"],
    rejects: [...ACT_REJECTS, "no_torches"],
    ends: "task_finished with detail= where it stopped (stone ahead, a few blocks down; at the depth asked; pack full: go back to your chest and store, then call again), and when torches ran out on the way, out of torches six blocks back; task_progress digging down, N steps in words; task_failed refused or blocked with detail= why (a build, bedrock is in the way, below the bottom of the world, sand or gravel overhead, a cave opens ahead, water or lava below), no_tool (detail says the pickaxe the rock needs), protected (the server undid a dig), stuck (no stone within twelve steps, no further within sixty-four steps, or could not step down), interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  tunnel: {
    does: `Dig a branch mine as a player does: a tunnel one block wide and two high at the level of its feet, in a compass direction (dir: ${CARDINALS.join(", ")}; default the way the stair it stands at the foot of faces, else the way it faces), up to length blocks (a count to ${TUNNEL_MAX}, or ${EXPLORE_BANDS.join(", ")}; default ${TUNNEL_DEFAULT}), walking in as it digs. It needs a pickaxe for stone. It looks at the walls as they open: it stops at the first ore it sees (coal, iron, copper, gold, redstone, lapis, diamond, emerald), so you can observe (the ore is listed with a handle) and collect it with the right pickaxe; call tunnel again to go on, or pass through: true to dig on past ore and have the kinds listed at the end. It takes what it digs (cobblestone, dirt). The tunnel is remembered with the stair: observe lists it among the places as the stair (go_to stair or climb_up walks back to its top, tunnel and stair). Refuses at once on or beside anything a player built, in a place where digs were undone; stops before water or lava (it never breaks into them), a drop or hole ahead, or sand or gravel overhead. torches: true sets a torch on the wall every eight blocks of tunnel (and one at the start when it is dark there), from the torches it carries. It stops with pack full rather than dig on into drops it has no room for. Branches: go_to a cell back along your own tunnel (x, y, z; pos in observe is where you are now), then tunnel with a dir across it.`,
    required: [],
    optional: ["dir", "length", "through", "torches"],
    rejects: [...ACT_REJECTS, "no_torches"],
    ends: "task_finished with detail= why it stopped (ran out of length, iron ore in the wall, or pack full: go back to your chest and store, then call again), plus out of torches six blocks back when they ran out on the way, and got= what it dug up; with through, saw= the ore it passed (two coal ore, iron ore). task_progress tunnelling, six blocks (in words). task_failed blocked (detail: water ahead, lava behind the wall, a drop ahead, sand or gravel overhead, rock it cannot break), refused (a build in the way or too close, or digs undone there), no_tool (detail says the pickaxe it lacks), protected (the server undid a dig), stuck, interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  clear_trees: {
    does: `Clear a building site of trees: fell every natural tree whose trunk stands inside a square around the base's crafting table (radius: ${CLEAR_MIN} to ${CLEAR_MAX}, default ${CLEAR_DEFAULT}, the half-width, so nineteen across by default), nearest first, and leave every tree outside it standing, however far its leaves reach in. It keeps the wood: after each tree it walks to what dropped (logs, saplings, apples, sticks) inside the square and a few blocks past it, takes down the felled tree's natural leaves it can reach from the ground, and at the end breaks the small plants on the ground inside the square (flowers of every kind, mushrooms, saplings, berry bushes) so a block can be set down there. It stashes logs, sticks, spare saplings and apples in the base chests when its pack is nearly full, and keeps a few saplings and food. A tree is a plain log with natural leaves near it: a post, a stripped trunk or a trunk under placed leaves is no tree and stays. It takes the dig rules as they are: nothing near something a player built, nothing where digs were undone. A very tall trunk keeps the logs above its reach (told in the end). Stops by itself about twenty minutes in.`,
    required: [],
    optional: ["radius"],
    rejects: ACT_REJECTS,
    ends: "task_finished with got= the net items (a kind of log, then saplings, apples and sticks before other things) and detail= trees felled, plants cleared, what was left and why (at the edge, not natural, refused, out of reach, tall ones with tops left), why it stopped early if it did, and the time in words. task_progress says what it is doing (clearing trees, taking down the leaves, picking up what dropped, clearing the ground, stashing items). task_failed no_trees (detail: none in the square, only edge trees, or only logs that are no tree), refused (every tree has something a player built near it), protected (the server undid digs), stuck (the trees would not come down), too_far (the body is over 160 blocks from its base), inventory_full (pack full and nothing it could stash, no room in the stash, or the base too far to walk back), interrupted, died, disconnected. Like a task: busy while anything runs.",
  },
  climb_up: {
    does: "Walk back up the stair dig_down cut, to the cell it started from; after a tunnel, back along it and up the stair.",
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
  in_danger: "a reflex has the body (mobs close, or a hazard like deep water, lava or fire); detail says which. Only stop, status and guard are taken. Wait for it: wait wakes on reflex_started, hurt (what hurt it, in words), starving and reflex_ended; a reflex that finds itself cornered says so (cornered, fighting a zombie / no way to get clear)",
  not_in_game: "the body is not connected to the game server",
  unknown_item: "the game has no item by that name (lowercase_with_underscores, no namespace, like oak_planks)",
  none_held: "it does not carry that item",
  not_enabled: "placing is switched off in this world: place, pick_up and make_base are not taken here",
  no_torches: "torches: true was asked and it carries none; craft or take some (a torch is coal or charcoal on a stick), or leave torches off",
  too_far: "the end point would be more than 160 blocks from home",
  stale_handle: "the body no longer has that handle (expired after 10 min unseen, from before a restart, the mob is gone, the block was mined); observe again for fresh ones",
  unknown_player: "that player is not in the body's loaded view (name wrong, offline or far away)",
  rate_limited: "too many requests (10 per 10 s) or chat too fast (one line per 2 s, 12 a minute, guard callouts included); slow down",
  bad_intent: "the body refused the request as malformed (player: 1 to 17 of letters digits _ . ; item: lowercase_with_underscores; handle: from observe or a place name; near: a block handle or a place name, not a mob; where: here, ahead, wall or on <handle>)",
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
      no_trees: "no trees it may cut in range (detail says if every tree left is in a place where its digs were undone, or has something a player built beside it)",
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
  if (action === "go_to") {
    const point = [args.x, args.y, args.z].filter((v) => v !== undefined).length;
    if (args.handle !== undefined && point > 0) return { ok: false, detail: "go_to takes a handle or x, y and z, not both" };
    if (args.handle === undefined && point !== 3) return { ok: false, detail: "go_to needs a handle, or all of x, y and z" };
    if (point === 3 && ![args.x, args.y, args.z].every((v) => Number.isInteger(v))) return { ok: false, detail: "go_to x, y and z are whole numbers" };
  }
  if (action === "dig_down" && args.to !== undefined && args.to !== "stone" && !Number.isInteger(args.to)) {
    return { ok: false, detail: "dig_down to is stone, or a y as a whole number" };
  }
  if (action === "tunnel") {
    if (args.dir !== undefined && !(CARDINALS as readonly string[]).includes(args.dir)) return { ok: false, detail: `tunnel dir is one of ${CARDINALS.join(", ")}` };
    const len = args.length;
    if (len !== undefined && !(typeof len === "number" ? Number.isInteger(len) && len >= 1 && len <= TUNNEL_MAX : isLengthBand(len))) {
      return { ok: false, detail: `tunnel length is a count from 1 to ${TUNNEL_MAX}, or one of ${EXPLORE_BANDS.join(", ")}` };
    }
  }
  if (action === "clear_trees" && args.radius !== undefined && !(Number.isInteger(args.radius) && args.radius >= CLEAR_MIN && args.radius <= CLEAR_MAX)) {
    return { ok: false, detail: `clear_trees radius is a whole number from ${CLEAR_MIN} to ${CLEAR_MAX}` };
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
      say: "say(text): one public chat line, up to 100 printable ASCII characters, one per 2 s, 12 a minute.",
      recipe: "recipe(item): what crafting an item takes, answered at once: makes, needs, whether it needs a table, what it holds of that (have) and what is missing for one craft. A named kind of planks or logs fits only what it holds; with none it says planks for any wood.",
      stash: "stash(): what its own stash chests held when it last looked, counts per item, fresh (every chest looked at within 10 minutes), looked (just now, minutes ago, a while ago, never), unseen (chests it never opened). Answered from memory at once.",
      strip_mine: "A strip mine is built from the actions, not one command: dig_down {to: y, torches: true} (twice for a long way) to the depth you pick (the ore you want is at the y you know it is; the body keeps no table of that), then tunnel {dir, torches: true} for the main tunnel, go_to {x, y, z} a few blocks back along it (pos in observe says where you are), and tunnel again sideways for a branch. You choose the depth, the pattern and when to turn back. tunnel stops at the first ore in a wall unless through: true; observe lists the ore with a handle for collect. climb_up walks back along the tunnel and up the whole stair.",
      upkeep: "Two events wake wait while you dig. pack_full: the pack has no room for what it digs (the usual answer: climb_up or go_to stair, store at your chest, come back); it is told once, until a slot frees. tool_worn {item, left}: the pickaxe or sword in hand is at about a tenth of its life, once per tool (the usual answer: craft another pickaxe or equip a spare; observe tools has the percentages).",
      reasons: REJECTS,
    },
    not_possible: "Anything not listed. There are no commands or free movement: a cell goes through go_to {x, y, z} on foot, and the way down through dig_down. If you need something that is not here, say so in your own notes as a skill request instead of retrying.",
  };
}
