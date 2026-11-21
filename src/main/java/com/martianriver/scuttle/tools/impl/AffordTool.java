package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.tools.Tool;
import com.martianriver.scuttle.trade.Coins;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;

/**
 * "what can I afford?" — and, more to the point, what can't they quite.
 *
 * <p>The one just out of reach is the whole feature. "You're two blocks off a
 * shulker box" is the sentence that sends a kid back down the mine, and it costs
 * nothing to work out because the prices already exist.
 */
public final class AffordTool implements Tool {

    /** What a kid actually saves up for. Order is the ladder they climb. */
    private static final Material[] WANTS = {
            Material.SADDLE, Material.NAME_TAG, Material.DIAMOND, Material.IRON_BLOCK,
            Material.DIAMOND_PICKAXE, Material.SHULKER_BOX, Material.DIAMOND_CHESTPLATE,
            Material.ENCHANTED_GOLDEN_APPLE, Material.NETHERITE_INGOT, Material.SPAWNER,
            Material.BEACON, Material.ELYTRA};

    private final TradeDesk desk;

    public AffordTool(TradeDesk desk) {
        this.desk = desk;
    }

    @Override
    public String name() {
        return "what_can_they_afford";
    }

    @Override
    public String description() {
        return "What the player's money will stretch to right now, and — the useful bit — the "
                + "next thing up that it won't quite. Use it when they ask what they can buy, "
                + "what they've got, or what's worth saving for. Naming the thing they're just "
                + "short of is the most encouraging thing you can tell them, so always do it.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema().build();
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
        Coins coins = desk.coins();
        long purse = coins.purse(player);

        List<String> can = new ArrayList<>();
        String justOut = null;
        long shortBy = 0;

        for (Material want : WANTS) {
            long price = desk.guard().costOf(want, 1);
            if (price < 0 || desk.values().banned(want)) continue;
            price = coins.payable(price);
            if (price <= purse) {
                can.add(MaterialSearch.pretty(want));
            } else if (justOut == null) {
                justOut = MaterialSearch.pretty(want);
                shortBy = price - purse;
            }
        }

        StringBuilder sb = new StringBuilder(200);
        sb.append("They're carrying ").append(coins.describe(coins.change(purse))).append(".\n");
        if (can.isEmpty()) {
            sb.append("Not enough for anything on the list yet.\n");
        } else {
            int from = Math.max(0, can.size() - 3);
            sb.append("Can afford, dearest first: ")
                    .append(String.join(", ", can.subList(from, can.size()))).append('\n');
        }
        if (justOut != null) {
            sb.append("JUST out of reach: ").append(justOut).append(", short by ")
                    .append(coins.describe(coins.change(shortBy)))
                    .append(". Tell them this one — it's the bit that makes them want to go"
                            + " back down the mine.");
        }
        return sb.toString();
    }
}
