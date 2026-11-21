package com.martianriver.scuttle.persona;

import com.martianriver.scuttle.agent.WorldContext;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Assembles the system prompt: character, reading level, the lore file, then
 * the §8 context block.
 *
 * <p>The character text lives in {@code persona.txt} rather than in Java so the
 * chat lab in {@code chatlab/} can read exactly the same words. Two copies of a
 * personality would drift apart within a week.
 */
public final class PersonaBuilder {

    private static final String MODULE = "persona";
    private static final String RESOURCE = "/persona.txt";

    private final ScuttleConfig config;
    private final Lore lore;
    private final Map<String, String> sections;

    public PersonaBuilder(ScuttleConfig config, Lore lore) {
        this.config = config;
        this.lore = lore;
        this.sections = loadSections();
    }

    /** Stable across a turn and across players — the cacheable half of the prompt. */
    public String systemPrompt() {
        StringBuilder sb = new StringBuilder(2048);
        sb.append(sections.getOrDefault("character", "You are Scuttle, a talking coal scuttle."));
        sb.append("\n\nWHO YOU'RE TALKING TO\n").append(audience());
        if (!lore.isEmpty()) {
            sb.append("\n\nWHAT YOU KNOW ABOUT THIS SERVER\n");
            sb.append("These are your own notes. Use them. Mention places and people by name.\n\n");
            sb.append(lore.text());
        }
        return sb.toString();
    }

    /** The volatile half: where this player is standing, right now. */
    public String contextPrompt(WorldContext context) {
        return context.render();
    }

    private String audience() {
        String key = "audience:" + (config.readingLevel == null ? "8-11" : config.readingLevel);
        String block = sections.get(key);
        if (block != null) return block;
        Log.warn(MODULE, "unknown reading-level, using 8-11", "value", config.readingLevel);
        return sections.getOrDefault("audience:8-11", "Children. Keep it simple.");
    }

    /** Splits persona.txt on [[section]] markers, dropping # comment lines. */
    private static Map<String, String> loadSections() {
        Map<String, String> out = new HashMap<>();
        try (InputStream in = PersonaBuilder.class.getResourceAsStream(RESOURCE)) {
            if (in == null) {
                Log.error(MODULE, "persona.txt missing from the jar", null);
                return out;
            }
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String current = null;
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("#")) continue;
                if (line.startsWith("[[") && line.trim().endsWith("]]")) {
                    if (current != null) out.put(current, body.toString().trim());
                    current = line.trim().substring(2, line.trim().length() - 2);
                    body.setLength(0);
                    continue;
                }
                if (current != null) body.append(line).append('\n');
            }
            if (current != null) out.put(current, body.toString().trim());
        } catch (IOException e) {
            Log.error(MODULE, "could not read persona.txt", e);
        }
        Log.debug(MODULE, "loaded persona", "sections", out.size());
        return out;
    }
}
