// The decision half of eating, kept free of mineflayer so it can be tested: what to eat, whether to
// eat, what to take from the stash and when to report that there is nothing to eat.
//
// "Wastes least": of the foods that fill at least FILL_SHARE of the gap to 20, the one with the fewest
// food points (ties to higher saturation); if none fills that much, the one that fills the most.
// Food points and saturation come from the caller's table (the registry), never from here.

export const HUNGRY_BELOW = 15; // eat, and report `no_food` when there is nothing to eat
export const HURT_EAT_BELOW = 18; // regen needs 18, so eat this high when health is not full
const FULL = 20;
const FILL_SHARE = 0.6;
const ROTTEN_AT_OR_BELOW = 6; // rotten flesh only when this hungry and nothing better is carried
const GOLDEN_HEALTH = 10; // golden apples are for health, at 5 hearts or less (or when starving)
export const TARGET_POINTS = 40; // restock until this many food points are carried...
export const TARGET_ITEMS_CAP = 16; // ...or this many food items, so a chest of cookies doesn't fill the pack

// poisonous, nauseating, random or (chorus fruit) a teleport. Raw chicken is "chicken". The registry
// also lists the four fish buckets as food; they can't be eaten, hence the suffix check below.
const HARMFUL = new Set(["spider_eye", "poisonous_potato", "pufferfish", "chicken", "suspicious_stew", "chorus_fruit"]);
const GOLDEN = new Set(["golden_apple", "enchanted_golden_apple"]);
const ROTTEN = "rotten_flesh";

export interface Carried {
  name: string;
  count: number;
}
export interface FoodValue {
  points: number;
  saturation: number;
}
export type FoodTable = Record<string, FoodValue>;

const edible = (name: string, table: FoodTable) =>
  name in table && !HARMFUL.has(name) && !name.endsWith("_bucket");

export function shouldEat(food: number, health: number): boolean {
  return food < HUNGRY_BELOW || (health < FULL && food < HURT_EAT_BELOW);
}

export function chooseFood(carried: Carried[], table: FoodTable, food: number, health: number): string | null {
  const gap = Math.max(1, FULL - food);
  const starving = food <= ROTTEN_AT_OR_BELOW;
  const have = carried.filter((c) => c.count > 0 && edible(c.name, table));
  const names = have.map((c) => c.name);

  const regular = names.filter((n) => n !== ROTTEN && (!GOLDEN.has(n) || health <= GOLDEN_HEALTH || starving));
  if (regular.length === 0) return starving && names.includes(ROTTEN) ? ROTTEN : null;

  const fills = regular.filter((n) => table[n].points >= gap * FILL_SHARE);
  const pool = fills.length > 0 ? fills : regular;
  const sign = fills.length > 0 ? 1 : -1; // enough: fewest points; not enough: most points
  const rank = (n: string) => [sign * table[n].points, -table[n].saturation];
  return [...pool].sort((a, b) => {
    const [pa, sa] = rank(a);
    const [pb, sb] = rank(b);
    return pa - pb || sa - sb;
  })[0];
}

// worth taking from the stash: food it would eat without being hungry for it. Rotten flesh and
// golden apples stay in the chest (the apples are for emergencies, a later decision)
export const restockable = (name: string, table: FoodTable): boolean =>
  edible(name, table) && name !== ROTTEN && !GOLDEN.has(name);

const merge = (list: Carried[]): Carried[] => {
  const by = new Map<string, number>();
  for (const c of list) by.set(c.name, (by.get(c.name) ?? 0) + c.count);
  return [...by].map(([name, count]) => ({ name, count }));
};

function carriedTotals(carried: Carried[], table: FoodTable): { points: number; items: number } {
  let points = 0;
  let items = 0;
  for (const c of merge(carried)) {
    if (!restockable(c.name, table)) continue;
    points += c.count * table[c.name].points;
    items += c.count;
  }
  return { points, items };
}

export function wantsRestock(carried: Carried[], table: FoodTable): boolean {
  const { points, items } = carriedTotals(carried, table);
  return points < TARGET_POINTS && items < TARGET_ITEMS_CAP;
}

// what to withdraw so the body carries about TARGET_POINTS of food: best food first
export function planRestock(carried: Carried[], chest: Carried[], table: FoodTable): Carried[] {
  let { points, items } = carriedTotals(carried, table);
  const options = merge(chest)
    .filter((c) => c.count > 0 && restockable(c.name, table))
    .sort((a, b) => table[b.name].points - table[a.name].points || table[b.name].saturation - table[a.name].saturation);

  const plan: Carried[] = [];
  for (const o of options) {
    if (points >= TARGET_POINTS || items >= TARGET_ITEMS_CAP) break;
    const per = table[o.name].points;
    const take = Math.min(o.count, Math.ceil((TARGET_POINTS - points) / per), TARGET_ITEMS_CAP - items);
    if (take <= 0) continue;
    plan.push({ name: o.name, count: take });
    points += take * per;
    items += take;
  }
  return plan;
}

// One `no_food` per hunger episode: hungry and nothing it will eat. The episode ends when it can eat
// again (it will, and eating clears it) or its food is back above the hungry line.
export function noFoodStep(reported: boolean, food: number, canEat: boolean): { emit: boolean; next: boolean } {
  if (food >= HUNGRY_BELOW || canEat) return { emit: false, next: false };
  return { emit: !reported, next: true };
}
