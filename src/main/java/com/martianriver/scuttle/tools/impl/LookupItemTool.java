package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.List;

/**
 * Resolves a phrase a kid typed to a real item, and reports a few basic facts
 * about it. Read-only — this is Phase 1, nothing here touches the world.
 */
public final class LookupItemTool implements Tool {

    @Override
    public String name() {
        return "lookup_item";
    }

    @Override
    public String description() {
        return "Check whether an item or block exists in this version of Minecraft, and get "
                + "its proper name plus basic facts (stack size, whether it burns, whether it "
                + "can be placed). Use this when you are not certain an item exists.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("query", "string", "What the player called it, e.g. 'sticky piston'")
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
            return "No item called '" + query + "' exists in this version.";
        }

        Material m = match.material();
        StringBuilder sb = new StringBuilder(160);
        sb.append(MaterialSearch.pretty(m));
        if (!match.exact()) {
            sb.append(" (closest match for '").append(query).append("')");
        }
        sb.append("\n- stacks to ").append(m.getMaxStackSize());
        sb.append("\n- ").append(m.isBlock() ? "can be placed as a block" : "an item, not placeable");
        if (m.isFuel()) sb.append("\n- can be burned as fuel");
        if (m.isEdible()) sb.append("\n- edible");

        List<Material> others = MaterialSearch.search(query, 5);
        if (others.size() > 1) {
            StringBuilder also = new StringBuilder();
            for (Material o : others) {
                if (o == m) continue;
                if (!also.isEmpty()) also.append(", ");
                also.append(MaterialSearch.pretty(o));
            }
            if (!also.isEmpty()) sb.append("\n- similar items: ").append(also);
        }
        return sb.toString();
    }
}
