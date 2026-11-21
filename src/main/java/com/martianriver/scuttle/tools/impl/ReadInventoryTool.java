package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import com.martianriver.scuttle.trade.Inventories;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.Map;

/**
 * What the player is carrying, so Scuttle can work out what they could pay with.
 * Only their own inventory, only ever read.
 */
public final class ReadInventoryTool implements Tool {

    private static final int MAX_KINDS = 18;

    private final TradeDesk desk;

    public ReadInventoryTool(TradeDesk desk) {
        this.desk = desk;
    }

    @Override
    public String name() {
        return "read_inventory";
    }

    @Override
    public String description() {
        return "Re-read what the player is carrying. You have already been given this at "
                + "the top of the conversation, so only call it if you have just swapped "
                + "with them and your notes are stale. Calling it otherwise wastes their "
                + "time. Enchanted, named and damaged items are never tradeable and are "
                + "left out.";
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
    public String execute(Player player, JsonObject args) {
        Map<Material, Integer> contents = Inventories.contents(player);

        StringBuilder sb = new StringBuilder(320);
        sb.append("Carrying: ").append(Inventories.summarise(contents, MAX_KINDS));

        Tier tier = Tier.of(player);
        long spent = desk.spentToday(player.getUniqueId());
        long allowance = desk.allowance(tier);
        sb.append("\nTrading allowance left today: ").append(Math.max(0, allowance - spent))
                .append(" of ").append(allowance).append(" credits");

        long worth = 0;
        for (Map.Entry<Material, Integer> entry : contents.entrySet()) {
            long credit = desk.guard().creditFor(entry.getKey(), entry.getValue());
            if (credit > 0) worth += credit;
        }
        sb.append("\nEverything they have is worth about ").append(worth)
                .append(" credits to you in total (don't take it all — that would be unkind).")
                .append("\n\nCredits are your own bookkeeping. Never say the numbers out loud —")
                .append(" talk in items: \"two gravel and a flint gets you three torches\".");
        return sb.toString();
    }
}
