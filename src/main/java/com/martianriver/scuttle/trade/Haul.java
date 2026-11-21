package com.martianriver.scuttle.trade;

import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.EnumMap;
import java.util.Map;

/**
 * Picks the mining out of a player's pockets.
 *
 * <p>The rule the kids are told is "put anything you want to keep in a chest
 * first", which is simpler than any amount of guessing at intent. What this adds
 * on top is the things a kid would never mean to sell and would be upset to
 * lose: tools and armour (anything with durability, damaged or not), anything
 * named, enchanted or otherwise special, and their money.
 *
 * <p>Main thread only.
 */
public final class Haul {

    private Haul() {
    }

    public static Map<Material, Integer> gather(Player player, TradeGuard guard, Coins coins) {
        Map<Material, Integer> out = new EnumMap<>(Material.class);
        ItemValues values = guard.values();

        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack == null) continue;
            Material material = stack.getType();
            if (!Inventories.plain(stack)) continue;
            if (coins.isCoin(material)) continue;
            if (values.banned(material)) continue;
            // Durability means it's a tool, a weapon or a piece of armour. A brand
            // new pickaxe is "plain" and would otherwise go in the pile.
            if (material.getMaxDurability() > 0) continue;
            if (values.value(material) == null) continue;

            out.merge(material, stack.getAmount(), Integer::sum);
        }
        return out;
    }

    /** What Scuttle will pay for the lot, in credits. */
    public static long valueOf(Map<Material, Integer> goods, TradeGuard guard) {
        long total = 0;
        for (Map.Entry<Material, Integer> e : goods.entrySet()) {
            long paid = guard.creditFor(e.getKey(), e.getValue());
            if (paid > 0) total += paid;
        }
        return total;
    }
}
