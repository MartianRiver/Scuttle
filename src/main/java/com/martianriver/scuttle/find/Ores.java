package com.martianriver.scuttle.find;

import com.martianriver.scuttle.tools.MaterialSearch;
import org.bukkit.Material;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * "diamond" means two blocks, not one — every ore has a deepslate twin, and gold
 * has a nether variant on top. A kid says "diamond" and means all of them.
 */
public final class Ores {

    private Ores() {
    }

    public record Ore(String label, Set<Material> blocks) {
    }

    private static final Map<String, Ore> BY_NAME = new LinkedHashMap<>();

    private static void put(String name, Material... blocks) {
        BY_NAME.put(name, new Ore(name, Set.of(blocks)));
    }

    static {
        put("diamond", Material.DIAMOND_ORE, Material.DEEPSLATE_DIAMOND_ORE);
        put("iron", Material.IRON_ORE, Material.DEEPSLATE_IRON_ORE);
        put("gold", Material.GOLD_ORE, Material.DEEPSLATE_GOLD_ORE, Material.NETHER_GOLD_ORE);
        put("copper", Material.COPPER_ORE, Material.DEEPSLATE_COPPER_ORE);
        put("coal", Material.COAL_ORE, Material.DEEPSLATE_COAL_ORE);
        put("redstone", Material.REDSTONE_ORE, Material.DEEPSLATE_REDSTONE_ORE);
        put("lapis", Material.LAPIS_ORE, Material.DEEPSLATE_LAPIS_ORE);
        put("emerald", Material.EMERALD_ORE, Material.DEEPSLATE_EMERALD_ORE);
        put("quartz", Material.NETHER_QUARTZ_ORE);
        put("ancient debris", Material.ANCIENT_DEBRIS);
        put("amethyst", Material.AMETHYST_CLUSTER, Material.BUDDING_AMETHYST);
    }

    /** Every ore Scuttle will sniff for, for the tool description and the survey. */
    public static Map<String, Ore> all() {
        return BY_NAME;
    }

    public static Ore resolve(String query) {
        if (query == null || query.isBlank()) return null;
        String q = query.trim().toLowerCase(Locale.ROOT).replace('_', ' ')
                .replaceAll("\\s+(ore|ores|blocks?)$", "")
                .replaceAll("^(some|any|the|nearest|closest)\\s+", "")
                .trim();

        Ore direct = BY_NAME.get(q);
        if (direct != null) return direct;
        if (q.endsWith("s") && BY_NAME.containsKey(q.substring(0, q.length() - 1))) {
            return BY_NAME.get(q.substring(0, q.length() - 1));
        }
        // "netherite" is what a kid actually wants; the block is called something else.
        if (q.contains("netherite")) return BY_NAME.get("ancient debris");
        if (q.contains("lapis")) return BY_NAME.get("lapis");

        // Last resort: let them name the block itself, e.g. "deepslate diamond ore".
        MaterialSearch.Match match = MaterialSearch.find(query);
        if (match != null) {
            for (Ore ore : BY_NAME.values()) {
                if (ore.blocks().contains(match.material())) return ore;
            }
        }
        return null;
    }
}
