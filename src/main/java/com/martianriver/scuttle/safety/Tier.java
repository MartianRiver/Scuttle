package com.martianriver.scuttle.safety;

import org.bukkit.entity.Player;

/**
 * Permission tiers. Everyone is a kid unless granted more.
 *
 * <p>Ops are treated as parent so the tiers work today on a server with no
 * permissions plugin. Once LuckPerms is installed the nodes take over with no
 * code change — an explicit node always wins over the op fallback.
 */
public enum Tier {

    KID("scuttle.tier.kid"),
    BUILDER("scuttle.tier.builder"),
    PARENT("scuttle.tier.parent");

    public final String node;

    Tier(String node) {
        this.node = node;
    }

    public boolean isAtLeast(Tier required) {
        return ordinal() >= required.ordinal();
    }

    public static Tier of(Player player) {
        if (player.hasPermission(PARENT.node)) return PARENT;
        if (player.hasPermission(BUILDER.node)) return BUILDER;
        if (player.isOp()) return PARENT;
        return KID;
    }
}
