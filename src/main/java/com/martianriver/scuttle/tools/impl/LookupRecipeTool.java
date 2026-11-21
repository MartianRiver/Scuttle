package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.inventory.CookingRecipe;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.Recipe;
import org.bukkit.inventory.RecipeChoice;
import org.bukkit.inventory.ShapedRecipe;
import org.bukkit.inventory.ShapelessRecipe;
import org.bukkit.inventory.SmithingRecipe;
import org.bukkit.inventory.StonecuttingRecipe;
import org.bukkit.entity.Player;

import java.util.List;

/**
 * Reads recipes out of the server's own registry rather than the model's
 * memory. This is the whole point of the fallibility bit of the character —
 * Scuttle checks the book, and the book is right for the version being played.
 */
public final class LookupRecipeTool implements Tool {

    private static final int MAX_RECIPES = 3;

    @Override
    public String name() {
        return "lookup_recipe";
    }

    @Override
    public String description() {
        return "Look up how to craft, smelt, cut or smith something, straight from this "
                + "server's own recipe book. Always use this before telling a player a "
                + "recipe — never answer from memory.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("query", "string", "The item to look up, e.g. 'hopper' or 'sticky piston'")
                .build();
    }

    @Override
    public Tier requiredTier() {
        return Tier.KID;
    }

    @Override
    public boolean needsMainThread() {
        return true;
    }

    @Override
    public String execute(Player player, JsonObject args) throws ToolException {
        String query = ToolArgs.string(args, "query");

        MaterialSearch.Match match = MaterialSearch.find(query);
        if (match == null) {
            return "No item called '" + query + "' exists, so there's no recipe for it.";
        }

        Material result = match.material();
        List<Recipe> recipes = Bukkit.getRecipesFor(new ItemStack(result));
        if (recipes.isEmpty()) {
            return MaterialSearch.pretty(result) + " has no recipe — it isn't crafted.";
        }

        StringBuilder sb = new StringBuilder(256);
        sb.append("Recipes for ").append(MaterialSearch.pretty(result));
        if (!match.exact()) sb.append(" (closest match for '").append(query).append("')");
        sb.append(":\n");

        int shown = 0;
        for (Recipe recipe : recipes) {
            String described = describe(recipe);
            if (described == null) continue;
            sb.append(described).append('\n');
            if (++shown >= MAX_RECIPES) break;
        }
        if (shown == 0) {
            return MaterialSearch.pretty(result) + " has a recipe, but not one I can read out.";
        }
        return sb.toString();
    }

    private String describe(Recipe recipe) {
        if (recipe instanceof ShapedRecipe shaped) {
            StringBuilder sb = new StringBuilder("Crafting table, arranged like this:\n");
            for (String row : shaped.getShape()) {
                sb.append("  ");
                for (char c : row.toCharArray()) {
                    sb.append(c == ' ' ? "[empty] " : "[" + choice(shaped.getChoiceMap().get(c)) + "] ");
                }
                sb.append('\n');
            }
            sb.append("  makes ").append(amount(shaped.getResult()));
            return sb.toString();
        }
        if (recipe instanceof ShapelessRecipe shapeless) {
            StringBuilder sb = new StringBuilder("Crafting table, arrangement doesn't matter: ");
            joinChoices(sb, shapeless.getChoiceList());
            sb.append(" makes ").append(amount(shapeless.getResult()));
            return sb.toString();
        }
        if (recipe instanceof CookingRecipe<?> cooking) {
            return station(cooking) + ": " + choice(cooking.getInputChoice())
                    + " makes " + amount(cooking.getResult())
                    + " (" + cooking.getCookingTime() / 20 + "s)";
        }
        if (recipe instanceof StonecuttingRecipe cutting) {
            return "Stonecutter: " + choice(cutting.getInputChoice())
                    + " makes " + amount(cutting.getResult());
        }
        if (recipe instanceof SmithingRecipe smithing) {
            return "Smithing table: " + choice(smithing.getBase())
                    + " plus " + choice(smithing.getAddition())
                    + " makes " + amount(smithing.getResult());
        }
        return null;
    }

    private static String station(CookingRecipe<?> recipe) {
        String type = recipe.getClass().getSimpleName().replace("Recipe", "");
        return switch (type) {
            case "Furnace" -> "Furnace";
            case "Blasting" -> "Blast furnace";
            case "Smoking" -> "Smoker";
            case "CampfireCooking" -> "Campfire";
            default -> type;
        };
    }

    private void joinChoices(StringBuilder sb, List<RecipeChoice> choices) {
        for (int i = 0; i < choices.size(); i++) {
            if (i > 0) sb.append(" + ");
            sb.append(choice(choices.get(i)));
        }
    }

    /**
     * A choice can be several materials ("any plank"). Listing all forty is
     * noise, so this names the first two and says how many more there are.
     */
    private String choice(RecipeChoice choice) {
        if (choice == null) return "empty";
        if (choice instanceof RecipeChoice.MaterialChoice materials) {
            List<Material> options = materials.getChoices();
            if (options.isEmpty()) return "empty";
            if (options.size() == 1) return MaterialSearch.pretty(options.get(0));
            String first = MaterialSearch.pretty(options.get(0));
            String second = MaterialSearch.pretty(options.get(1));
            if (options.size() == 2) return first + " or " + second;
            return "any of " + first + ", " + second
                    + " and " + (options.size() - 2) + " more like them";
        }
        if (choice instanceof RecipeChoice.ExactChoice exact) {
            List<ItemStack> stacks = exact.getChoices();
            return stacks.isEmpty() ? "empty" : MaterialSearch.pretty(stacks.get(0).getType());
        }
        return MaterialSearch.pretty(choice.getItemStack().getType());
    }

    private static String amount(ItemStack stack) {
        int count = stack.getAmount();
        String name = MaterialSearch.pretty(stack.getType());
        return count > 1 ? count + "x " + name : name;
    }
}
