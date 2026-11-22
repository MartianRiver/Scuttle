import type { Bot } from "mineflayer";
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { createBody } from "./body";
import { createDispatcher } from "./dispatch";
import type { Outcome } from "./dispatch";
import { EventLog } from "./events";
import type { Intent } from "./protocol";
import { startApiServer } from "./server";

const log = logger("api");

export interface BodyApi {
  dispatch(intent: Intent): Outcome;
  interrupt(): void;
  close(): void;
}

// Called once, straight after createBot, so it hears the whole connection's life. The dispatcher
// runs either way (chat commands use it); only the WebSocket server needs API_PORT and tokens.
export function startBodyApi(bot: Bot): BodyApi {
  const { host, port, tokens } = config.api;
  const events = new EventLog();
  const dispatcher = createDispatcher(createBody(bot), events);

  bot.once("spawn", () => dispatcher.bodyConnected());
  bot.on("end", (reason) => dispatcher.bodyDisconnected(String(reason)));
  bot.on("death", () => dispatcher.bodyDied());
  bot.on("chat", (name, message) => {
    if (name === bot.username) return;
    events.emit("chat", { uuid: bot.players[name]?.uuid ?? null, name, message });
  });

  if (!port || tokens.size === 0) {
    log.info("body API server off (API_PORT / API_TOKENS not set)");
    return { dispatch: dispatcher.handle, interrupt: dispatcher.interrupted, close() {} };
  }

  const server = startApiServer({ host, port, tokens }, dispatcher, events);
  return {
    dispatch: dispatcher.handle,
    interrupt: dispatcher.interrupted,
    close() {
      for (const client of server.clients) client.terminate();
      server.close();
    },
  };
}
