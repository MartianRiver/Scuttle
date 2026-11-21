package com.martianriver.scuttle.tools;

import org.bukkit.Material;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Turns a phrase a nine-year-old typed into a {@link Material}.
 *
 * <p>Kids write "sticky piston", "Sticky_Piston", "pistons", "stickypiston".
 * Exact match first, then a few cheap normalisations, then a scored substring
 * search. No fuzzy edit-distance — it produces confidently wrong answers, and
 * a clean "I don't know that one" is better than the wrong block.
 */
public final class MaterialSearch {

    private MaterialSearch() {
    }

    public record Match(Material material, boolean exact) {
    }

    /** Best single match, or null. */
    public static Match find(String query) {
        List<Material> results = search(query, 1);
        if (results.isEmpty()) return null;
        return new Match(results.get(0), normalize(query).equals(results.get(0).name()));
    }

    /** Up to {@code limit} candidates, best first. */
    public static List<Material> search(String query, int limit) {
        List<Material> out = new ArrayList<>();
        if (query == null || query.isBlank()) return out;

        String normalized = normalize(query);

        Material exact = Material.matchMaterial(normalized);
        if (exact != null && exact.isItem()) {
            out.add(exact);
            if (out.size() >= limit) return out;
        }

        // "pistons" -> "piston"
        if (normalized.endsWith("S") && normalized.length() > 2) {
            Material singular = Material.matchMaterial(normalized.substring(0, normalized.length() - 1));
            if (singular != null && singular.isItem() && !out.contains(singular)) {
                out.add(singular);
                if (out.size() >= limit) return out;
            }
        }

        String squashed = normalized.replace("_", "");
        record Scored(Material material, int score) {
        }
        List<Scored> scored = new ArrayList<>();

        for (Material m : Material.values()) {
            if (m.isLegacy() || !m.isItem() || out.contains(m)) continue;
            String name = m.name();
            String nameSquashed = name.replace("_", "");

            int score;
            if (nameSquashed.equals(squashed)) score = 100;
            else if (name.startsWith(normalized)) score = 80;
            else if (name.endsWith("_" + normalized)) score = 70;
            else if (name.contains(normalized)) score = 50;
            else if (nameSquashed.contains(squashed)) score = 40;
            else continue;

            // Prefer shorter names: "PISTON" should beat "STICKY_PISTON" for "piston".
            scored.add(new Scored(m, score * 1000 - name.length()));
        }

        scored.sort(Comparator.comparingInt(Scored::score).reversed());
        for (Scored s : scored) {
            if (out.size() >= limit) break;
            out.add(s.material());
        }
        return out;
    }

    /** Human-facing name: STICKY_PISTON -> "sticky piston". */
    public static String pretty(Material material) {
        return material.name().toLowerCase(Locale.ROOT).replace('_', ' ');
    }

    private static String normalize(String query) {
        return query.trim()
                .toUpperCase(Locale.ROOT)
                .replaceAll("^(MINECRAFT:)", "")
                .replaceAll("[^A-Z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
    }
}
