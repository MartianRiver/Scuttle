// Reads the body for upkeep-plan.ts: whether the pack has room for what a dig drops, and how worn the held tool is.
// `pack_full` and `tool_worn` go out as events (the mind's `wait` wakes on both); a stair or tunnel asks `noRoomFor`
// before each dig and ends `pack full` rather than dig on into drops it cannot pick up.
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { durabilityLeft } from "../senses/bands";
import { logger } from "../lib/logger";
import { dropsOf } from "./harvest";
import { isWatchedTool, PackEpisode, roomFor, WearWatch, wearWords, type Stack } from "./upkeep-plan";

const log = logger("upkeep");
const EVERY_MS = 1000;
const DROP_NEAR = 3; // an item this close to the body is one it would pick up

const pack = new PackEpisode();
const wear = new WearWatch();
let emit: (event: string, fields: Record<string, unknown>) => void = () => {};

const stacksOf = (bot: Bot): Stack[] => bot.inventory.items().map((i) => ({ name: i.name, count: i.count, stackSize: i.stackSize || 64 }));

// the pack has no room for these: said once an episode, whoever asks
function noRoom(bot: Bot, drops: readonly string[]): boolean {
  if (roomFor(drops, stacksOf(bot), bot.inventory.emptySlotCount())) return false;
  if (pack.note()) {
    log.info("pack full");
    emit("pack_full", {});
  }
  return true;
}

// true when digging any of these blocks would drop something the pack cannot take
export function noRoomFor(bot: Bot, blockNames: readonly string[]): boolean {
  return noRoom(bot, blockNames.flatMap((n) => dropsOf(bot, n).slice(0, 1)));
}

function checkTool(bot: Bot): void {
  const held = bot.heldItem;
  if (!held || !held.maxDurability || !isWatchedTool(held.name)) return;
  const left = durabilityLeft(held.durabilityUsed ?? 0, held.maxDurability);
  const told = wear.check({ name: held.name, left });
  if (told) {
    log.info("tool worn", { item: told, left });
    emit("tool_worn", { item: told, left: wearWords });
  }
}

// `emit` is the API's; the events are `pack_full` and `tool_worn` { item, left }
export function watchUpkeep(bot: Bot, send: (event: string, fields: Record<string, unknown>) => void): () => void {
  emit = send;
  const timer = setInterval(() => {
    if (!bot.entity) return;
    if (pack.active && bot.inventory.emptySlotCount() > 0) pack.clear();
    checkTool(bot);
  }, EVERY_MS);
  // an item that fell beside it with nowhere to go (a mob's drop, a block it broke some other way)
  const onDrop = (entity: Entity): void => {
    if (!bot.entity || entity.position.distanceTo(bot.entity.position) > DROP_NEAR) return;
    const name = (entity as Entity & { getDroppedItem?: () => { name: string } | null }).getDroppedItem?.()?.name;
    if (name) noRoom(bot, [name]);
  };
  bot.on("itemDrop", onDrop);
  return () => {
    clearInterval(timer);
    bot.removeListener("itemDrop", onDrop);
  };
}
