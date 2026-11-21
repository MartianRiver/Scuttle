import mineflayer from "mineflayer";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";
import { plugin as collectBlockPlugin } from "mineflayer-collectblock";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { setStatus } from "./lib/status";
import { startSurvival } from "./behaviors/survival";
import { isGuardFighting, startGuard } from "./behaviors/guard";
import { isTaskRunning, startTask } from "./behaviors/task";
import { startBodyApi } from "./api";

const log = logger("bot");

function describeLocation(bot: import("mineflayer").Bot): string {
  const { x, y, z } = bot.entity.position;
  return `${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}`;
}

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth,
  version: config.version,
  profilesFolder: config.profilesFolder,
  onMsaCode: (data: { message: string }) => {
    log.info(data.message);
  },
});

bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlockPlugin);
startBodyApi(bot);

bot.once("spawn", () => {
  log.info("spawned", { position: bot.entity.position, version: bot.version });

  const defaultMove = new Movements(bot);
  bot.pathfinder.setMovements(defaultMove);

  setStatus({ task: "idle", location: describeLocation(bot) });
  startSurvival(bot);
  startGuard(bot);

  bot.on("goal_reached", () => {
    if (!isGuardFighting()) setStatus({ task: "idle", location: describeLocation(bot) });
  });

  bot.on("death", () => {
    log.info("died, respawning");
    setStatus({ task: "idle" });
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    log.debug("chat", { username, message });

    if (message === "come here") {
      const sender = bot.players[username]?.entity;
      if (!sender) {
        bot.chat("I can't see you");
        return;
      }
      const { x, y, z } = sender.position;
      setStatus({ task: `walking to ${username}` });
      bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1));
    }

    if (message === "stop") {
      bot.pathfinder.setGoal(null);
      setStatus({ task: "idle", location: describeLocation(bot) });
    }

    if (message === "get wood") {
      if (isGuardFighting()) {
        bot.chat("kind of busy right now");
        return;
      }
      if (isTaskRunning()) {
        bot.chat("already on it");
        return;
      }
      startTask(bot, "get wood").catch((err) =>
        log.error("get wood task threw", { message: (err as Error).message })
      );
    }
  });
});

bot.on("kicked", (reason) => {
  log.warn("kicked", { reason });
});
bot.on("error", (err) => {
  log.error("connection error", { message: err.message });
});
bot.on("end", (reason) => {
  log.info("disconnected", { reason });
});
