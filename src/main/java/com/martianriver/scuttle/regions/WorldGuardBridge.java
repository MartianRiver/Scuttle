package com.martianriver.scuttle.regions;

import com.martianriver.scuttle.lib.Log;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.managers.RegionManager;
import com.sk89q.worldguard.protection.managers.storage.StorageException;
import com.sk89q.worldguard.protection.regions.ProtectedCuboidRegion;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import com.sk89q.worldguard.protection.regions.RegionContainer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The one class in Scuttle allowed to name a WorldGuard type.
 *
 * <p>WorldGuard is a {@code softdepend}. {@code ScuttlePlugin.regionLookup()}
 * checks the plugin is installed before constructing this, and everything else
 * sees only {@link Regions} — so a server without WorldGuard never tries to
 * resolve a {@code com.sk89q} class and never throws {@code NoClassDefFoundError}.
 * A reference to one of these types anywhere else breaks that. To check:
 *
 * <pre>javap -p -c &lt;class&gt; | grep sk89q   # this class, and nothing else</pre>
 *
 * <p>Main thread only — region changes are written to disk as they are made.
 */
public final class WorldGuardBridge implements Regions {

    private static final String MODULE = "regions";

    private final RegionContainer container;

    public WorldGuardBridge() {
        this.container = WorldGuard.getInstance().getPlatform().getRegionContainer();
    }

    // ---- the shop gate ---------------------------------------------------

    @Override
    public Where locate(Location where, String region) {
        ProtectedRegion here = region(where.getWorld(), region);
        if (here != null) {
            return here.contains(BukkitAdapter.asBlockVector(where))
                    ? Where.INSIDE : Where.OUTSIDE;
        }
        // Not defined in this world. A shop at spawn simply isn't in the Nether,
        // and standing there is outside it — but a name that exists in no world
        // at all is a typo in config.yml, which is a different problem.
        for (World world : Bukkit.getWorlds()) {
            if (region(world, region) != null) return Where.OUTSIDE;
        }
        return Where.NO_REGION;
    }

    @Override
    public Location middle(Location near, String region) {
        for (World world : worldsNearestFirst(near)) {
            ProtectedRegion found = region(world, region);
            if (found == null) continue;
            BlockVector3 min = found.getMinimumPoint();
            BlockVector3 max = found.getMaximumPoint();
            return new Location(world,
                    (min.getX() + max.getX()) / 2.0,
                    (min.getY() + max.getY()) / 2.0,
                    (min.getZ() + max.getZ()) / 2.0);
        }
        return null;
    }

    // ---- claims ----------------------------------------------------------

    @Override
    public List<Box> claimsOf(UUID owner, String prefix) {
        List<Box> out = new ArrayList<>();
        for (World world : Bukkit.getWorlds()) {
            RegionManager manager = manager(world);
            if (manager == null) continue;
            for (ProtectedRegion region : manager.getRegions().values()) {
                if (!region.getId().startsWith(prefix)) continue;
                if (!region.getOwners().contains(owner)) continue;
                out.add(box(world, region));
            }
        }
        return out;
    }

    @Override
    public Box claimAt(Location where, String prefix) {
        RegionManager manager = manager(where.getWorld());
        if (manager == null) return null;
        var applicable = manager.getApplicableRegions(BukkitAdapter.asBlockVector(where));
        for (ProtectedRegion region : applicable.getRegions()) {
            if (region.getId().startsWith(prefix)) return box(where.getWorld(), region);
        }
        return null;
    }

    @Override
    public List<String> overlaps(World world, int minX, int minY, int minZ,
                                 int maxX, int maxY, int maxZ, String ignoreId) {
        List<String> hit = new ArrayList<>();
        RegionManager manager = manager(world);
        if (manager == null) return hit;

        // A throwaway region purely to ask the question — never added to the
        // manager, so nothing is created if the answer turns out to be "no".
        ProtectedRegion probe = new ProtectedCuboidRegion("scuttle-probe",
                BlockVector3.at(minX, minY, minZ), BlockVector3.at(maxX, maxY, maxZ));
        for (ProtectedRegion region : manager.getApplicableRegions(probe).getRegions()) {
            if (!region.getId().equals(ignoreId)) hit.add(region.getId());
        }
        return hit;
    }

    @Override
    public boolean exists(World world, String id) {
        return region(world, id) != null;
    }

    @Override
    public String create(World world, String id, int minX, int minY, int minZ,
                         int maxX, int maxY, int maxZ, UUID owner, String greeting) {
        RegionManager manager = manager(world);
        if (manager == null) return "I can't put a fence round anything in this world.";

        ProtectedCuboidRegion region = new ProtectedCuboidRegion(id,
                BlockVector3.at(minX, minY, minZ), BlockVector3.at(maxX, maxY, maxZ));
        region.getOwners().addPlayer(owner);
        region.setPriority(1);
        if (greeting != null) {
            region.setFlag(Flags.GREET_MESSAGE, greeting);
            region.setFlag(Flags.FAREWELL_MESSAGE, "Leaving " + greeting.replaceAll("^[^ ]+ ", ""));
        }
        manager.addRegion(region);
        return save(manager, "create", id);
    }

    @Override
    public String reshape(World world, String id, int minX, int minY, int minZ,
                          int maxX, int maxY, int maxZ) {
        RegionManager manager = manager(world);
        ProtectedRegion existing = manager == null ? null : manager.getRegion(id);
        if (existing == null) return "I can't find that one any more.";

        // Corners are not settable on a live region in a way that reindexes it,
        // so the claim is rebuilt and swapped in carrying its owners, members
        // and flags. Losing the member list on a resize would quietly unshare
        // someone's build.
        ProtectedCuboidRegion moved = new ProtectedCuboidRegion(id,
                BlockVector3.at(minX, minY, minZ), BlockVector3.at(maxX, maxY, maxZ));
        moved.setOwners(existing.getOwners());
        moved.setMembers(existing.getMembers());
        moved.setFlags(existing.getFlags());
        moved.setPriority(existing.getPriority());

        manager.removeRegion(id);
        manager.addRegion(moved);
        return save(manager, "reshape", id);
    }

    @Override
    public String remove(World world, String id) {
        RegionManager manager = manager(world);
        if (manager == null || manager.getRegion(id) == null) {
            return "I can't find that one any more.";
        }
        manager.removeRegion(id);
        return save(manager, "remove", id);
    }

    @Override
    public String setMember(World world, String id, UUID player, String name, boolean allow) {
        RegionManager manager = manager(world);
        ProtectedRegion region = manager == null ? null : manager.getRegion(id);
        if (region == null) return "I can't find that one any more.";

        if (allow) {
            region.getMembers().addPlayer(player);
        } else {
            region.getMembers().removePlayer(player);
            // Older claims may carry a name rather than a uuid, and leaving that
            // behind would keep someone in who has just been let out.
            region.getMembers().removePlayer(name);
        }
        return save(manager, allow ? "trust" : "untrust", id);
    }

    // ---- plumbing --------------------------------------------------------

    private Box box(World world, ProtectedRegion region) {
        BlockVector3 min = region.getMinimumPoint();
        BlockVector3 max = region.getMaximumPoint();
        UUID owner = region.getOwners().getUniqueIds().stream().findFirst().orElse(null);

        List<String> members = new ArrayList<>();
        for (UUID id : region.getMembers().getUniqueIds()) {
            String name = Bukkit.getOfflinePlayer(id).getName();
            members.add(name == null ? id.toString().substring(0, 8) : name);
        }
        members.addAll(region.getMembers().getPlayers());

        return new Box(region.getId(), world.getName(),
                min.getX(), min.getY(), min.getZ(),
                max.getX(), max.getY(), max.getZ(), owner, List.copyOf(members));
    }

    private String save(RegionManager manager, String what, String id) {
        try {
            manager.saveChanges();
            return null;
        } catch (StorageException e) {
            Log.error(MODULE, "WorldGuard wouldn't save the change", e, "what", what, "id", id);
            return "something jammed writing that down — tell an adult.";
        }
    }

    private ProtectedRegion region(World world, String id) {
        RegionManager manager = manager(world);
        return manager == null ? null : manager.getRegion(id);
    }

    private RegionManager manager(World world) {
        return world == null ? null : container.get(BukkitAdapter.adapt(world));
    }

    /**
     * Their own world first. Directions across a dimension boundary are
     * meaningless, but naming the right shop still beats naming none.
     */
    private static List<World> worldsNearestFirst(Location near) {
        List<World> worlds = new ArrayList<>(Bukkit.getWorlds());
        if (near.getWorld() != null) {
            worlds.remove(near.getWorld());
            worlds.add(0, near.getWorld());
        }
        return worlds;
    }
}
