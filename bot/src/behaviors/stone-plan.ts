// The numbers and the small decisions of get_stone, apart from the world. Pure and tested.

export const COBBLE_TARGET = 16; // more than the body held at the start
export const KEEP_COBBLE = 4; // left in the inventory after the stash

const MINES_STONE = ["wooden_pickaxe", "golden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const STONE_OR_BETTER_PICKAXE = ["stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const STONE_OR_BETTER_SWORD = ["stone_sword", "iron_sword", "diamond_sword", "netherite_sword"];

type Count = (name: string) => number;
const holdsAny = (count: Count, names: string[]) => names.some((n) => count(n) > 0);

export const canMineStone = (count: Count): boolean => holdsAny(count, MINES_STONE);

export interface ToolPlan {
  pickaxe: boolean;
  sword: boolean;
  sticks: number;
  cobble: number;
}

// a tool already held at stone level or better is never made again
export function toolPlan(count: Count): ToolPlan {
  const pickaxe = !holdsAny(count, STONE_OR_BETTER_PICKAXE);
  const sword = !holdsAny(count, STONE_OR_BETTER_SWORD);
  return { pickaxe, sword, sticks: (pickaxe ? 2 : 0) + (sword ? 1 : 0), cobble: (pickaxe ? 3 : 0) + (sword ? 2 : 0) };
}

// how many cobblestone go to the stash: all but the spare, and but what a tool still to be made needs
export function stashAmount(held: number, reserved: number): number {
  return Math.max(0, held - KEEP_COBBLE - reserved);
}
