import mineflayer from "mineflayer";
import { pathfinder, goals } from "mineflayer-pathfinder";
import { plugin as collectBlockPlugin } from "mineflayer-collectblock";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { setStatus } from "./lib/status";
import { safeMovements } from "./lib/movement";
import { startSurvival } from "./behaviors/survival";
import { isGuardFighting, startGuard } from "./behaviors/guard";
import { isTaskRunning, startTask } from "./behaviors/task";
import { startBodyApi } from "./api";
import { exitDelayMs, isDuplicateLogin } from "./lib/restart";
import path from "node:path";

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

const startedAt = Date.now();
const stopTimers: Array<() => void> = [];
let spawned = false;
let leaving = false;

// Everything that keeps Node alive is stopped, then the process exits for the supervisor to restart.
// The wait before exiting is the restart backoff (see lib/restart.ts).
function leave(reason: string, duplicate = false): void {
  if (leaving) return;
  leaving = true;
  for (const stop of stopTimers) stop();
  const wait = exitDelayMs(path.join(config.profilesFolder, "restart-state.json"), startedAt, duplicate);
  log.warn("exiting", { reason, restartInMs: wait });
  setTimeout(() => process.exit(1), wait);
}

bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlockPlugin);
stopTimers.push(startBodyApi(bot));

bot.once("spawn", () => {
  spawned = true;
  log.info("spawned", { position: bot.entity.position, version: bot.version });

  // collectblock would swap in default movements (dig and build on) on every collect and never put
  // ours back, so it gets none of its own
  bot.collectBlock.movements = undefined;
  bot.pathfinder.setMovements(safeMovements(bot));

  setStatus({ task: "idle", location: describeLocation(bot) });
  stopTimers.push(startSurvival(bot), startGuard(bot));

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

let duplicateLogin = false;
bot.on("kicked", (reason) => {
  log.warn("kicked", { reason });
  duplicateLogin = isDuplicateLogin(reason);
});
bot.on("error", (err) => {
  log.error("connection error", { message: err.message });
  // before spawn there is no session to wait out, and 'end' may never follow
  if (!spawned) leave(`error: ${err.message}`);
});
bot.on("end", (reason) => {
  log.info("disconnected", { reason });
  leave(String(reason), duplicateLogin);
});
