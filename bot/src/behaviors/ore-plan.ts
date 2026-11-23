// The numbers and small decisions of get_iron, apart from the world. Pure and tested.
import { canMineStone } from "./stone-plan";
import type { Pos } from "./dig-safety";

export const COAL_ORES = ["coal_ore", "deepslate_coal_ore"] as const;
export const IRON_ORES = ["iron_ore", "deepslate_iron_ore"] as const;

export const COAL_TARGET = 8; // held after mining
export const KEEP_COAL = 4; // left in the inventory after the stash
export const PICKAXE_INGOTS = 3;
export const SWORD_INGOTS = 2;
export const SMELT_MS = 10_000; // a furnace cooks one item in 10 s
const ITEMS_PER_COAL = 8;

const IRON_OR_BETTER_PICKAXE = ["iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const IRON_OR_BETTER_SWORD = ["iron_sword", "diamond_sword", "netherite_sword"];
const MINES_IRON = ["stone_pickaxe", ...IRON_OR_BETTER_PICKAXE];

type Count = (name: string) => number;
const holdsAny = (count: Count, names: string[]) => names.some((n) => count(n) > 0);

// coal breaks with any pickaxe; iron ore needs stone or better, a wooden one breaks it and drops nothing
export const canMineCoal = canMineStone;
export const canMineIron = (count: Count): boolean => holdsAny(count, MINES_IRON);

export interface IronPlan {
  pickaxe: boolean;
  sword: boolean;
  ingots: number; // what the tools still to make need
}

// a tool already held at iron level or better is never made again
export function ironPlan(count: Count): IronPlan {
  const pickaxe = !holdsAny(count, IRON_OR_BETTER_PICKAXE);
  const sword = !holdsAny(count, IRON_OR_BETTER_SWORD);
  return {
    pickaxe,
    sword,
    ingots: (pickaxe ? PICKAXE_INGOTS : 0) + (sword ? SWORD_INGOTS : 0),
  };
}

// coal to mine to hold the target, none when it already does
export const coalToMine = (held: number): number => Math.max(0, COAL_TARGET - held);

// raw iron still to mine: what the tools need, less ingots and raw iron already held
export const rawToMine = (plan: IronPlan, ingots: number, raw: number): number => Math.max(0, plan.ingots - ingots - raw);

// raw iron to put in the furnace: what the tools lack in ingots, as far as it holds raw
export const toSmelt = (plan: IronPlan, ingots: number, raw: number): number => Math.min(raw, Math.max(0, plan.ingots - ingots));

export const fuelFor = (items: number): number => Math.ceil(items / ITEMS_PER_COAL);

export const stashCoalAmount = (held: number): number => Math.max(0, held - KEEP_COAL);

// longest it waits for `items` to cook, with slack for the furnace to start
export const smeltWaitMs = (items: number): number => items * SMELT_MS + 15_000;

// a furnace is used only when it is empty or holds coal as fuel and nothing else: anything else in
// it belongs to someone, and is never touched
export function furnaceUsable(slots: { input: string | null; fuel: string | null; output: string | null }): boolean {
  return slots.input === null && slots.output === null && (slots.fuel === null || slots.fuel === "coal");
}

// ---- which ore a body may go for ----

export type Cell = "air" | "liquid" | "solid"; // what is next to the ore; null where nothing is loaded
export type CellAt = (p: Pos) => Cell | null;

const SIX: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// A player sees an ore only where one of its faces is in the open: a cave wall, an outcrop. With
// xray on (test world only) buried ore counts too.
export function isCandidate(target: Pos, cellAt: CellAt, xray: boolean): boolean {
  if (xray) return true;
  return SIX.some(([dx, dy, dz]) => cellAt({ x: target.x + dx, y: target.y + dy, z: target.z + dz }) === "air");
}

// SCUTTLE_XRAY=1 counts only when the bot was started with --testworld
export type XrayMode = "off" | "on" | "ignored";
export function xrayMode(argv: string[], env: Record<string, string | undefined>): XrayMode {
  if (env.SCUTTLE_XRAY !== "1") return "off";
  return argv.includes("--testworld") ? "on" : "ignored";
}
