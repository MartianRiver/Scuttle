package com.martianriver.scuttle.find;

import com.martianriver.scuttle.lib.Log;
import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;

/**
 * Where things come from, for the question "where do I even look for this?".
 *
 * <p>None of this is derivable: the Bukkit API exposes recipes and registries
 * but nothing at all about world generation, so there is no way to ask the
 * server which biome a thing spawns in or how deep it sits. It's a hand-written
 * table for the same reason {@code values.yml} is, and it covers only things you
 * <em>gather</em> — anything you craft or smelt is already answered properly by
 * the recipe graph, and answering it twice is how the two drift apart.
 *
 * <p>The depths in the shipped file are defaults, not measurements. {@code
 * /scuttle survey} counts what this server's own world actually generated and
 * rewrites them, which matters because ore distribution is version-specific and
 * 26.2 is past anything that could be recalled rather than checked.
 */
public final class Sources {

    private static final String MODULE = "find";

    public record Source(String dimension, String depth, String found, String loot,
                         String mobs, String needs) {

        /** Facts for the model to put in its own words. Order is deliberate: where, then how deep, then how. */
        public String render(String item) {
            StringBuilder sb = new StringBuilder(200);
            sb.append(item).append(" — where to look:\n");
            if (dimension != null) sb.append("- dimension: ").append(dimension).append('\n');
            if (found != null) sb.append("- found: ").append(found).append('\n');
            if (depth != null) sb.append("- depth: ").append(depth).append('\n');
            if (mobs != null) sb.append("- dropped by: ").append(mobs).append('\n');
            if (loot != null) sb.append("- also in loot: ").append(loot).append('\n');
            if (needs != null) sb.append("- you'll need: ").append(needs).append('\n');
            return sb.toString();
        }
    }

    private final File file;
    // Replaced wholesale on reload rather than rebuilding the object: the tool
    // is handed this once at registration and keeps it, so swapping the field in
    // ScuttlePlugin left the tool reading the file as it was at boot.
    private volatile Map<Material, Source> sources = new EnumMap<>(Material.class);

    public Sources(File file) {
        this.file = file;
        reload();
    }

    public Source get(Material material) {
        return sources.get(material);
    }

    public int size() {
        return sources.size();
    }

    public void reload() {
        Map<Material, Source> loaded = load(file);
        sources = loaded;
        Log.info(MODULE, "loaded sources", "entries", loaded.size());
    }

    private static Map<Material, Source> load(File file) {
        Map<Material, Source> sources = new EnumMap<>(Material.class);
        if (!file.isFile()) {
            Log.warn(MODULE, "no sources.yml — 'where do I find' will fall back to recipes");
            return sources;
        }
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            Material material = Material.matchMaterial(key.toUpperCase(Locale.ROOT));
            if (material == null) {
                Log.warn(MODULE, "sources.yml names something that isn't a material", "name", key);
                continue;
            }
            ConfigurationSection section = yaml.getConfigurationSection(key);
            if (section == null) continue;
            sources.put(material, new Source(
                    section.getString("dimension"),
                    section.getString("depth"),
                    section.getString("found"),
                    section.getString("loot"),
                    section.getString("mobs"),
                    section.getString("needs")));
        }
        return sources;
    }
}
