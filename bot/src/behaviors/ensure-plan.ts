// What `ensure` does, planned apart from the world: from what the pack holds and what the landing chest holds, the
// takes and crafts that bring a pickaxe, torches or food up to what a strip needs, and what is still missing after.
// Pure, so it is tested without a world. No search and no recursion: one fixed route per thing, the chest first, then
// one craft from what is on hand. Making the whole chain from nothing (logs to planks to sticks to a pickaxe to ingots)
// is the planner of roadmap 0.8.8, not this.

export type Counts = Record<string, number>;
export type Step = { do: "take" | "craft"; item: string; count: number };
export type EnsureWhat = "pickaxe" | "torches" | "food" | "kit";
export const ENSURE_WHATS: readonly EnsureWhat[] = ["pickaxe", "torches", "food", "kit"];

export const GOOD_LEFT = 30; // percent of its life a pickaxe has left to count as one to dig with
export const KEEP_TORCHES = 16; // what a strip carries (make_mine puts only what is over this in the landing chest)
export const KEEP_FOOD = 16;
export const KIT_PICKS = 2; // the one in hand and a spare
export const MAX_PICKS = 4;
export const STICK_RESERVE = 2; // torches never use the last sticks: they are a pickaxe

// best first: what a pickaxe taken from the chest may be
export const PICK_TIERS = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe"];
// what a stone pickaxe is made of: the recipes take any one of these three
const STONE_KINDS = ["cobblestone", "cobbled_deepslate", "blackstone"];
const FUELS = ["coal", "charcoal"];

export interface Part {
  what: Exclude<EnsureWhat, "kit">;
  steps: Step[];
  lacks: Counts; // what it still lacks once the steps are done, by item (food as a count of items)
}

const isPlanks = (name: string): boolean => name.endsWith("_planks");

// the pack and the chest as the plan goes: each take and craft moves counts here so the next part plans on the rest
class Stock {
  readonly pack: Counts;
  readonly chest: Counts;
  steps: Step[] = [];

  constructor(pack: Counts, chest: Counts) {
    this.pack = { ...pack };
    this.chest = { ...chest };
  }

  held = (item: string): number => this.pack[item] ?? 0;
  total = (item: string): number => this.held(item) + (this.chest[item] ?? 0);

  // up to n of the item out of the chest
  take(item: string, n: number): number {
    const k = Math.min(n, this.chest[item] ?? 0);
    if (k <= 0) return 0;
    this.chest[item] -= k;
    this.pack[item] = this.held(item) + k;
    this.steps.push({ do: "take", item, count: k });
    return k;
  }

  // the pack holds n of it, taking the difference from the chest; what is still short
  need(item: string, n: number): number {
    const short = n - this.held(item);
    if (short > 0) this.take(item, short);
    return Math.max(0, n - this.held(item));
  }

  // a craft that turns `uses` into `makes` of the item
  craft(item: string, count: number, uses: Counts, makes: number): void {
    for (const [k, n] of Object.entries(uses)) this.pack[k] = this.held(k) - n;
    this.pack[item] = this.held(item) + makes;
    this.steps.push({ do: "craft", item, count });
  }

  // the most planks of one kind it holds (kinds do not mix in a recipe)
  bestPlanks(): { name: string; n: number } {
    let best = { name: "", n: 0 };
    for (const [name, n] of Object.entries(this.pack)) if (isPlanks(name) && n > best.n) best = { name, n };
    return best;
  }

  // the one of these it has the most of, counting the chest
  most(items: readonly string[]): string {
    return [...items].sort((a, b) => this.total(b) - this.total(a))[0];
  }
}

// sticks to hold n of: from the chest, else made from planks (two planks, four sticks). What is still short.
function sticksFor(s: Stock, n: number): number {
  const short = s.need("stick", n);
  if (short <= 0) return 0;
  const crafts = Math.ceil(short / 4);
  const planks = s.bestPlanks();
  if (planks.n < 2 * crafts) return short;
  s.craft("stick", crafts * 4, { [planks.name]: 2 * crafts }, 4 * crafts);
  return 0;
}

// one more pickaxe from the chest, else crafted: iron from three ingots if it has them, else stone from three of a
// cobble kind, with two sticks either way. Lacks are told before any step is made.
function onePickaxe(s: Stock): Counts {
  const taken = PICK_TIERS.find((t) => (s.chest[t] ?? 0) > 0);
  if (taken) {
    s.take(taken, 1);
    return {};
  }
  const iron = s.total("iron_ingot") >= 3;
  const stone = s.most(STONE_KINDS);
  const material = iron ? "iron_ingot" : stone;
  const lacks: Counts = {};
  if (!iron && s.total(stone) < 3) lacks.cobblestone = 3 - s.total(stone);
  const sticks = s.total("stick");
  if (sticks < 2 && s.bestPlanks().n < 2 * Math.ceil((2 - sticks) / 4)) lacks.stick = 2 - sticks;
  if (Object.keys(lacks).length > 0) return lacks;

  s.need(material, 3);
  sticksFor(s, 2);
  s.craft(iron ? "iron_pickaxe" : "stone_pickaxe", 1, { [material]: 3, stick: 2 }, 1);
  return {};
}

// pickaxes to hold `want` that have life left; `good` is how many it carries now. What it still lacks, by item.
function pickaxesIn(s: Stock, want: number, good: number): Counts {
  const lacks: Counts = {};
  for (let i = good; i < Math.min(MAX_PICKS, Math.max(1, want)); i++) {
    const short = onePickaxe(s);
    if (Object.keys(short).length === 0) continue;
    Object.assign(lacks, short);
    break;
  }
  return lacks;
}

// torches to carry `want`: from the chest, then crafted from coal or charcoal and sticks (a craft makes four), never
// into the sticks a pickaxe needs
function torchesIn(s: Stock, want: number): Counts {
  const lacks: Counts = {};
  const need = want - s.held("torch");
  if (need <= 0) return lacks;
  const rest = need - s.take("torch", need);
  if (rest <= 0) return lacks;

  const crafts = Math.ceil(rest / 4);
  const fuel = s.most(FUELS);
  const free = Math.max(0, s.total("stick") - STICK_RESERVE);
  const fuels = s.total(fuel);
  const can = Math.min(crafts, fuels, free);
  if (can > 0) {
    s.need(fuel, can);
    s.need("stick", can);
    s.craft("torch", can * 4, { [fuel]: can, stick: can }, can * 4);
  }
  if (can < crafts) {
    if (fuels < crafts) lacks.coal = crafts - fuels;
    if (free < crafts) lacks.stick = crafts - free;
  }
  return lacks;
}

// food to carry `want` items, best first from the chest; `foods` is the edible items by food points
function foodIn(s: Stock, want: number, foods: Record<string, number>): Counts {
  let have = Object.keys(foods).reduce((n, f) => n + s.held(f), 0);
  const chestFoods = Object.keys(foods)
    .filter((f) => (s.chest[f] ?? 0) > 0)
    .sort((a, b) => foods[b] - foods[a]);
  for (const f of chestFoods) {
    if (have >= want) break;
    have += s.take(f, want - have);
  }
  return have >= want ? {} : { food: want - have };
}

export interface EnsureInput {
  what: EnsureWhat;
  count?: number;
  pack: Counts; // everything it carries by name
  chest: Counts; // what the landing chest holds
  good: number; // pickaxes it carries with GOOD_LEFT percent or more left
  foods: Record<string, number>; // edible items by food points
}

// The parts to run, in order. A kit is the pickaxes first (they keep their sticks), then the torches, then the food, each
// planned on what the one before leaves in the pack and the chest, so no ingot or stick is counted twice.
export function planEnsure(i: EnsureInput): Part[] {
  const s = new Stock(i.pack, i.chest);
  const parts: Part[] = [];
  const part = (what: Part["what"], run: () => Counts): void => {
    const from = s.steps.length;
    const lacks = run();
    parts.push({ what, steps: s.steps.slice(from), lacks });
  };
  const all = i.what === "kit";
  if (all || i.what === "pickaxe") part("pickaxe", () => pickaxesIn(s, all ? KIT_PICKS : (i.count ?? 1), i.good));
  if (all || i.what === "torches") part("torches", () => torchesIn(s, Math.min(64, Math.max(1, all ? KEEP_TORCHES : (i.count ?? KEEP_TORCHES)))));
  if (all || i.what === "food") part("food", () => foodIn(s, Math.min(64, Math.max(1, all ? KEEP_FOOD : (i.count ?? KEEP_FOOD))), i.foods));
  return parts;
}

const label = (k: string) => (k === "food" ? "food" : k.replace(/_/g, " "));

// "short of cobblestone and stick", for the ending's detail
export function lacksWords(lacks: Counts): string {
  const names = Object.keys(lacks).map(label);
  return names.length === 0 ? "" : `short of ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}`;
}
