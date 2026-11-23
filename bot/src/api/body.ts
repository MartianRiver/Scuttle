import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { isFleeing, mobsNearWords, noteStop } from "../behaviors/defence";
import { beginEscort, endEscort } from "../behaviors/escort";
import { giveItem } from "../behaviors/give";
import { destination, goTo } from "../behaviors/goto";
import { isGuardFighting } from "../behaviors/guard";
import { craft, recipeAnswer } from "../behaviors/craft";
import { climbUp, digDown } from "../behaviors/dig-down";
import { equipItem, equipSlot } from "../behaviors/equip";
import { pinHand } from "../behaviors/idle-hand";
import { canExplore, explore } from "../behaviors/explore";
import { collect } from "../behaviors/harvest";
import { stashMemory, stashPlaces, store, take } from "../behaviors/stash";
import { hazardWords, isInHazard } from "../behaviors/survive";
import { actionCtx, isTaskRunning, requestStop, runAction, startTask, type TaskResult } from "../behaviors/task";
import { StuckError, walkTo } from "../behaviors/unstuck";
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
      const target = bot.players[player]?.entity;
      if (!target) throw new Error("lost sight of them");
      const { x, y, z } = target.position;
      await setStatus({ task: `walking to ${player}` });
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
      void setStatus({ task: `following ${player}` });
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
    },

    guard: (player) => beginEscort(player),

    goTo(handle) {
      endEscort();
      return goTo(bot, handles, handle);
    },
    handleLabel: (handle) => destination(bot, handles, handle)?.label ?? null,
    observe,

    give(player, item, count) {
      endEscort();
      return giveItem(bot, player, item, count);
    },

    async runTask(name, near, report) {
      endEscort();
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
      const run = (name: string, work: () => Promise<{ stored?: Record<string, number>; saw?: string; detail?: string } | void>) =>
        runAction(bot, name, work, { onProgress: report }).then(outcomeOf);
      const ctx = actionCtx(bot);
      switch (a.intent) {
        case "craft":
          return run("craft", () => craft(bot, ctx, a.item, a.count));
        case "store":
          return run("store", () => store(bot, ctx, a.item, a.count));
        case "take":
          return run("take", () => take(bot, ctx, a.item, a.count));
        case "explore":
          return run("explore", () => explore(bot, ctx, a.dir, a.far, lookAround));
        case "dig_down":
          return run("dig_down", () => digDown(bot, ctx));
        case "climb_up":
          return run("climb_up", () => climbUp(bot, ctx));
        case "collect": {
          const t = handles.resolve(a.handle);
          if (t?.kind !== "block") throw new Error("stale_handle");
          return run("collect", () => collect(bot, ctx, { pos: new Vec3(t.x, t.y, t.z), name: t.name }, a.count));
        }
      }
    },
    knowsItem: (item) => Boolean(bot.registry.itemsByName[item]),
    recipe: (item) => recipeAnswer(bot, item),
    stash: () => stashMemory.answer(stashPlaces.length),
    equip(item) {
      const held = equipItem(bot, item);
      if (held && equipSlot(item) === "hand") pinHand(item);
      return held;
    },
    canExplore: (dir, far) => canExplore(bot, dir as CompassPoint, far as ExploreBand | undefined),

    say: (text) => bot.chat(text),

    stop() {
      endEscort();
      noteStop();
      requestStop(bot);
      bot.pathfinder.setGoal(null);
      void setStatus({ task: "idle" });
    },

    interrupt() {
      requestStop(bot);
      bot.pathfinder.setGoal(null);
    },
  };
}
