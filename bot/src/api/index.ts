import type { Bot } from "mineflayer";
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { createBody } from "./body";
import { createDispatcher } from "./dispatch";
import { EventLog } from "./events";
import { startApiServer } from "./server";

const log = logger("api");

// Called once, straight after createBot, so it hears the whole connection's life.
export function startBodyApi(bot: Bot): void {
  const { host, port, tokens } = config.api;
  if (!port || tokens.size === 0) {
    log.info("body API off (API_PORT / API_TOKENS not set)");
    return;
  }

  const events = new EventLog();
  const dispatcher = createDispatcher(createBody(bot), events);
  startApiServer({ host, port, tokens }, dispatcher, events);

  bot.once("spawn", () => dispatcher.bodyConnected());
  bot.on("end", (reason) => dispatcher.bodyDisconnected(String(reason)));
  bot.on("death", () => dispatcher.bodyDied());
  bot.on("chat", (name, message) => {
    if (name === bot.username) return;
    events.emit("chat", { uuid: bot.players[name]?.uuid ?? null, name, message });
  });
}
