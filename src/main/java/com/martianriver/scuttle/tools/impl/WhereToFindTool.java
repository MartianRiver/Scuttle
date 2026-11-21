package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.find.Sources;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * "where do I even look for netherite?" — the general question, as opposed to
 * {@link FindOreTool}'s "where is the nearest one".
 *
 * <p>Answers out of {@code sources.yml}, because world generation isn't exposed
 * anywhere in the API. Anything not in there but craftable is handed off to the
 * recipe book rather than guessed at.
 */
public final class WhereToFindTool implements Tool {

    private final Sources sources;

    public WhereToFindTool(Sources sources) {
        this.sources = sources;
    }

    @Override
    public String name() {
        return "where_to_find";
    }

    @Override
    public String description() {
        return "What sort of place a thing turns up in: which dimension, how deep, which biome, "
                + "which mob drops it, which chests it's in. This is the general answer — \"where "
                + "do I look for ancient debris\", \"how do I get an elytra\". It does NOT say "
                + "where a particular one is; find_ore and find_place do that.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("item", "string", "What they want, e.g. 'netherite', 'elytra', "
                        + "'glow berries'")
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
        String query = ToolArgs.string(args, "item");
        MaterialSearch.Match match = MaterialSearch.find(query);
        if (match == null) {
            throw new ToolException("no such item as '" + query + "'");
        }

        Sources.Source source = sources.get(match.material());
        if (source != null) {
            return source.render(MaterialSearch.pretty(match.material()));
        }

        // Not gathered. If the game can make it, say so rather than inventing a biome.
        boolean craftable = !Bukkit.getRecipesFor(new ItemStack(match.material())).isEmpty();
        if (craftable) {
            return MaterialSearch.pretty(match.material()) + " isn't something you go and find —"
                    + " it's made. Call lookup_recipe for it and tell them what it takes.";
        }
        return "Nothing written down about where " + MaterialSearch.pretty(match.material())
                + " comes from, and it has no recipe. Say you're not sure rather than guessing"
                + " — a wrong biome sends a kid a very long way for nothing.";
    }
}
