import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as collectBlockPlugin } from "mineflayer-collectblock";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { getStatus, setStatus } from "./lib/status";
import { safeMovements } from "./lib/movement";
import { isFleeing, startDefence } from "./behaviors/defence";
import { isGuarding, startEscort } from "./behaviors/escort";
import { startSurvival, isEating } from "./behaviors/survival";
import { startIdleHand } from "./behaviors/idle-hand";
import { isTaskRunning } from "./behaviors/task";
import { isFalling, startFall } from "./behaviors/fall";
import { isInHazard, startSurvive } from "./behaviors/survive";
import { startBedtime } from "./behaviors/bedtime";
import { isGuardFighting, startGuard } from "./behaviors/guard";
import { startBodyApi } from "./api";
import { chatIntent } from "./api/chat";
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
const api = startBodyApi(bot);
stopTimers.push(api.close);

bot.once("spawn", () => {
  spawned = true;
  log.info("spawned", { position: bot.entity.position, version: bot.version });

  // collectblock stays loaded for bot.tool; its collect() would swap in default movements (dig and
  // build on) and never put ours back, so it gets none of its own
  bot.collectBlock.movements = undefined;
  bot.pathfinder.setMovements(safeMovements(bot));

  setStatus({ task: "idle", location: describeLocation(bot) });
  stopTimers.push(
    startSurvival(bot, isTaskRunning, api.noFood),
    startGuard(bot),
    startDefence(bot, api.interrupt, api.reflexEnded),
    startSurvive(bot, api.interrupt, api.reflexEnded),
    startFall(bot, api.interrupt),
    startBedtime(bot, api),
    startEscort(bot, () => isFleeing() || isInHazard() || isFalling() || isGuardFighting()),
    startIdleHand(bot, () => getStatus().task === "idle" && !isTaskRunning() && !isEating() && !isFleeing() && !isInHazard() && !isFalling() && !isGuardFighting() && !isGuarding())
  );

  bot.on("goal_reached", () => {
    if (!isGuardFighting() && !isGuarding()) setStatus({ task: "idle", location: describeLocation(bot) });
  });

  bot.on("death", () => {
    log.info("died, respawning");
    setStatus({ task: "idle" });
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    log.debug("chat", { username, message });

    const intent = chatIntent(username, message);
    if (!intent) return;
    const outcome = api.dispatch(intent);
    const reason = outcome.kind === "rejected" ? outcome.reason : undefined;
    log.info("chat command", { username, intent: intent.intent, outcome: outcome.kind, reason });
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
