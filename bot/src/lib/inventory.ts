import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";

export function itemCount(bot: Bot, name: string): number {
  return bot.inventory.items().reduce((sum, item) => (item.name === name ? sum + item.count : sum), 0);
}

// Ground truth over model memory applies here too (SCUTTLE.md §6) — this asks the server's own
// recipe registry rather than hardcoding a crafting tree, so it stays correct if recipes change.
export async function craftItem(
  bot: Bot,
  name: string,
  count: number,
  craftingTable?: Block | null
): Promise<boolean> {
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`unknown item: ${name}`);

  const recipes = bot.recipesFor(item.id, null, 1, craftingTable ?? null);
  if (recipes.length === 0) return false;

  await bot.craft(recipes[0], count, craftingTable ?? undefined);
  return true;
}
