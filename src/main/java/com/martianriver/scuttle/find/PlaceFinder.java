package com.martianriver.scuttle.find;

import com.martianriver.scuttle.lib.Log;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.generator.structure.Structure;
import org.bukkit.util.BiomeSearchResult;
import org.bukkit.util.StructureSearchResult;

/**
 * The other half of finding things: the bits the server can locate properly.
 *
 * <p>Structures and biomes go through the same code vanilla's {@code /locate}
 * uses, so unlike {@link OreScan} this works at range and doesn't care what's
 * loaded. Hence the split in Scuttle's character — it <em>knows</em> where
 * places are and has to <em>smell</em> for ore.
 *
 * <p>Main thread only.
 */
public final class PlaceFinder {

    private static final String MODULE = "find";

    private PlaceFinder() {
    }

    /**
     * The two locators do not take the same units — {@code locateNearestStructure}
     * counts chunks and {@code locateNearestBiome} counts blocks. Passing one
     * number to both is a silent factor-of-sixteen bug, so they're separate.
     */
    public static Find find(Location from, PlaceSearch.Place place,
                            int structureChunks, int biomeBlocks) {
        World world = from.getWorld();
        if (world == null || place == null || place.isEmpty()) return null;

        Location best = null;
        for (Structure structure : place.structures()) {
            StructureSearchResult result =
                    world.locateNearestStructure(from, structure, structureChunks, false);
            if (result == null) continue;
            if (best == null || result.getLocation().distanceSquared(from) < best.distanceSquared(from)) {
                best = result.getLocation();
            }
        }

        if (best == null && !place.biomes().isEmpty()) {
            // Cave biomes are underground, so the vertical step has to be small
            // enough to actually land in one — the default sampling walks the
            // surface and misses them entirely.
            BiomeSearchResult result = world.locateNearestBiome(from, biomeBlocks, 32, 32,
                    place.biomes().toArray(new Biome[0]));
            if (result != null) best = result.getLocation();
        }

        Log.debug(MODULE, "place search", "for", place.label(), "found", best != null);
        if (best == null) return null;

        // The locator answers in surface coordinates for structures that are
        // buried; leave Y alone rather than pretending to know how deep it sits.
        return new Find(place.label(), best, Bearing.describe(from, best), noteFor(place));
    }

    private static String noteFor(PlaceSearch.Place place) {
        for (Biome biome : place.biomes()) {
            if (biome.getKey().getKey().equals("deep_dark")) {
                return "That's the deep dark — warden country. Say so.";
            }
        }
        for (Structure structure : place.structures()) {
            String key = structure.getKey().getKey();
            if (key.equals("ancient_city")) return "Ancient city — wardens. Warn them properly.";
            if (key.equals("mansion") || key.equals("fortress") || key.equals("bastion_remnant")) {
                return "That's a dangerous one for a kid on their own. Mention it.";
            }
        }
        return null;
    }
}
