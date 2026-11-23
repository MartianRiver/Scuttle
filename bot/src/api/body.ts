import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { isFleeing, noteStop } from "../behaviors/defence";
import { beginEscort, endEscort } from "../behaviors/escort";
import { giveItem } from "../behaviors/give";
import { destination, goTo } from "../behaviors/goto";
import { isGuardFighting } from "../behaviors/guard";
import { isInHazard } from "../behaviors/survive";
import { isTaskRunning, requestStop, startTask } from "../behaviors/task";
import { StuckError, walkTo } from "../behaviors/unstuck";
import { setStatus } from "../lib/status";
import { HandleTable } from "../senses/handles";
import { createObserver } from "../senses/observe";
import type { BodyControl } from "./dispatch";
import type { TaskName } from "./protocol";

const TASK_PHRASE: Record<TaskName, string> = { get_wood: "get wood", get_stone: "get stone", get_iron: "get iron" };

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

  const vitalOrNull = (n: number | undefined) => (typeof n === "number" ? n : null);

  return {
    inGame: () => connected && Boolean(bot.entity),
    fighting: isGuardFighting,
    danger: () => isFleeing() || isInHazard(),
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

    async runTask(name) {
      endEscort();
      const result = await startTask(bot, TASK_PHRASE[name]);
      if (!result.ok) throw new Error(result.reason);
    },

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
