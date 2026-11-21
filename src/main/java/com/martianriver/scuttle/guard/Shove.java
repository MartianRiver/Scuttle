package com.martianriver.scuttle.guard;

import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.regions.Regions;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

/**
 * The 1st/2nd-hit teleport — pushes an attacker a short distance away from
 * Scuttle, but only onto ground that's actually safe to land on. Never drops
 * anyone in lava, in a wall, over a void, or inside someone else's claim.
 */
final class Shove {

    private static final String MODULE = "guard";
    private static final double[] TRY_ANGLES_DEG = {0, 40, -40, 80, -80};

    private Shove() {
    }

    /** True if it found somewhere safe and moved them; false if it gave up. */
    static boolean push(Player attacker, Location victimLoc, double distanceBlocks,
            Regions regions, String claimPrefix) {
        Location attackerLoc = attacker.getLocation();
        Vector direction = attackerLoc.toVector().subtract(victimLoc.toVector());
        direction.setY(0);
        if (direction.lengthSquared() < 0.01) {
            // Standing right on top of Scuttle — push whichever way the attacker
            // is already facing instead of dividing by zero.
            direction = attackerLoc.getDirection().setY(0);
        }
        if (direction.lengthSquared() < 0.01) direction = new Vector(1, 0, 0);
        direction.normalize();

        for (double angleDeg : TRY_ANGLES_DEG) {
            Vector candidate = rotateY(direction, Math.toRadians(angleDeg)).multiply(distanceBlocks);
            Location landing = safeLandingAt(attackerLoc.getWorld(),
                    attackerLoc.getX() + candidate.getX(), attackerLoc.getZ() + candidate.getZ());
            if (landing == null) continue;
            if (regions != null && regions.claimAt(landing, claimPrefix) != null) continue;

            landing.setYaw(attackerLoc.getYaw());
            landing.setPitch(attackerLoc.getPitch());
            if (!attacker.teleport(landing)) continue;
            attacker.sendActionBar(Component.text("Scuttle shoves you back!", NamedTextColor.GRAY));
            return true;
        }
        Log.debug(MODULE, "no safe landing spot found for shove", "attacker", attacker.getName());
        return false;
    }

    /** Ground level at this column, or null if nothing there is safe to stand on. */
    private static Location safeLandingAt(World world, double x, double z) {
        int blockX = (int) Math.floor(x);
        int blockZ = (int) Math.floor(z);
        int groundY = world.getHighestBlockYAt(blockX, blockZ);

        Block ground = world.getBlockAt(blockX, groundY, blockZ);
        Block feet = ground.getRelative(0, 1, 0);
        Block head = ground.getRelative(0, 2, 0);

        if (!ground.getType().isSolid() || isHazard(ground.getType())) return null;
        if (!feet.isPassable() || feet.isLiquid() || isHazard(feet.getType())) return null;
        if (!head.isPassable() || head.isLiquid() || isHazard(head.getType())) return null;

        Location landing = new Location(world, blockX + 0.5, groundY + 1, blockZ + 0.5);
        return world.getWorldBorder().isInside(landing) ? landing : null;
    }

    private static boolean isHazard(Material material) {
        return switch (material) {
            case LAVA, FIRE, SOUL_FIRE, MAGMA_BLOCK, CACTUS, POWDER_SNOW, VOID_AIR,
                    CAMPFIRE, SOUL_CAMPFIRE, SWEET_BERRY_BUSH, WITHER_ROSE,
                    POINTED_DRIPSTONE, END_PORTAL, NETHER_PORTAL -> true;
            default -> false;
        };
    }

    private static Vector rotateY(Vector v, double radians) {
        double cos = Math.cos(radians);
        double sin = Math.sin(radians);
        return new Vector(v.getX() * cos - v.getZ() * sin, 0, v.getX() * sin + v.getZ() * cos);
    }
}
