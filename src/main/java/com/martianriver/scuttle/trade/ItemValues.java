package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.lib.Log;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.CookingRecipe;
import org.bukkit.inventory.ComplexRecipe;
import org.bukkit.inventory.Recipe;
import org.bukkit.inventory.RecipeChoice;
import org.bukkit.inventory.ShapedRecipe;
import org.bukkit.inventory.ShapelessRecipe;
import org.bukkit.inventory.SmithingRecipe;
import org.bukkit.inventory.StonecuttingRecipe;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What everything is worth, in "credits".
 *
 * <p>Raw materials are priced by hand in {@code values.yml}. Everything else is
 * derived by walking the server's own recipe book: a thing is worth the cheapest
 * set of parts that makes it. That isn't just less typing — it's what stops the
 * economy being farmable. A crafted item can never be worth more than its
 * ingredients, so nobody can buy cheap, craft, and sell dear. Uncrafting is
 * covered by the same pass, because "1 block -> 9 ingots" is itself a recipe.
 *
 * <p>Built on the main thread (it reads the recipe registry) and immutable after.
 */
public final class ItemValues {

    private static final String MODULE = "values";

    /** Enough for the longest real chain (ore -> ingot -> block -> ...) to settle. */
    private static final int MAX_PASSES = 16;

    private final Map<Material, Long> values;
    private final Set<Material> banned;

    private ItemValues(Map<Material, Long> values, Set<Material> banned) {
        this.values = values;
        this.banned = banned;
    }

    /** null when Scuttle can't put a number on it — say so rather than guessing. */
    public Long value(Material material) {
        return values.get(material);
    }

    public boolean tradeable(Material material) {
        return material != null
                && !banned.contains(material)
                && values.containsKey(material);
    }

    public boolean banned(Material material) {
        return banned.contains(material);
    }

    public int priced() {
        return values.size();
    }

    /** Main thread only — walks the recipe registry. */
    public static ItemValues build(Path valuesFile) {
        FileConfiguration yaml = YamlConfiguration.loadConfiguration(valuesFile.toFile());

        Map<Material, Long> values = new EnumMap<>(Material.class);
        Set<Material> pinned = EnumSet.noneOf(Material.class);
        Set<Material> banned = EnumSet.noneOf(Material.class);

        readSection(yaml, "base", values, null);
        readSection(yaml, "overrides", values, pinned);
        Map<Material, Long> handPriced = new EnumMap<>(values);

        for (String name : yaml.getStringList("never-trade")) {
            Material m = material(name);
            if (m != null) banned.add(m);
        }

        int derived = relax(values, pinned, byResult());
        reportUndercuts(handPriced, values);

        Log.info(MODULE, "priced the world",
                "hand-priced", values.size() - derived, "derived", derived,
                "never-trade", banned.size());
        return new ItemValues(Map.copyOf(values), Set.copyOf(banned));
    }

    /**
     * A hand-written price that a recipe beat. Not an error — the recipe is
     * usually right — but it means values.yml disagrees with the game about how
     * that thing is obtained, and it's the only way that file quietly goes stale.
     */
    private static void reportUndercuts(Map<Material, Long> handPriced,
                                        Map<Material, Long> finalValues) {
        for (Map.Entry<Material, Long> entry : handPriced.entrySet()) {
            long now = finalValues.getOrDefault(entry.getKey(), entry.getValue());
            if (now < entry.getValue()) {
                Log.debug(MODULE, "a recipe undercut a hand-written price",
                        "item", entry.getKey().name(),
                        "values.yml", entry.getValue(), "cheapest recipe", now);
            }
        }
    }

    private static void readSection(FileConfiguration yaml, String path,
                                    Map<Material, Long> into, Set<Material> alsoPin) {
        var section = yaml.getConfigurationSection(path);
        if (section == null) {
            Log.warn(MODULE, "values.yml has no section", "section", path);
            return;
        }
        for (String key : section.getKeys(false)) {
            Material m = material(key);
            if (m == null) {
                Log.warn(MODULE, "values.yml names something that isn't an item", "name", key);
                continue;
            }
            long v = section.getLong(key, 0);
            if (v <= 0) {
                Log.warn(MODULE, "ignoring a price of zero or less", "item", key);
                continue;
            }
            into.put(m, v);
            if (alsoPin != null) alsoPin.add(m);
        }
    }

    /**
     * Repeatedly re-prices every craftable thing from its ingredients until
     * nothing moves. Values only ever fall — each pass finds a cheaper way to
     * make something — so this settles rather than oscillating.
     */
    private static int relax(Map<Material, Long> values, Set<Material> pinned,
                             Map<Material, List<Recipe>> byResult) {
        Set<Material> derived = EnumSet.noneOf(Material.class);

        for (int pass = 0; pass < MAX_PASSES; pass++) {
            boolean changed = false;

            for (Map.Entry<Material, List<Recipe>> entry : byResult.entrySet()) {
                Material result = entry.getKey();
                if (pinned.contains(result)) continue;

                Long best = null;
                for (Recipe recipe : entry.getValue()) {
                    Long cost = costOf(recipe, values);
                    if (cost != null && (best == null || cost < best)) best = cost;
                }
                if (best == null) continue;

                Long current = values.get(result);
                if (current == null || best < current) {
                    values.put(result, best);
                    derived.add(result);
                    changed = true;
                }
            }

            if (!changed) {
                Log.debug(MODULE, "prices settled", "passes", pass + 1);
                return derived.size();
            }
        }
        Log.debug(MODULE, "prices still moving when passes ran out", "passes", MAX_PASSES);
        return derived.size();
    }

    /** Total cost of one unit, or null if any ingredient is still unpriced. */
    private static Long costOf(Recipe recipe, Map<Material, Long> values) {
        List<RecipeChoice> ingredients = ingredientsOf(recipe);
        if (ingredients == null || ingredients.isEmpty()) return null;

        long total = 0;
        for (RecipeChoice choice : ingredients) {
            Long cheapest = cheapest(choice, values);
            if (cheapest == null) return null;
            total += cheapest;
        }

        // Round UP when a recipe makes several. Rounding down leaks value on every
        // uncraft-and-recraft cycle (an iron nugget at 40/9 = 4 makes an ingot worth
        // 36 instead of 40), and enough of those in a row would be farmable.
        int made = Math.max(1, recipe.getResult().getAmount());
        return Math.max(1, (total + made - 1) / made);
    }

    /**
     * The cheapest way to satisfy one ingredient slot.
     *
     * <p>Buckets are the reason this isn't just a lookup: a cake needs three
     * milk buckets but you get three buckets back, so what it really costs is
     * the difference. {@code getCraftingRemainingItem} is how the game says so.
     */
    private static Long cheapest(RecipeChoice choice, Map<Material, Long> values) {
        Long best = null;
        for (Material m : materialsOf(choice)) {
            Long v = values.get(m);
            if (v == null) continue;

            Material back = m.getCraftingRemainingItem();
            if (back != null) {
                v = Math.max(0, v - values.getOrDefault(back, 0L));
            }
            if (best == null || v < best) best = v;
        }
        return best;
    }

    private static List<Material> materialsOf(RecipeChoice choice) {
        if (choice instanceof RecipeChoice.MaterialChoice materials) {
            return materials.getChoices();
        }
        if (choice instanceof RecipeChoice.ExactChoice exact) {
            List<Material> out = new ArrayList<>();
            exact.getChoices().forEach(stack -> out.add(stack.getType()));
            return out;
        }
        return List.of();
    }

    private static List<RecipeChoice> ingredientsOf(Recipe recipe) {
        // Trims and other complex recipes don't consume a knowable set of parts.
        if (recipe instanceof ComplexRecipe) return null;

        if (recipe instanceof ShapedRecipe shaped) {
            List<RecipeChoice> out = new ArrayList<>(9);
            Map<Character, RecipeChoice> map = shaped.getChoiceMap();
            for (String row : shaped.getShape()) {
                for (char slot : row.toCharArray()) {
                    RecipeChoice choice = map.get(slot);
                    if (choice != null) out.add(choice);
                }
            }
            return out;
        }
        if (recipe instanceof ShapelessRecipe shapeless) {
            return shapeless.getChoiceList();
        }
        if (recipe instanceof CookingRecipe<?> cooking) {
            return List.of(cooking.getInputChoice());
        }
        if (recipe instanceof StonecuttingRecipe cutting) {
            return List.of(cutting.getInputChoice());
        }
        if (recipe instanceof SmithingRecipe smithing) {
            List<RecipeChoice> out = new ArrayList<>(2);
            if (smithing.getBase() != null) out.add(smithing.getBase());
            if (smithing.getAddition() != null) out.add(smithing.getAddition());
            return out;
        }
        return null;
    }

    /** One pass over the registry, so relaxation doesn't re-query it every time. */
    private static Map<Material, List<Recipe>> byResult() {
        Map<Material, List<Recipe>> out = new HashMap<>(1024);
        Iterator<Recipe> it = Bukkit.recipeIterator();
        while (it.hasNext()) {
            Recipe recipe;
            try {
                recipe = it.next();
            } catch (RuntimeException e) {
                // A broken recipe from another plugin shouldn't cost us the price list.
                Log.debug(MODULE, "skipped an unreadable recipe", "error", e.getMessage());
                continue;
            }
            Material result = recipe.getResult().getType();
            if (result == Material.AIR) continue;
            out.computeIfAbsent(result, k -> new ArrayList<>(2)).add(recipe);
        }
        return out;
    }

    private static Material material(String name) {
        Material m = Material.matchMaterial(name.trim().toUpperCase(Locale.ROOT));
        return m != null && m.isItem() && !m.isLegacy() ? m : null;
    }
}
