package com.martianriver.scuttle.regions;

import org.bukkit.Location;
import org.bukkit.World;

import java.util.List;
import java.util.UUID;

/**
 * Everything Scuttle needs from a region plugin, with none of its types.
 *
 * <p>WorldGuard is a {@code softdepend}, so a server without it must still load.
 * This interface is the seam: {@link WorldGuardBridge} is the only class that
 * names a {@code com.sk89q} type, and it is only constructed once the plugin has
 * been found. Everything else — the shop gate, the claim book, the tools — talks
 * to this and would happily run against a different backend or none at all.
 *
 * <p>Implementations are called on the main thread only.
 */
public interface Regions {

    /** Where a player is, relative to a named region. */
    enum Where { INSIDE, OUTSIDE, NO_REGION }

    Where locate(Location where, String region);

    /** Middle of the region, for pointing at it. Null if it can't be found. */
    Location middle(Location near, String region);

    // ---- claims ----------------------------------------------------------

    /**
     * A claimed box, as Scuttle understands it. Coordinates are inclusive.
     *
     * <p>{@code owner} is the truth about who it belongs to and comes from the
     * region's own owner list, not from anything the model said.
     */
    record Box(String id, String world, int minX, int minY, int minZ,
               int maxX, int maxY, int maxZ, UUID owner, List<String> members) {

        public int width() {
            return maxX - minX + 1;
        }

        public int depth() {
            return maxZ - minZ + 1;
        }

        public Location centre(World world) {
            return new Location(world, (minX + maxX) / 2.0, (minY + maxY) / 2.0,
                    (minZ + maxZ) / 2.0);
        }
    }

    /** Every region anywhere whose id carries the claim prefix and this owner. */
    List<Box> claimsOf(UUID owner, String prefix);

    /** The claim a player is standing in, or null. Prefixed regions only. */
    Box claimAt(Location where, String prefix);

    /** True if a box of these bounds would touch any existing region. */
    List<String> overlaps(World world, int minX, int minY, int minZ,
                          int maxX, int maxY, int maxZ, String ignoreId);

    boolean exists(World world, String id);

    /** Creates the region, owned by this player. Returns null on success. */
    String create(World world, String id, int minX, int minY, int minZ,
                  int maxX, int maxY, int maxZ, UUID owner, String greeting);

    /** Moves an existing claim's corners. Returns null on success. */
    String reshape(World world, String id, int minX, int minY, int minZ,
                   int maxX, int maxY, int maxZ);

    String remove(World world, String id);

    /** Adds or removes a member by name. Returns null on success. */
    String setMember(World world, String id, UUID player, String name, boolean allow);
}
