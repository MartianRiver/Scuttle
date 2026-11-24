// What the body stands in, when it is not plain ground. Pure; `bodyStanding` reads it off the bot.
import type { Bot } from "mineflayer";
import { isLiquid } from "../behaviors/dig-safety";

export type Standing = "water" | "deep_water" | "lava";

// `water` has the feet wet and the head dry; `deep_water` has the head under too, which is 2 or more deep
// and no way to touch the bottom and breathe
export function standingIn(feet: string | null, head: string | null): Standing | undefined {
  if (feet === "lava") return "lava";
  if (feet === null || !isLiquid(feet)) return undefined;
  return head !== null && isLiquid(head) && head !== "lava" ? "deep_water" : "water";
}

export function bodyStanding(bot: Bot): Standing | undefined {
  const pos = bot.entity.position;
  return standingIn(bot.blockAt(pos.floored())?.name ?? null, bot.blockAt(pos.offset(0, 1.6, 0))?.name ?? null);
}
