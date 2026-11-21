package com.martianriver.scuttle.log;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;

import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * One file per day of everything Scuttle was asked and said, plus what each
 * exchange cost.
 *
 * <p>Framing from SCUTTLE.md §11: this is for debugging, cost attribution and
 * tuning the persona — and because it will be funny to read back. It is not
 * surveillance of the kids, and it lives somewhere the human can open without
 * SSH-ing anywhere.
 */
public final class AuditLog {

    private static final String MODULE = "audit";
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

    private final Path folder;
    private volatile boolean enabled;

    public AuditLog(Path dataFolder, ScuttleConfig config) {
        this.folder = dataFolder.resolve("audit");
        this.enabled = config.auditEnabled;
    }

    public void updateConfig(ScuttleConfig config) {
        this.enabled = config.auditEnabled;
    }

    /** Called from the async turn thread, so it takes the write hit off the server. */
    public synchronized void exchange(String player, String question, String answer,
                                      List<String> toolCalls, String model,
                                      int promptTokens, int completionTokens, int cachedTokens,
                                      double costUsd, long millis) {
        if (!enabled) return;

        StringBuilder sb = new StringBuilder(512);
        sb.append(LocalTime.now().format(TIME)).append("  ").append(player).append('\n');
        sb.append("  asked : ").append(oneLine(question)).append('\n');
        for (String call : toolCalls) {
            sb.append("  tool  : ").append(oneLine(call)).append('\n');
        }
        sb.append("  said  : ").append(oneLine(answer)).append('\n');
        sb.append("  cost  : $").append(String.format("%.5f", costUsd))
                .append("  ").append(promptTokens).append("+").append(completionTokens)
                .append(" tokens");
        if (cachedTokens > 0) {
            sb.append(" (").append(cachedTokens).append(" cached)");
        }
        sb.append("  ").append(model).append("  ").append(millis).append("ms\n\n");

        append(sb.toString());
    }

    /** Every swap that actually moved items, so a disputed trade can be settled. */
    public synchronized void trade(String player, String summary, long cost) {
        if (!enabled) return;
        append(LocalTime.now().format(TIME) + "  " + player + '\n'
                + "  traded: " + oneLine(summary) + "  (" + cost + " credits)\n\n");
    }

    /**
     * Anything that changed the world and wasn't a trade — land, mostly.
     *
     * <p>Worth a line each because "who fenced this off, and when" is exactly
     * the argument an adult gets asked to settle a fortnight later.
     */
    public synchronized void note(String player, String what) {
        if (!enabled) return;
        append(LocalTime.now().format(TIME) + "  " + player + '\n'
                + "  did   : " + oneLine(what) + "\n\n");
    }

    /** Refusals cost nothing but are worth seeing — they're usually a config problem. */
    public synchronized void refusal(String player, String question, String reason) {
        if (!enabled) return;
        append(LocalTime.now().format(TIME) + "  " + player + '\n'
                + "  asked : " + oneLine(question) + '\n'
                + "  refused: " + reason + "\n\n");
    }

    private void append(String text) {
        Path file = folder.resolve("scuttle-" + LocalDate.now() + ".log");
        try {
            Files.createDirectories(folder);
            try (Writer w = Files.newBufferedWriter(file, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
                w.write(text);
            }
        } catch (IOException e) {
            Log.error(MODULE, "could not write audit entry", e, "file", file);
        }
    }

    private static String oneLine(String s) {
        if (s == null) return "";
        return s.replace('\n', ' ').replace('\r', ' ').trim();
    }
}
