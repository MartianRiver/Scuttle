package com.martianriver.scuttle.persona;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * The server lore file — a plain text file the human edits describing bases,
 * house rules, who's who, running jokes. Re-read on /scuttle reload.
 *
 * <p>SCUTTLE.md §8 calls this the highest-value-per-byte thing in the project,
 * so it gets its own class rather than being a config string.
 */
public final class Lore {

    private static final String MODULE = "lore";

    private final Path file;
    private final int maxCharacters;
    private String text = "";

    public Lore(Path dataFolder, ScuttleConfig config) {
        this.file = dataFolder.resolve(config.loreFile);
        this.maxCharacters = config.loreMaxCharacters;
        reload();
    }

    public String text() {
        return text;
    }

    public boolean isEmpty() {
        return text.isBlank();
    }

    public void reload() {
        if (!Files.isReadable(file)) {
            text = "";
            Log.debug(MODULE, "no lore file", "path", file);
            return;
        }
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8).trim();
            if (raw.length() > maxCharacters) {
                Log.warn(MODULE, "lore file truncated",
                        "length", raw.length(), "max", maxCharacters);
                raw = raw.substring(0, maxCharacters);
            }
            text = raw;
            Log.info(MODULE, "loaded", "characters", text.length());
        } catch (IOException e) {
            Log.error(MODULE, "could not read lore file", e, "path", file);
            text = "";
        }
    }

    /** Writes the starter file if none exists, so there's something to edit. */
    public void writeDefaultIfMissing() {
        if (Files.exists(file)) return;
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, DEFAULT, StandardCharsets.UTF_8);
            Log.info(MODULE, "wrote starter lore file", "path", file);
            reload();
        } catch (IOException e) {
            Log.error(MODULE, "could not write starter lore file", e, "path", file);
        }
    }

    private static final String DEFAULT = """
            # Scuttle's notebook
            #
            # Everything in this file gets read to Scuttle before it answers anything.
            # Write it like notes to a friend who just moved in. Lines starting with #
            # are ignored by nobody — Scuttle reads them too, so they work as headings.
            #
            # Run /scuttle reload after editing.

            ## The server

            (What's it called? Who plays on it? What's the vibe?)

            ## Places

            (Spawn, the nether hub, everyone's bases, that one hole someone dug.
            Coordinates help — Scuttle can tell people how far away things are.)

            ## People

            (Who's who, what they're good at, what they're building.)

            ## House rules

            (No griefing, ask before taking from the community chest, that sort of thing.)

            ## Running jokes

            (The best bit. Scuttle will use these.)
            """;
}
