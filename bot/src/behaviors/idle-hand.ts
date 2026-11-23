// What the idle body holds: a tool, not whatever it last picked up (it was seen holding a sapling). With a hostile in
// view the best weapon, otherwise the best pickaxe, then the best axe; with none of those the hand is left alone.
// Only on a change, and never over an item the mind asked for with `equip`, which stays until something else
// (a task, a fight) changes the hand. The decision is pure; the timer is below.
import type { Bot } from "mineflayer";
import { logger } from "../lib/logger";
import { bestWeapon } from "./stance";

const log = logger("idle-hand");

const TIERS = ["netherite", "diamond", "iron", "copper", "stone", "golden", "wooden"];

export function bestTool(items: readonly string[], kind: "pickaxe" | "axe"): string | null {
  const have = items.filter((n) => n.endsWith(`_${kind}`));
  have.sort((a, b) => TIERS.indexOf(a.replace(`_${kind}`, "")) - TIERS.indexOf(b.replace(`_${kind}`, "")));
  return have[0] ?? null;
}

// the item to hold, or null when nothing here beats what is in the hand
export function idleHold(items: readonly string[], hostileInView: boolean): string | null {
  return (hostileInView ? bestWeapon([...items]) : null) ?? bestTool(items, "pickaxe") ?? bestTool(items, "axe");
}

const PIN_GRACE_MS = 3_000; // an `equip` takes a moment to land, and until it has the hand still shows the old item
const TICK_MS = 1_500;
const HOSTILE_VIEW = 16;

let pinned: { item: string; at: number } | null = null;

// the mind asked for this item in the hand
export function pinHand(item: string, now: number = Date.now()): void {
  pinned = { item, at: now };
}

// whether the pin still holds the hand: the item is in it, or the order is too new to tell
export function holdsPin(held: string | null, now: number = Date.now()): boolean {
  if (!pinned) return false;
  if (held === pinned.item || now - pinned.at < PIN_GRACE_MS) return true;
  pinned = null;
  return false;
}

// `resting` says nothing has the hand: no task, no reflex, no meal
export function startIdleHand(bot: Bot, resting: () => boolean): () => void {
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy || !bot.entity || bot.health <= 0 || !resting()) return;
    const held = bot.heldItem?.name ?? null;
    if (holdsPin(held)) return;
    const mob = Object.values(bot.entities).some((e) => e.type === "hostile" && e.position.distanceTo(bot.entity.position) < HOSTILE_VIEW);
    const names = bot.inventory.items().map((i) => i.name);
    const want = idleHold(names, mob);
    if (!want || want === held) return;
    const item = bot.inventory.items().find((i) => i.name === want);
    if (!item) return;
    busy = true;
    try {
      await bot.equip(item, "hand");
    } catch (err) {
      log.warn("couldn't take the tool in hand", { item: want, message: (err as Error).message });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  return () => clearInterval(timer);
}
