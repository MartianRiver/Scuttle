import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";

export function itemCount(bot: Bot, name: string): number {
  return bot.inventory.items().reduce((sum, item) => (item.name === name ? sum + item.count : sum), 0);
}

// Ground truth over model memory applies here too: this asks the server's own
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

  await pacedClicks(bot, async () => {
    if (craftingTable) {
      await bot.craft(recipes[0], count, craftingTable);
      return;
    }
    try {
      await bot.craft(recipes[0], count);
    } finally {
      await settleGrid(bot);
    }
  });
  return true;
}

// mineflayer fires a craft's clicks back to back, all carrying the same state id. The server takes
// every click after the first as stale and answers with a full inventory resync, which arrives
// mid-craft and describes the inventory before mineflayer's own clicks; mineflayer adopts it,
// believes its cursor is empty and misplaces the next ingredient. On 26.3 that crafted a button
// instead of sticks about one round in five. Waiting for the server's answer to each click keeps
// every click current, so no stale resync is sent. Remove once upstream clicks this way itself.
async function pacedClicks<T>(bot: Bot, run: () => Promise<T>): Promise<T> {
  const original = bot.clickWindow;
  bot.clickWindow = async (slot, button, mode) => {
    const reply = inventoryReply(bot);
    await original.call(bot, slot, button, mode);
    await reply;
  };
  try {
    return await run();
  } finally {
    bot.clickWindow = original;
  }
}

const INVENTORY_PACKETS = ["window_items", "set_slot", "set_cursor_item"];

// resolves once inventory packets have arrived and then gone quiet for a tick, or after a cap
// (a click that changes nothing gets no answer)
function inventoryReply(bot: Bot, quietMs = 60, capMs = 750): Promise<void> {
  return new Promise((resolve) => {
    let quiet: NodeJS.Timeout | undefined;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      for (const name of INVENTORY_PACKETS) bot._client.removeListener(name, heard);
      resolve();
    };
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, quietMs);
    };
    const cap = setTimeout(done, capMs);
    for (const name of INVENTORY_PACKETS) bot._client.on(name, heard);
  });
}

// mineflayer ends a table craft with a sync and a close but a 2x2 craft with neither, so the next
// craft starts from an unconfirmed model. On 26.3 that leaves ingredients in the grid and every
// later 2x2 craft goes wrong (upstream #4196). Confirm the server's view; if the grid or cursor
// still holds anything, close the inventory so the server hands it back, and only return once a
// sync shows the grid empty.
async function settleGrid(bot: Bot): Promise<void> {
  const sync = (bot as Bot & { _syncWindow(w: unknown): Promise<void> })._syncWindow;
  const clear = () => !bot.inventory.selectedItem && [1, 2, 3, 4].every((s) => !bot.inventory.slots[s]);
  for (let tries = 0; tries < 3; tries++) {
    const trailing = inventoryReply(bot);
    await sync(bot.inventory);
    await trailing;
    if (clear()) return;
    bot._client.write("close_window", { windowId: 0 });
    await new Promise((r) => setTimeout(r, 250));
  }
  await sync(bot.inventory);
  if (!clear()) throw new Error("crafting grid still holds items after three closes");
}
