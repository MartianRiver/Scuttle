import type { Bot } from "mineflayer";
import { logger } from "../lib/logger";

const log = logger("equip");

type Slot = "head" | "torso" | "legs" | "feet" | "off-hand" | "hand";

// armour to its slot, a shield to the off hand, anything else to the hand
export function equipSlot(name: string): Slot {
  if (name.endsWith("_helmet")) return "head";
  if (name.endsWith("_chestplate") || name === "elytra") return "torso";
  if (name.endsWith("_leggings")) return "legs";
  if (name.endsWith("_boots")) return "feet";
  if (name === "shield") return "off-hand";
  return "hand";
}

const WORN = [5, 6, 7, 8, 45]; // armour slots and the off hand

// false when it holds none. The swap is made a moment later, by itself: nothing idle takes it back (the meal
// code puts back what it held before a meal, which is this), and the fight code only ever picks a weapon.
export function equipItem(bot: Bot, item: string): boolean {
  const stack = bot.inventory.items().find((i) => i.name === item);
  if (!stack) return WORN.some((s) => bot.inventory.slots[s]?.name === item);
  if (bot.heldItem?.name === item && equipSlot(item) === "hand") return true;
  bot.equip(stack, equipSlot(item)).catch((err: Error) => log.warn("couldn't equip", { item, message: err.message }));
  return true;
}
