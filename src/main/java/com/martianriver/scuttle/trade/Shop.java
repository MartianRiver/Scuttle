package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.find.Bearing;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.regions.Regions;
import org.bukkit.Location;
import org.bukkit.entity.Player;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Where trading is allowed to happen: a WorldGuard region, usually a small
 * building at spawn.
 *
 * <p>The gate exists for the feel of the thing rather than for safety — the
 * caps and the allowlist don't care where anyone is standing. Walking to a shop
 * to spend what you dug up is most of what makes it a shop, and it gives a
 * building on the server a job.
 *
 * <p>Only item movement is gated. Prices, "what can I afford", and everything
 * Scuttle knows about ore and villages still work down a mineshaft, because a
 * price list that only works when you're standing next to the till is no use to
 * someone deciding whether the trip is worth it — and being told what the haul
 * in your bag is worth is exactly what sends you walking back.
 *
 * <p>Fails open. If WorldGuard isn't installed, or the region was never made,
 * Scuttle trades anywhere and says so loudly in the console once. A family
 * server where the shop is silently everywhere is a disappointment; one where
 * Scuttle mutely refuses every trade looks broken.
 */
public final class Shop {

    private static final String MODULE = "shop";

    private final Regions regions;
    private final AtomicBoolean grumbled = new AtomicBoolean();
    private volatile ScuttleConfig config;

    public Shop(Regions regions, ScuttleConfig config) {
        this.regions = regions;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
        grumbled.set(false);
    }

    /** True when the gate is switched on and there's something to enforce it with. */
    public boolean gated() {
        return config.shopEnabled && regions != null;
    }

    public String regionName() {
        return config.shopRegion.toLowerCase(Locale.ROOT);
    }

    /**
     * May this player move items right now?
     *
     * <p>Anyone with {@code scuttle.shop.anywhere} bypasses it — that's the hook
     * for a rank, a parent, or a build server where the shop hasn't been made yet.
     */
    public boolean allows(Player player) {
        return locate(player) != Regions.Where.OUTSIDE;
    }

    public Regions.Where locate(Player player) {
        if (!gated()) return Regions.Where.INSIDE;
        if (player.hasPermission("scuttle.shop.anywhere")) return Regions.Where.INSIDE;

        Regions.Where where = regions.locate(player.getLocation(), regionName());
        if (where == Regions.Where.NO_REGION) {
            if (grumbled.compareAndSet(false, true)) {
                Log.warn(MODULE, "no such WorldGuard region, so trading is allowed anywhere",
                        "region", regionName(),
                        "fix", "/rg define " + regionName() + ", or set trade.shop.enabled false");
            }
            return Regions.Where.INSIDE;
        }
        return where;
    }

    /** "about 240 blocks north-west, and 12 or so above you", or null. */
    public String directions(Player player) {
        if (regions == null) return null;
        Location middle = regions.middle(player.getLocation(), regionName());
        if (middle == null || middle.getWorld() == null) return null;
        if (!middle.getWorld().equals(player.getWorld())) {
            // A bearing across a portal is arithmetic, not directions.
            return switch (middle.getWorld().getEnvironment()) {
                case NETHER -> "through in the Nether";
                case THE_END -> "out in the End, of all places";
                default -> "back up in the overworld";
            };
        }
        return Bearing.describe(player.getLocation(), middle);
    }

    /** What the model is told when it tries to trade with someone out in the world. */
    public String refusal(Player player) {
        String way = directions(player);
        return "Not here — you only do business in the shop, and they're not in it."
                + (way == null ? "" : " The way back to it, from where they're standing: "
                        + way + ".")
                + " Tell them to come and see you and you'll sort it out then. Don't"
                + " apologise for it; it's your shop and that's where the chest is.";
    }
}
