package com.martianriver.scuttle.safety;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.YearMonth;
import java.util.Properties;

/**
 * Tracks real spend (OpenRouter reports the cost of every call) against the
 * monthly ceiling, and trips a kill switch when it runs out.
 *
 * <p>Persisted to disk so a restart doesn't reset the month's spending.
 */
public final class BudgetTracker {

    private static final String MODULE = "budget";

    private final Path stateFile;
    private ScuttleConfig config;

    private YearMonth month = YearMonth.now();
    private double spentUsd = 0.0;
    private boolean warned = false;

    public BudgetTracker(Path dataFolder, ScuttleConfig config) {
        this.stateFile = dataFolder.resolve("budget.properties");
        this.config = config;
        load();
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    /** True when Scuttle should stay quiet — manual switch or out of money. */
    public synchronized boolean isSilenced() {
        rolloverMonthIfNeeded();
        return config.killSwitch || spentUsd >= config.monthlyCeilingUsd;
    }

    public synchronized String silenceReason() {
        if (config.killSwitch) return "kill switch is on";
        if (spentUsd >= config.monthlyCeilingUsd) return "monthly budget spent";
        return "";
    }

    public synchronized void record(double costUsd) {
        if (costUsd <= 0) return;
        rolloverMonthIfNeeded();
        spentUsd += costUsd;

        double fraction = spentUsd / Math.max(0.0001, config.monthlyCeilingUsd);
        if (!warned && fraction >= config.warnAtFraction) {
            warned = true;
            Log.warn(MODULE, "approaching monthly ceiling",
                    "spent", round(spentUsd), "ceiling", config.monthlyCeilingUsd);
        }
        if (spentUsd >= config.monthlyCeilingUsd) {
            Log.warn(MODULE, "monthly ceiling reached — Scuttle is going quiet",
                    "spent", round(spentUsd), "ceiling", config.monthlyCeilingUsd);
        }
        save();
    }

    public synchronized double spent() {
        rolloverMonthIfNeeded();
        return spentUsd;
    }

    public synchronized double remaining() {
        return Math.max(0.0, config.monthlyCeilingUsd - spent());
    }

    private void rolloverMonthIfNeeded() {
        YearMonth now = YearMonth.now();
        if (!now.equals(month)) {
            Log.info(MODULE, "new month, resetting spend",
                    "previous", month.toString(), "previousSpend", round(spentUsd));
            month = now;
            spentUsd = 0.0;
            warned = false;
            save();
        }
    }

    private void load() {
        if (!Files.isReadable(stateFile)) return;
        Properties p = new Properties();
        try (var in = Files.newBufferedReader(stateFile, StandardCharsets.UTF_8)) {
            p.load(in);
            YearMonth stored = YearMonth.parse(p.getProperty("month", month.toString()));
            if (stored.equals(YearMonth.now())) {
                month = stored;
                spentUsd = Double.parseDouble(p.getProperty("spent", "0"));
                warned = Boolean.parseBoolean(p.getProperty("warned", "false"));
            }
            Log.debug(MODULE, "loaded spend state", "month", month, "spent", round(spentUsd));
        } catch (IOException | RuntimeException e) {
            Log.warn(MODULE, "could not read budget state, starting from zero",
                    "error", e.getMessage());
        }
    }

    private void save() {
        Properties p = new Properties();
        p.setProperty("month", month.toString());
        p.setProperty("spent", Double.toString(spentUsd));
        p.setProperty("warned", Boolean.toString(warned));
        try {
            Files.createDirectories(stateFile.getParent());
            try (var out = Files.newBufferedWriter(stateFile, StandardCharsets.UTF_8)) {
                p.store(out, "Scuttle spend tracking - do not edit while the server is running");
            }
        } catch (IOException e) {
            Log.error(MODULE, "could not save budget state", e);
        }
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
