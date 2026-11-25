import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { yieldToOrder } from "../behaviors/bedtime";
import { isFleeing, mobsNearWords, noteStop } from "../behaviors/defence";
import { beginEscort, endEscort } from "../behaviors/escort";
import { giveItem } from "../behaviors/give";
import { destination, goTo, goToPoint } from "../behaviors/goto";
import { digShaft, goToSite, makeMine } from "../behaviors/mine-site";
import { undo } from "../behaviors/undo";
import { isGuardFighting } from "../behaviors/guard";
import { craft, recipeAnswer } from "../behaviors/craft";
import { climbUp, digDown } from "../behaviors/dig-down";
import { tunnel } from "../behaviors/tunnel";
import { clearTrees } from "../behaviors/clear";
import { equipItem, equipSlot } from "../behaviors/equip";
import { pinHand } from "../behaviors/idle-hand";
import { canExplore, explore } from "../behaviors/explore";
import { makeBase, pickUpBlock, put, type WhereWord } from "../behaviors/put";
import { shear } from "../behaviors/shear";
import { collect } from "../behaviors/harvest";
import { stashCount, stashMemory, store, take } from "../behaviors/stash";
import { hazardWords, isInHazard } from "../behaviors/survive";
import { actionCtx, isTaskRunning, requestStop, runAction, startTask, type TaskResult } from "../behaviors/task";
import { StuckError, walkTo } from "../behaviors/unstuck";
import { config } from "../lib/config";
import { itemCount } from "../lib/inventory";
import { speak } from "../lib/speech";
import { setStatus } from "../lib/status";
import { HandleTable } from "../senses/handles";
import { createObserver } from "../senses/observe";
import type { BodyControl } from "./dispatch";
import type { ActionIntent, CompassPoint, ExploreBand, TaskName } from "./protocol";

const TASK_PHRASE: Record<TaskName, string> = { get_wood: "get wood", get_stone: "get stone", get_iron: "get iron" };

// a run's ending as the dispatcher wants it: the fields of a finish, or an error carrying the words
function outcomeOf(result: TaskResult) {
  if (result.ok) return { got: result.got, stored: result.stored, saw: result.saw, detail: result.detail };
  throw Object.assign(new Error(result.reason), { detail: result.detail, got: result.got, missing: result.missing });
}

export function createBody(bot: Bot): BodyControl {
  let connected = false;
  bot.on("spawn", () => {
    connected = true;
  });
  bot.on("end", () => {
    connected = false;
  });

  const handles = new HandleTable();
  const observe = createObserver(bot, handles);
  // explore looks around at every stop; its own table, so the handles a mind holds are not pushed out
  const lookAround = createObserver(bot, new HandleTable());

  // the position a block handle or a place name points at, inside the body only
  const posOf = (handle: string): Vec3 => {
    const at = destination(bot, handles, handle)?.at();
    if (!at) throw new Error("stale_handle");
    return at;
  };
  const whereOf = (where: string | undefined): WhereWord => {
    if (!where || where === "here" || where === "ahead" || where === "wall") return { word: (where ?? "here") as "here" | "ahead" | "wall" };
    return { word: "on", target: posOf(where.slice(3)) };
  };

  let orders = 0; // bumped by anything that takes the body, so a follow still waiting for it to wake can tell

  const vitalOrNull = (n: number | undefined) => (typeof n === "number" ? n : null);

  return {
    inGame: () => connected && Boolean(bot.entity),
    fighting: isGuardFighting,
    danger: () => isFleeing() || isInHazard(),
    // a hazard comes first, as it does in the body
    dangerWhy: () => (isInHazard() ? hazardWords() : isFleeing() ? mobsNearWords() : undefined),
    busy: isTaskRunning,
    canSee: (player) => Boolean(bot.players[player]?.entity),
    vitals: () => ({ health: vitalOrNull(bot.health), food: vitalOrNull(bot.food) }),

    async comeTo(player) {
      endEscort();
      const asked = orders;
      await yieldToOrder(bot);
      const target = bot.players[player]?.entity;
      if (!target) throw new Error("lost sight of them");
      const { x, y, z } = target.position;
      await setStatus({ task: `walking to ${player}` });
      // a stop during either wait (the status goes out over RCON) must not be followed by a walk
      if (asked !== orders) throw new Error("cancelled");
      try {
        await walkTo(bot, new goals.GoalNear(x, y, z, 1));
      } catch (err) {
        // a reflex or a stop owns the status after any other failure
        if (err instanceof StuckError) await setStatus({ task: "idle" });
        throw err;
      }
      await setStatus({ task: "idle" });
    },

    follow(player) {
      endEscort();
      const target = bot.players[player]?.entity;
      if (!target) return;
      const asked = ++orders;
      void yieldToOrder(bot).then(() => {
        if (asked !== orders) return; // a stop or a newer order came in while it got up
        void setStatus({ task: `following ${player}` });
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
      });
    },

    guard: (player) => beginEscort(player),

    async goTo(handle) {
      endEscort();
      await yieldToOrder(bot);
      // the mine and the shaft's top are walked along the shaft's cells; a stop bumps `orders`, which ends it between legs
      if (handle === "mine" || handle === "shaft") {
        const asked = orders;
        return goToSite(bot, handle, () => asked !== orders);
      }
      return goTo(bot, handles, handle);
    },
    async goToPoint(x, y, z) {
      endEscort();
      await yieldToOrder(bot);
      return goToPoint(bot, { x, y, z });
    },
    carries: (item) => itemCount(bot, item),
    handleLabel: (handle) => destination(bot, handles, handle)?.label ?? null,
    observe,

    async give(player, item, count) {
      endEscort();
      await yieldToOrder(bot);
      return giveItem(bot, player, item, count);
    },

    async runTask(name, near, report) {
      endEscort();
      await yieldToOrder(bot);
      let aim: Vec3 | undefined;
      if (near) {
        aim = destination(bot, handles, near)?.at() ?? undefined;
        if (!aim) throw new Error("stale_handle");
      }
      const result = await startTask(bot, TASK_PHRASE[name], { aim, onProgress: report });
      if (!result.ok) throw Object.assign(new Error(result.reason), { detail: result.detail, got: result.got });
      return { got: result.got };
    },

    async runAction(a: ActionIntent, report) {
      endEscort();
      await yieldToOrder(bot);
      const run = (name: string, work: () => Promise<{ stored?: Record<string, number>; saw?: string; detail?: string; got?: Record<string, number> } | void>) =>
        runAction(bot, name, work, { onProgress: report }).then(outcomeOf);
      const ctx = actionCtx(bot);
      switch (a.intent) {
        case "craft":
          return run("craft", () => craft(bot, ctx, a.item, a.count));
        case "store":
          return run("store", () => store(bot, ctx, a.item, a.count, a.chest ? posOf(a.chest) : undefined));
        case "take":
          return run("take", () => take(bot, ctx, a.item, a.count, a.chest ? posOf(a.chest) : undefined));
        case "place":
          return run("place", async () => ({ detail: (await put(bot, ctx, a.item, whereOf(a.where))).detail }));
        case "pick_up":
          return run("pick_up", () => pickUpBlock(bot, ctx, posOf(a.handle)));
        case "make_base":
          return run("make_base", () => makeBase(bot, ctx));
        case "shear": {
          const t = handles.resolve(a.handle);
          if (t?.kind !== "entity") throw new Error("stale_handle");
          return run("shear", () => shear(bot, ctx, t.id, () => goTo(bot, handles, a.handle)));
        }
        case "dig_shaft":
          return run("dig_shaft", () => digShaft(bot, ctx, { to: a.to, torches: a.torches }));
        case "make_mine":
          return run("make_mine", () => makeMine(bot, ctx));
        case "undo":
          return run("undo", () => undo(bot, ctx, a.job));
        case "explore":
          return run("explore", () => explore(bot, ctx, a.dir, a.far, lookAround));
        case "dig_down":
          return run("dig_down", () => digDown(bot, ctx, { to: a.to, torches: a.torches }));
        case "tunnel":
          return run("tunnel", () => tunnel(bot, ctx, { dir: a.dir, length: a.length, through: a.through, torches: a.torches }));
        case "climb_up":
          return run("climb_up", () => climbUp(bot, ctx));
        case "clear_trees":
          return run("clear_trees", () => clearTrees(bot, ctx, a.radius));
        case "collect": {
          const t = handles.resolve(a.handle);
          if (t?.kind !== "block") throw new Error("stale_handle");
          return run("collect", () => collect(bot, ctx, { pos: new Vec3(t.x, t.y, t.z), name: t.name }, a.count));
        }
      }
    },
    knowsItem: (item) => Boolean(bot.registry.itemsByName[item]),
    recipe: (item) => recipeAnswer(bot, item),
    stash: () => stashMemory.answer(stashCount()),
    equip(item) {
      const held = equipItem(bot, item);
      if (held && equipSlot(item) === "hand") pinHand(item);
      return held;
    },
    placementOn: () => config.placement,
    canExplore: (dir, far) => canExplore(bot, dir as CompassPoint, far as ExploreBand | undefined),

    say: (text) => speak(bot, text, "say"),
    announce: (text) => void speak(bot, text, "escort"),

    stop() {
      endEscort();
      orders++;
      void yieldToOrder(bot);
      noteStop();
      requestStop(bot);
      bot.pathfinder.setGoal(null);
      void setStatus({ task: "idle" });
    },

    interrupt() {
      orders++;
      void yieldToOrder(bot);
      requestStop(bot);
      bot.pathfinder.setGoal(null);
    },
  };
}
