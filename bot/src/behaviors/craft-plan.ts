// Recipes in words, and which one a craft uses. The registry has one recipe per kind of wood for
// everything made of planks, so choosing between them is most of the work. Pure and tested.

export type Counts = Record<string, number>;
export type Held = (name: string) => number;

export interface RecipeLite {
  table: boolean; // needs a crafting table (3x3)
  makes: number; // items per craft
  needs: Counts; // ingredients for one craft
}

export const MAX_CRAFT = 64;

// what an unfit recipe is judged on when nothing says otherwise: the plain, common ingredients
const PREFER = ["oak_planks", "oak_log", "cobblestone", "coal", "iron_ingot"];

export const isPlanks = (name: string): boolean => name.endsWith("_planks");

// how many crafts it takes to make `wanted` items
export const craftsFor = (wanted: number, makes: number): number => Math.ceil(wanted / makes);

export function shortOf(r: RecipeLite, held: Held, times = 1): Counts {
  const out: Counts = {};
  for (const [name, n] of Object.entries(r.needs)) {
    const lack = n * times - held(name);
    if (lack > 0) out[name] = lack;
  }
  return out;
}

const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
const liked = (r: RecipeLite) => Object.keys(r.needs).filter((n) => PREFER.includes(n)).length;

// The recipe a craft of `times` batches uses: the first that is covered by what is held (one that
// needs no table first, since it can be made anywhere), else the one that is the least short, the
// plain materials before the exotic, then the cheapest. `fits` says whether the held items cover it.
export function pickRecipe(recipes: readonly RecipeLite[], held: Held, times = 1): { recipe: RecipeLite; fits: boolean } | null {
  if (recipes.length === 0) return null;
  const covered = recipes.filter((r) => total(shortOf(r, held, times)) === 0);
  if (covered.length > 0) return { recipe: covered.find((r) => !r.table) ?? covered[0], fits: true };
  const ranked = recipes
    .map((r, i) => ({ r, i, lack: total(shortOf(r, held, times)) }))
    .sort((a, b) => a.lack - b.lack || liked(b.r) - liked(a.r) || total(a.r.needs) - total(b.r.needs) || a.i - b.i);
  return { recipe: ranked[0].r, fits: false };
}

// An unfit recipe is told as the recipe for any wood: the kinds of planks are interchangeable, so
// naming one of them would be wrong for most players. `bestPlanks` is the most it holds of one kind.
export function describe(item: string, pick: { recipe: RecipeLite; fits: boolean }, held: Held, bestPlanks: number, times = 1) {
  const { recipe } = pick;
  const generic = !pick.fits && Object.keys(recipe.needs).some(isPlanks);
  const name = (n: string) => (generic && isPlanks(n) ? "planks" : n);
  const needs: Counts = {};
  for (const [n, c] of Object.entries(recipe.needs)) needs[name(n)] = (needs[name(n)] ?? 0) + c;
  const have: Counts = {};
  for (const n of Object.keys(needs)) have[n] = n === "planks" && generic ? bestPlanks : held(n);
  const missing: Counts = {};
  for (const [n, c] of Object.entries(needs)) if (c * times > have[n]) missing[n] = c * times - have[n];
  return { item, makes: recipe.makes, needs, table: recipe.table, have, missing };
}
