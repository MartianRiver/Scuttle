package com.martianriver.scuttle.find;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.CompassMeta;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Holds the one place Scuttle has just found for a player, and hands over a
 * compass pointing at it when they say yes.
 *
 * <p>Same escrow as {@link com.martianriver.scuttle.trade.TradeDesk}: the
 * model asks for a search, Java does it and parks the answer, and the coordinate
 * only ever leaves here as the target of a compass. The model is never told a
 * number, so it cannot hand out one Java didn't find — which is what keeps this
 * on the right side of SCUTTLE.md §14's "no arbitrary coordinates, ever".
 *
 * <p>A lodestone compass doesn't need a lodestone: setting the target and then
 * turning tracking <em>off</em> stops the client invalidating it for having no
 * block there.
 */
public final class HunchDesk {

    private static final String MODULE = "find";

    private final Map<UUID, Parked> pending = new ConcurrentHashMap<>();
    private volatile ScuttleConfig config;

    public HunchDesk(ScuttleConfig config) {
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    private record Parked(Find find, long expiresAt) {
    }

    public void park(Player player, Find find) {
        pending.put(player.getUniqueId(),
                new Parked(find, System.currentTimeMillis() + config.hunchSeconds * 1000L));
        Log.debug(MODULE, "parked a hunch", "player", player.getName(), "what", find.what());
    }

    public Find pendingFor(UUID player) {
        Parked parked = pending.get(player);
        if (parked == null) return null;
        if (System.currentTimeMillis() >= parked.expiresAt()) {
            pending.remove(player);
            return null;
        }
        return parked.find();
    }

    public void drop(UUID player) {
        pending.remove(player);
    }

    /**
     * Hands over the compass. Returns what to say, or null if there was nothing
     * waiting — the player may have taken too long, or clicked twice.
     */
    public String take(Player player) {
        Find find = pendingFor(player.getUniqueId());
        if (find == null) return null;
        pending.remove(player.getUniqueId());

        ItemStack compass = build(find);
        Map<Integer, ItemStack> left = player.getInventory().addItem(compass);
        if (!left.isEmpty()) {
            // Putting it on the floor of a survival server is how you lose it.
            park(player, find);
            return "your pockets are full — make room and ask again";
        }
        Log.info(MODULE, "gave a hunch", "player", player.getName(), "what", find.what(),
                "at", find.where().getBlockX() + "," + find.where().getBlockY()
                        + "," + find.where().getBlockZ());
        return null;
    }

    private ItemStack build(Find find) {
        ItemStack compass = new ItemStack(Material.COMPASS);
        CompassMeta meta = (CompassMeta) compass.getItemMeta();
        Location target = find.where();

        meta.setLodestone(target);
        // Tracked means "check a lodestone is still there"; there isn't one.
        meta.setLodestoneTracked(false);
        meta.displayName(Component.text("Scuttle's Hunch", config.nameColor)
                .decoration(TextDecoration.ITALIC, false));
        meta.lore(List.of(
                Component.text("points at " + find.what(), NamedTextColor.GRAY)
                        .decoration(TextDecoration.ITALIC, false),
                Component.text("\"pretty sure. mostly sure.\"", NamedTextColor.DARK_GRAY)
                        .decoration(TextDecoration.ITALIC, true)));
        compass.setItemMeta(meta);
        return compass;
    }
}
