package com.martianriver.scuttle.lib;

import java.util.Locale;
import java.util.logging.Logger;

/**
 * Levels are TRACE / DEBUG / INFO / WARN / ERROR, controlled by one config key
 * ({@code log-level}). Output goes to the server console, which is the viewer —
 * there's no in-game log UI.
 */
public final class Log {

    public enum Level {
        TRACE, DEBUG, INFO, WARN, ERROR;

        static Level parse(String raw, Level fallback) {
            if (raw == null) return fallback;
            try {
                return valueOf(raw.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                return fallback;
            }
        }
    }

    private static Logger logger = Logger.getLogger("Scuttle");
    private static Level threshold = Level.INFO;

    private Log() {
    }

    public static void bind(Logger pluginLogger) {
        logger = pluginLogger;
    }

    public static void setLevel(String raw) {
        threshold = Level.parse(raw, Level.INFO);
    }

    public static Level level() {
        return threshold;
    }

    public static void trace(String module, String message, Object... data) {
        log(Level.TRACE, module, message, null, data);
    }

    public static void debug(String module, String message, Object... data) {
        log(Level.DEBUG, module, message, null, data);
    }

    public static void info(String module, String message, Object... data) {
        log(Level.INFO, module, message, null, data);
    }

    public static void warn(String module, String message, Object... data) {
        log(Level.WARN, module, message, null, data);
    }

    public static void error(String module, String message, Throwable t, Object... data) {
        log(Level.ERROR, module, message, t, data);
    }

    private static void log(Level level, String module, String message, Throwable t, Object... data) {
        if (level.ordinal() < threshold.ordinal()) return;

        StringBuilder sb = new StringBuilder(64);
        sb.append('[').append(level).append("] [").append(module).append("] ").append(message);
        appendData(sb, data);

        String line = sb.toString();
        switch (level) {
            case ERROR -> {
                if (t != null) logger.severe(line + " " + t);
                else logger.severe(line);
                if (t != null) t.printStackTrace();
            }
            case WARN -> logger.warning(line);
            default -> logger.info(line);
        }
    }

    /** Renders varargs as {@code {key=value, key=value}}; odd trailing arg is ignored. */
    private static void appendData(StringBuilder sb, Object... data) {
        if (data == null || data.length < 2) return;
        sb.append(" {");
        for (int i = 0; i + 1 < data.length; i += 2) {
            if (i > 0) sb.append(", ");
            sb.append(data[i]).append('=').append(data[i + 1]);
        }
        sb.append('}');
    }
}
