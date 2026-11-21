package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.tools.MaterialSearch;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Reading and changing what a player is carrying. Main thread only.
 *
 * <p>Everything here works on <em>plain</em> items only — no enchantments, no
 * names, no damage. That rule exists because a kid's enchanted pickaxe is not
 * a commodity and must never be swept into a bulk trade because it happened to
 * be the right material.
 */
public final class Inventories {

    private Inventories() {
    }

    /** True if this stack is an ordinary, interchangeable one. */
    public static boolean plain(ItemStack stack) {
        if (stack == null || stack.getType() == Material.AIR) return false;
        if (!stack.hasItemMeta()) return true;

        ItemMeta meta = stack.getItemMeta();
        if (meta == null) return true;
        if (meta.hasCustomName()) return false;
        if (meta.hasEnchants() || meta.hasLore() || meta.hasCustomModelData()) return false;
        if (meta instanceof Damageable damageable && damageable.hasDamage()) return false;
        return true;
    }

    /** How many plain ones of this material the player has in main storage. */
    public static int count(Player player, Material material) {
        int total = 0;
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack != null && stack.getType() == material && plain(stack)) {
                total += stack.getAmount();
            }
        }
        return total;
    }

    /** Everything tradeable the player is carrying, most numerous first. */
    public static Map<Material, Integer> contents(Player player) {
        Map<Material, Integer> out = new EnumMap<>(Material.class);
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack == null || !plain(stack)) continue;
            out.merge(stack.getType(), stack.getAmount(), Integer::sum);
        }
        return out;
    }

    /**
     * Takes exactly {@code count} plain items. Returns false and changes nothing
     * if there aren't enough — the caller checked already, but between the offer
     * and the yes the player may have spent them.
     */
    public static boolean remove(Player player, Material material, int count) {
        if (count(player, material) < count) return false;

        int left = count;
        ItemStack[] storage = player.getInventory().getStorageContents();
        for (int i = 0; i < storage.length && left > 0; i++) {
            ItemStack stack = storage[i];
            if (stack == null || stack.getType() != material || !plain(stack)) continue;

            int taken = Math.min(left, stack.getAmount());
            left -= taken;
            if (taken >= stack.getAmount()) {
                storage[i] = null;
            } else {
                stack.setAmount(stack.getAmount() - taken);
            }
        }
        player.getInventory().setStorageContents(storage);
        return left == 0;
    }

    /** Free slots plus room in part-full stacks, so a trade can't vanish into a full pack. */
    public static int roomFor(Player player, Material material) {
        int room = 0;
        int max = material.getMaxStackSize();
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack == null || stack.getType() == Material.AIR) {
                room += max;
            } else if (stack.getType() == material && plain(stack)) {
                room += Math.max(0, max - stack.getAmount());
            }
        }
        return room;
    }

    /** Drops at the player's feet rather than deleting, if anything won't fit. */
    public static void give(Player player, Material material, int count) {
        int left = count;
        int max = material.getMaxStackSize();
        while (left > 0) {
            int batch = Math.min(left, max);
            var overflow = player.getInventory().addItem(new ItemStack(material, batch));
            overflow.values().forEach(stack ->
                    player.getWorld().dropItemNaturally(player.getLocation(), stack));
            left -= batch;
        }
    }

    /** A readable list for the model: "384x cobblestone, 62x oak log, 9x iron ingot". */
    public static String summarise(Map<Material, Integer> contents, int limit) {
        if (contents.isEmpty()) return "nothing at all";

        List<Map.Entry<Material, Integer>> sorted = new ArrayList<>(contents.entrySet());
        sorted.sort(Map.Entry.<Material, Integer>comparingByValue(Comparator.reverseOrder()));

        StringBuilder sb = new StringBuilder(256);
        int shown = 0;
        for (Map.Entry<Material, Integer> entry : sorted) {
            if (shown == limit) {
                sb.append(", and ").append(sorted.size() - shown).append(" other kinds");
                break;
            }
            if (shown > 0) sb.append(", ");
            sb.append(entry.getValue()).append("x ").append(MaterialSearch.pretty(entry.getKey()));
            shown++;
        }
        return sb.toString();
    }
}
