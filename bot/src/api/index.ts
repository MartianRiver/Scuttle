import type { Bot } from "mineflayer";
import { watchDeath } from "../behaviors/death";
import type { ReflexHooks } from "../behaviors/reflex-words";
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
  dispatch(intent: Intent, speaker?: string): Outcome;
  interrupt(detail?: string): void;
  reflex: ReflexHooks;
  noFood(food: number): void;
  starving(food: number): void;
  idle(): boolean;
  emit(event: string, fields?: Record<string, unknown>): void;
  close(): void;
}

// Called once, straight after createBot, so it hears the whole connection's life. The dispatcher
// runs either way (chat commands use it); only the WebSocket server needs API_PORT and tokens.
export function startBodyApi(bot: Bot): BodyApi {
  const { host, port, tokens } = config.api;
  const events = new EventLog();
  const dispatcher = createDispatcher(createBody(bot), events);
  const noFood = (food: number) => void events.emit("no_food", { food });
  const starving = (food: number) => void events.emit("starving", { food });
  const reflex: ReflexHooks = {
    started: (e) => dispatcher.reflexStarted(e.what, e.why),
    changed: (e) => dispatcher.reflexChanged(e.what, e.why),
    ended: (e) => dispatcher.reflexEnded(e.what, e.ok, e.detail),
  };

  bot.once("spawn", () => dispatcher.bodyConnected());
  bot.on("end", (reason) => dispatcher.bodyDisconnected(String(reason)));
  watchDeath(bot, { ended: dispatcher.bodyDied, report: dispatcher.died });
  bot.on("chat", (name, message) => {
    if (name === bot.username) return;
    events.emit("chat", { uuid: bot.players[name]?.uuid ?? null, name, message });
  });

  const idle = () => dispatcher.snapshot().task === null;
  const emit = (event: string, fields?: Record<string, unknown>) => void events.emit(event, fields);

  if (!port || tokens.size === 0) {
    log.info("body API server off (API_PORT / API_TOKENS not set)");
    return { dispatch: dispatcher.handle, interrupt: dispatcher.interrupted, reflex, noFood, starving, idle, emit, close() {} };
  }

  const server = startApiServer({ host, port, tokens }, dispatcher, events);
  return {
    dispatch: dispatcher.handle,
    interrupt: dispatcher.interrupted,
    reflex,
    noFood,
    starving,
    idle,
    emit,
    close() {
      for (const client of server.clients) client.terminate();
      server.close();
    },
  };
}
