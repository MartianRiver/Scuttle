export const MAX_GIVE = 64;

export interface Stack {
  name: string;
  count: number;
  slot: number;
}
export interface Throw {
  slot: number;
  count: number;
}

// The slot that must stay put: the held item when it is gear (a sword, an axe, a shield: stack size
// 1). Held stackable things, logs or bread picked up into an empty hand slot, are goods like any
// others, or "give me wood" would fail whenever the logs landed in the selected hotbar slot.
// Armour and the off hand never need this: mineflayer's items() leaves them out already.
export function keptSlot(held: { slot: number; stackSize: number } | null | undefined): number | null {
  return held && held.stackSize === 1 ? held.slot : null;
}

// What to throw, as (slot, count) pairs, never from `keepSlot`. Asking for more than the other stacks
// hold gives what they hold. Fullest stacks first, which keeps the number of throws, and so of
// partial splits, down.
export function planToss(stacks: Stack[], item: string, count: number | undefined, keepSlot: number | null): Throw[] {
  const free = stacks.filter((s) => s.name === item && s.slot !== keepSlot && s.count > 0).sort((a, b) => b.count - a.count || a.slot - b.slot);
  const have = free.reduce((sum, s) => sum + s.count, 0);
  let left = Math.min(count ?? have, MAX_GIVE, have);
  const out: Throw[] = [];
  for (const s of free) {
    if (left <= 0) break;
    const n = Math.min(s.count, left);
    out.push({ slot: s.slot, count: n });
    left -= n;
  }
  return out;
}
