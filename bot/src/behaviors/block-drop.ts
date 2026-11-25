// What a block gives when it is dug without silk touch, which is what the body can set down to fill the hole again:
// stone gives cobblestone, deepslate cobbled deepslate, grass dirt. Pure; the registry's loot table is passed in so the
// tests need no registry, and the short table below answers when it has none.
export type Loot = (block: string) => readonly string[] | null;

const SHORT: Readonly<Record<string, string>> = {
  stone: "cobblestone",
  deepslate: "cobbled_deepslate",
  grass_block: "dirt",
  podzol: "dirt",
  mycelium: "dirt",
  dirt_path: "dirt",
  farmland: "dirt",
};

// `loot` lists the items a block can drop by hand. A block that can drop itself is itself (gravel gives flint or gravel
// by chance, and gravel is what goes back); one drop is that drop; several others is a block it cannot say a replacement for
export function dropOf(block: string, loot?: Loot): string {
  const items = loot?.(block);
  if (items && items.length > 0) {
    if (items.includes(block)) return block;
    if (new Set(items).size === 1) return items[0];
    return block;
  }
  return SHORT[block] ?? block;
}
