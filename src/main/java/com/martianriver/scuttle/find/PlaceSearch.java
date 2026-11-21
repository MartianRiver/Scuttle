package com.martianriver.scuttle.find;

import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.block.Biome;
import org.bukkit.generator.structure.Structure;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Turns "a lush cave", "the nearest village", "a desert" into things the server
 * can actually look for.
 *
 * <p>Both registries are searched, because from a kid's point of view a mineshaft
 * and a jungle are the same kind of question. One friendly word often covers
 * several registry entries — "village" is five, "ruined portal" is seven — so a
 * resolved place is a list, and the finder takes whichever turns up nearest.
 *
 * <p>{@link Structure} and {@link Biome} both stopped being enums, the same way
 * {@code Sound} did, so everything here goes through {@link Registry}.
 */
public final class PlaceSearch {

    private PlaceSearch() {
    }

    public record Place(String label, List<Structure> structures, List<Biome> biomes) {
        public boolean isEmpty() {
            return structures.isEmpty() && biomes.isEmpty();
        }
    }

    /** Words worth spelling out, either because they group entries or because a kid's word isn't the game's. */
    private static final Map<String, String[]> STRUCTURE_ALIASES = new LinkedHashMap<>();
    private static final Map<String, String[]> BIOME_ALIASES = new LinkedHashMap<>();

    static {
        STRUCTURE_ALIASES.put("mineshaft", new String[]{"mineshaft", "mineshaft_mesa"});
        STRUCTURE_ALIASES.put("abandoned mineshaft", new String[]{"mineshaft", "mineshaft_mesa"});
        STRUCTURE_ALIASES.put("village", new String[]{"village_plains", "village_desert",
                "village_savanna", "village_snowy", "village_taiga"});
        STRUCTURE_ALIASES.put("ruined portal", new String[]{"ruined_portal", "ruined_portal_desert",
                "ruined_portal_jungle", "ruined_portal_mountain", "ruined_portal_ocean",
                "ruined_portal_swamp", "ruined_portal_nether"});
        STRUCTURE_ALIASES.put("shipwreck", new String[]{"shipwreck", "shipwreck_beached"});
        STRUCTURE_ALIASES.put("ocean ruin", new String[]{"ocean_ruin_cold", "ocean_ruin_warm"});
        STRUCTURE_ALIASES.put("ocean monument", new String[]{"monument"});
        STRUCTURE_ALIASES.put("guardian temple", new String[]{"monument"});
        STRUCTURE_ALIASES.put("woodland mansion", new String[]{"mansion"});
        STRUCTURE_ALIASES.put("nether fortress", new String[]{"fortress"});
        STRUCTURE_ALIASES.put("witch hut", new String[]{"swamp_hut"});
        STRUCTURE_ALIASES.put("desert temple", new String[]{"desert_pyramid"});
        STRUCTURE_ALIASES.put("jungle temple", new String[]{"jungle_pyramid"});
        STRUCTURE_ALIASES.put("outpost", new String[]{"pillager_outpost"});
        STRUCTURE_ALIASES.put("trial chamber", new String[]{"trial_chambers"});

        BIOME_ALIASES.put("cave", new String[]{"lush_caves", "dripstone_caves"});
        BIOME_ALIASES.put("caves", new String[]{"lush_caves", "dripstone_caves"});
        BIOME_ALIASES.put("mining cave", new String[]{"lush_caves", "dripstone_caves"});
        BIOME_ALIASES.put("lush cave", new String[]{"lush_caves"});
        BIOME_ALIASES.put("dripstone cave", new String[]{"dripstone_caves"});
        BIOME_ALIASES.put("mushroom island", new String[]{"mushroom_fields"});
        BIOME_ALIASES.put("ice spikes", new String[]{"ice_spikes"});
    }

    public static Place resolve(String query) {
        if (query == null || query.isBlank()) return null;
        String q = query.trim().toLowerCase(Locale.ROOT).replace('_', ' ')
                .replaceAll("^(the|a|an|nearest|closest|some)\\s+", "")
                .replaceAll("\\s+", " ");

        String[] keys = STRUCTURE_ALIASES.get(q);
        if (keys != null) return new Place(q, structures(keys), List.of());
        keys = BIOME_ALIASES.get(q);
        if (keys != null) return new Place(q, List.of(), biomes(keys));

        // Singular/plural is the usual miss: "caves", "villages".
        if (q.endsWith("s")) {
            String singular = q.substring(0, q.length() - 1);
            if (STRUCTURE_ALIASES.containsKey(singular)) {
                return new Place(singular, structures(STRUCTURE_ALIASES.get(singular)), List.of());
            }
            if (BIOME_ALIASES.containsKey(singular)) {
                return new Place(singular, List.of(), biomes(BIOME_ALIASES.get(singular)));
            }
        }

        Structure structure = scan(Registry.STRUCTURE, q);
        if (structure != null) return new Place(pretty(structure.getKey()), List.of(structure), List.of());

        Biome biome = scan(Registry.BIOME, q);
        if (biome != null) return new Place(pretty(biome.getKey()), List.of(), List.of(biome));

        return null;
    }

    /** Exact key first, then whole-word contains — same reasoning as MaterialSearch: no edit distance. */
    private static <T extends org.bukkit.Keyed> T scan(Registry<T> registry, String query) {
        String underscored = query.replace(' ', '_');
        T exact = registry.get(NamespacedKey.minecraft(underscored));
        if (exact != null) return exact;

        T best = null;
        int bestLength = Integer.MAX_VALUE;
        for (T entry : registry) {
            String key = entry.getKey().getKey();
            if (!key.contains(underscored)) continue;
            if (key.length() < bestLength) {
                best = entry;
                bestLength = key.length();
            }
        }
        return best;
    }

    private static List<Structure> structures(String[] keys) {
        List<Structure> out = new ArrayList<>(keys.length);
        for (String key : keys) {
            Structure s = Registry.STRUCTURE.get(NamespacedKey.minecraft(key));
            if (s != null) out.add(s);
        }
        return out;
    }

    private static List<Biome> biomes(String[] keys) {
        List<Biome> out = new ArrayList<>(keys.length);
        for (String key : keys) {
            Biome b = Registry.BIOME.get(NamespacedKey.minecraft(key));
            if (b != null) out.add(b);
        }
        return out;
    }

    public static String pretty(NamespacedKey key) {
        return key.getKey().replace('_', ' ');
    }
}
