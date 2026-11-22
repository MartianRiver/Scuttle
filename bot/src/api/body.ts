import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { isFleeing, noteStop } from "../behaviors/defence";
import { isGuardFighting } from "../behaviors/guard";
import { isInHazard } from "../behaviors/survive";
import { isTaskRunning, requestStop, startTask } from "../behaviors/task";
import { setStatus } from "../lib/status";
import type { BodyControl } from "./dispatch";
import type { TaskName } from "./protocol";

const TASK_PHRASE: Record<TaskName, string> = { get_wood: "get wood" };

export function createBody(bot: Bot): BodyControl {
  let connected = false;
  bot.on("spawn", () => {
    connected = true;
  });
  bot.on("end", () => {
    connected = false;
  });

  const vitalOrNull = (n: number | undefined) => (typeof n === "number" ? n : null);

  return {
    inGame: () => connected && Boolean(bot.entity),
    fighting: isGuardFighting,
    danger: () => isFleeing() || isInHazard(),
    busy: isTaskRunning,
    canSee: (player) => Boolean(bot.players[player]?.entity),
    vitals: () => ({ health: vitalOrNull(bot.health), food: vitalOrNull(bot.food) }),

    async comeTo(player) {
      const target = bot.players[player]?.entity;
      if (!target) throw new Error("lost sight of them");
      const { x, y, z } = target.position;
      await setStatus({ task: `walking to ${player}` });
      await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));
      await setStatus({ task: "idle" });
    },

    follow(player) {
      const target = bot.players[player]?.entity;
      if (!target) return;
      void setStatus({ task: `following ${player}` });
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
    },

    async runTask(name) {
      const result = await startTask(bot, TASK_PHRASE[name]);
      if (!result.ok) throw new Error(result.reason);
    },

    stop() {
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
