package com.martianriver.scuttle.find;

import com.martianriver.scuttle.lib.Log;
import org.bukkit.Chunk;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;

import java.util.Set;

/**
 * Looks for ore in the chunks already loaded around a player.
 *
 * <p>There is no ore-locating API — vanilla's {@code /locate} only knows
 * structures and biomes — so this reads blocks. That means it can only see
 * chunks the server already has in memory, which caps it at roughly the render
 * distance and is the reason Scuttle can't simply be asked for the nearest
 * diamond in the world.
 *
 * <p>That limit turned out to be worth keeping. Scuttle knows the map but has to
 * <em>sniff</em> for ore, so a kid still has to go and explore; what they're
 * saved is the last tedious stretch of strip mining, which is the same line the
 * trading sits on.
 *
 * <p>Main thread only. It stays affordable by expanding a ring at a time and
 * stopping as soon as no unscanned chunk could hold anything closer, and by only
 * looking within a band of Y either side of the player rather than the whole
 * column — a kid asking where the diamonds are is almost always already down
 * there. A wall-clock budget backstops both.
 */
public final class OreScan {

    private static final String MODULE = "find";

    private OreScan() {
    }

    public static Find nearest(Location from, Set<Material> targets, String label,
                               int chunkRadius, int yBand, long budgetMillis) {
        World world = from.getWorld();
        if (world == null || targets.isEmpty()) return null;

        long deadline = System.nanoTime() + budgetMillis * 1_000_000L;
        int originX = from.getBlockX() >> 4;
        int originZ = from.getBlockZ() >> 4;
        int minY = Math.max(world.getMinHeight(), from.getBlockY() - yBand);
        int maxY = Math.min(world.getMaxHeight() - 1, from.getBlockY() + yBand);

        Location best = null;
        double bestSq = Double.MAX_VALUE;
        int chunksRead = 0;
        boolean ranOut = false;

        for (int ring = 0; ring <= chunkRadius; ring++) {
            // Nothing in this ring or beyond can beat what we have: the closest a
            // block in it could possibly be is the near edge of its chunks.
            double ringFloor = (double) (ring - 1) * 16;
            if (best != null && ringFloor * ringFloor > bestSq) break;
            if (System.nanoTime() > deadline) {
                ranOut = true;
                break;
            }

            for (int cx = originX - ring; cx <= originX + ring; cx++) {
                for (int cz = originZ - ring; cz <= originZ + ring; cz++) {
                    // Only the edge of the square is new; the inside was ring-1.
                    if (ring > 0 && Math.abs(cx - originX) != ring && Math.abs(cz - originZ) != ring) {
                        continue;
                    }
                    if (!world.isChunkLoaded(cx, cz)) continue;

                    Chunk chunk = world.getChunkAt(cx, cz);
                    ChunkSnapshot snap = chunk.getChunkSnapshot(false, false, false);
                    chunksRead++;

                    for (int x = 0; x < 16; x++) {
                        for (int z = 0; z < 16; z++) {
                            for (int y = minY; y <= maxY; y++) {
                                if (!targets.contains(snap.getBlockType(x, y, z))) continue;
                                int wx = (cx << 4) + x;
                                int wz = (cz << 4) + z;
                                double dsq = distanceSq(from, wx, y, wz);
                                if (dsq < bestSq) {
                                    bestSq = dsq;
                                    best = new Location(world, wx + 0.5, y, wz + 0.5);
                                }
                            }
                        }
                    }
                }
            }
        }

        Log.debug(MODULE, "ore scan", "for", label, "chunks", chunksRead,
                "found", best != null, "budgetHit", ranOut);

        if (best == null) return null;
        return new Find(label, best, Bearing.describe(from, best));
    }

    private static double distanceSq(Location from, int x, int y, int z) {
        double dx = x + 0.5 - from.getX();
        double dy = y - from.getY();
        double dz = z + 0.5 - from.getZ();
        return dx * dx + dy * dy + dz * dz;
    }
}
