import type { Bot } from "mineflayer";
import loadChat from "prismarine-chat";
import { base } from "../lib/base";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import { isTaskRunning } from "./task";
import { deathCause, describePlace, type Cause } from "./place";

const log = logger("death");

const CAUSE_WAIT_MS = 500; // how long a death waits for its message before saying "other"
const CAUSE_FRESH_MS = 2000; // a message this recent belongs to the death that just happened

export interface DeathHooks {
  // the action in progress ends, `died` as its reason
  ended(): void;
  // the death, in words
  report(place: string, cause: Cause): void;
}

// Mineflayer respawns the body by itself (options.respawn defaults on). This sees to the rest:
// whatever it was doing is over, nothing carries on from the spot it died at, and the death is
// reported. The reflexes (defence, survive, fall, guard) reset themselves on `death`.
export function watchDeath(bot: Bot, hooks: DeathHooks): () => void {
  const ChatMessage = loadChat(bot.registry as never);
  let heard: { cause: Cause; at: number } | null = null;
  let wake: (() => void) | null = null;

  // sent to the player who died only, so there is no other player's death to tell apart
  const onKill = (packet: { message?: unknown }): void => {
    let key: string | undefined;
    try {
      key = ChatMessage.fromNotch(packet.message as never).translate;
    } catch {
      // an unreadable message is just "other"
    }
    log.info("death message", { key });
    heard = { cause: deathCause(key), at: Date.now() };
    wake?.();
  };

  const causeOf = async (): Promise<Cause> => {
    if (!heard || Date.now() - heard.at > CAUSE_FRESH_MS) {
      heard = null;
      await new Promise<void>((res) => {
        wake = res;
        setTimeout(res, CAUSE_WAIT_MS);
      });
      wake = null;
    }
    const cause = heard?.cause ?? "other";
    heard = null;
    return cause;
  };

  const onDeath = async (): Promise<void> => {
    // respawn moves the body right after this event, so the place is taken now
    const place = describePlace(bot.entity.position, base.bed[0], bot.game.dimension);
    hooks.ended();
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    void setStatus({ task: "idle" });
    bot.once("spawn", () => {
      log.info("respawned", { dimension: bot.game.dimension, taskRunning: isTaskRunning() });
      setTimeout(() => log.info("after respawn", { taskRunning: isTaskRunning() }), 1000);
    });
    const cause = await causeOf();
    log.info("died", { place, cause });
    hooks.report(place, cause);
  };

  const listener = (): void => void onDeath();
  bot._client.on("death_combat_event", onKill);
  bot.on("death", listener);
  return () => {
    bot._client.removeListener("death_combat_event", onKill);
    bot.removeListener("death", listener);
  };
}
