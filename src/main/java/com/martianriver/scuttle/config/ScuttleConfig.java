package com.martianriver.scuttle.config;

import com.martianriver.scuttle.lib.Log;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.Sound;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;
import net.kyori.adventure.text.format.TextColor;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/** Typed view over config.yml. Rebuilt wholesale on reload — never mutated in place. */
public final class ScuttleConfig {

    private static final String MODULE = "config";

    // openrouter
    public final String apiKey;
    public final int timeoutSeconds;
    public final int maxRetries;
    public final boolean promptCaching;

    // models
    public final String modelChat;
    public final String modelAuthoring;
    public final String modelClassify;
    public final List<String> modelFallbacks;
    public final int maxReplyTokens;
    public final boolean reasoning;

    // budget
    public final double monthlyCeilingUsd;
    public final double warnAtFraction;
    public final boolean killSwitch;

    // limits
    public final int cooldownSeconds;
    public final int perMinute;
    public final int perDay;

    // trigger
    public final boolean commandEnabled;
    public final boolean nameMentionEnabled;
    public final List<String> triggerNames;
    public final int minMessageLength;
    public final int followOnSeconds;
    public final boolean followOnClassify;

    // appearance
    public final String prefix;
    public final TextColor prefixColor;
    public final TextColor nameColor;
    public final TextColor textColor;
    public final Sound speechSound;
    public final float speechVolume;
    public final float speechPitch;

    // lore
    public final String loreFile;
    public final int loreMaxCharacters;

    // history
    public final int historyWindow;
    public final int historyExpireMinutes;

    // trade
    public final boolean tradeEnabled;
    public final double tradeMargin;
    public final double stockedDiscount;
    public final double unstockedMarkup;
    public final int gluttedAt;
    public final double gluttedFloor;
    public final long tradeDailyKid;
    public final long tradeDailyParent;
    public final int tradeOfferSeconds;
    public final long faceGoldIngot;
    public final long faceIronIngot;
    public final long faceCopperNugget;
    public final boolean shopEnabled;
    public final String shopRegion;

    // claims
    public final boolean claimsEnabled;
    public final String claimPrefix;
    public final int claimDefaultBlocks;
    public final int claimMinBlocks;
    public final int claimMaxBlocks;
    public final int claimsPerKid;
    public final int claimsPerParent;
    public final int claimSpawnBuffer;
    public final boolean claimFullHeight;
    public final int claimHeightBand;
    public final int claimOfferSeconds;

    // find
    public final boolean findEnabled;
    public final int oreChunkRadius;
    public final int oreYBand;
    public final long oreBudgetMillis;
    public final int structureRadiusChunks;
    public final int biomeRadiusBlocks;
    public final int hunchSeconds;

    // guard
    public final boolean guardEnabled;
    public final String guardBotUsername;
    public final double guardShoveBlocks;
    public final double guardFightBackDamage;
    public final int guardCooldownSeconds;
    public final int guardFightTimeoutSeconds;

    // persona
    public final String readingLevel;

    // logging
    public final String logLevel;
    public final boolean auditEnabled;

    private ScuttleConfig(JavaPlugin plugin) {
        FileConfiguration c = plugin.getConfig();

        this.timeoutSeconds = c.getInt("openrouter.timeout-seconds", 45);
        this.maxRetries = c.getInt("openrouter.max-retries", 2);
        this.promptCaching = c.getBoolean("openrouter.prompt-caching", true);
        this.apiKey = resolveApiKey(plugin, c);

        this.modelChat = c.getString("models.chat", "anthropic/claude-sonnet-5");
        this.modelAuthoring = c.getString("models.authoring", "anthropic/claude-opus-5");
        this.modelClassify = c.getString("models.classify", "anthropic/claude-haiku-4.5");
        this.modelFallbacks = c.getStringList("models.fallbacks");
        this.maxReplyTokens = c.getInt("models.max-reply-tokens", 400);
        this.reasoning = c.getBoolean("models.reasoning", false);

        this.monthlyCeilingUsd = c.getDouble("budget.monthly-ceiling-usd", 25.0);
        this.warnAtFraction = c.getDouble("budget.warn-at-fraction", 0.8);
        this.killSwitch = c.getBoolean("budget.kill-switch", false);

        this.cooldownSeconds = c.getInt("limits.cooldown-seconds", 8);
        this.perMinute = c.getInt("limits.per-minute", 6);
        this.perDay = c.getInt("limits.per-day", 120);

        this.commandEnabled = c.getBoolean("trigger.command-enabled", true);
        this.nameMentionEnabled = c.getBoolean("trigger.name-mention-enabled", true);
        this.triggerNames = c.getStringList("trigger.names").stream()
                .map(s -> s.toLowerCase(Locale.ROOT))
                .toList();
        this.minMessageLength = c.getInt("trigger.min-message-length", 4);
        this.followOnSeconds = c.getInt("trigger.follow-on-seconds", 45);
        this.followOnClassify = c.getBoolean("trigger.follow-on-classify", true);

        this.prefix = c.getString("appearance.prefix", "[Scuttle]");
        this.prefixColor = color(c.getString("appearance.prefix-color"), "#5A5A5A");
        this.nameColor = color(c.getString("appearance.name-color"), "#D2691E");
        this.textColor = color(c.getString("appearance.text-color"), "#C8C3BD");
        this.speechSound = sound(c.getString("appearance.speech-sound", "BLOCK_CHAIN_STEP"));
        this.speechVolume = (float) c.getDouble("appearance.speech-volume", 0.5);
        this.speechPitch = (float) c.getDouble("appearance.speech-pitch", 1.4);

        this.loreFile = c.getString("lore.file", "lore.txt");
        this.loreMaxCharacters = c.getInt("lore.max-characters", 6000);

        this.historyWindow = c.getInt("history.window", 10);
        this.historyExpireMinutes = c.getInt("history.expire-minutes", 30);

        this.tradeEnabled = c.getBoolean("trade.enabled", true);
        this.tradeMargin = clamp(c.getDouble("trade.margin", 0.15), 0.0, 0.9);
        this.stockedDiscount = clamp(c.getDouble("trade.stocked-discount", 0.8), 0.1, 1.0);
        this.unstockedMarkup = clamp(c.getDouble("trade.unstocked-markup", 1.4), 1.0, 10.0);
        this.gluttedAt = (int) Math.max(0, c.getLong("trade.glutted-at", 2304));
        this.gluttedFloor = clamp(c.getDouble("trade.glutted-floor", 0.1), 0.0, 1.0);
        this.tradeDailyKid = c.getLong("trade.daily-allowance.kid", 100_000);
        this.tradeDailyParent = c.getLong("trade.daily-allowance.parent", 1_000_000);
        this.tradeOfferSeconds = c.getInt("trade.offer-seconds", 90);
        // Not free numbers — see Coins. Changing one without reading that
        // comment is how the currency becomes mintable.
        this.faceGoldIngot = c.getLong("trade.currency.gold-ingot", 90);
        this.faceIronIngot = c.getLong("trade.currency.iron-ingot", 40);
        this.faceCopperNugget = c.getLong("trade.currency.copper-nugget", 2);
        this.shopEnabled = c.getBoolean("trade.shop.enabled", true);
        this.shopRegion = c.getString("trade.shop.region", "scuttle-shop");

        this.claimsEnabled = c.getBoolean("claims.enabled", true);
        // Ids beginning with this are Scuttle's to manage; anything else in
        // WorldGuard is an adult's and is never touched, listed or counted.
        this.claimPrefix = c.getString("claims.prefix", "claim-");
        this.claimDefaultBlocks = (int) clamp(c.getInt("claims.default-blocks", 32), 8, 512);
        this.claimMinBlocks = (int) clamp(c.getInt("claims.min-blocks", 8), 4, 512);
        // A min above the max makes ClaimBook.clamp() return the min for every
        // request, silently ignoring max-blocks. Ordered here rather than trusted.
        this.claimMaxBlocks =
                Math.max(this.claimMinBlocks, (int) clamp(c.getInt("claims.max-blocks", 96), 8, 512));
        this.claimsPerKid = (int) clamp(c.getInt("claims.per-player", 3), 0, 100);
        this.claimsPerParent = (int) clamp(c.getInt("claims.per-player-parent", 20), 0, 500);
        this.claimSpawnBuffer = (int) clamp(c.getInt("claims.spawn-buffer", 48), 0, 10_000);
        this.claimFullHeight = c.getBoolean("claims.full-height", true);
        this.claimHeightBand = (int) clamp(c.getInt("claims.height-band", 32), 4, 384);
        this.claimOfferSeconds = (int) clamp(c.getInt("claims.offer-seconds", 90), 10, 600);

        this.findEnabled = c.getBoolean("find.enabled", true);
        this.oreChunkRadius = (int) clamp(c.getInt("find.ore-chunk-radius", 8), 1, 16);
        this.oreYBand = (int) clamp(c.getInt("find.ore-y-band", 48), 8, 384);
        this.oreBudgetMillis = (long) clamp(c.getInt("find.ore-budget-millis", 40), 5, 2000);
        // Different units, deliberately named so: the API takes chunks for one
        // and blocks for the other, and one number for both is a silent bug.
        this.structureRadiusChunks =
                (int) clamp(c.getInt("find.structure-radius-chunks", 100), 1, 500);
        this.biomeRadiusBlocks =
                (int) clamp(c.getInt("find.biome-radius-blocks", 6400), 100, 100_000);
        this.hunchSeconds = (int) clamp(c.getInt("find.hunch-seconds", 120), 10, 600);

        this.guardEnabled = c.getBoolean("guard.enabled", true);
        this.guardBotUsername = c.getString("guard.bot-username", "ScuttleMC");
        this.guardShoveBlocks = clamp(c.getDouble("guard.shove-blocks", 8), 1, 64);
        this.guardFightBackDamage = clamp(c.getDouble("guard.fight-back-damage", 2.0), 0, 20);
        this.guardCooldownSeconds = (int) clamp(c.getInt("guard.cooldown-seconds", 3), 1, 60);
        this.guardFightTimeoutSeconds =
                (int) clamp(c.getInt("guard.fight-timeout-seconds", 20), 5, 600);

        this.readingLevel = c.getString("persona.reading-level", "8-11");

        this.logLevel = c.getString("logging.level", "INFO");
        this.auditEnabled = c.getBoolean("logging.audit-enabled", true);
    }

    public static ScuttleConfig load(JavaPlugin plugin) {
        plugin.reloadConfig();
        ScuttleConfig cfg = new ScuttleConfig(plugin);
        Log.setLevel(cfg.logLevel);
        Log.debug(MODULE, "loaded",
                "chatModel", cfg.modelChat,
                "ceiling", cfg.monthlyCeilingUsd,
                "killSwitch", cfg.killSwitch);
        return cfg;
    }

    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Config value wins if set, then the named environment variable, then a
     * {@code .env} file in the plugin folder. The .env path is what the setup
     * docs tell people to use, so a missing key is almost always that file.
     */
    private static String resolveApiKey(JavaPlugin plugin, FileConfiguration c) {
        String fromConfig = c.getString("openrouter.api-key", "");
        if (fromConfig != null && !fromConfig.isBlank()) return fromConfig.trim();

        String envName = c.getString("openrouter.api-key-env", "OPENROUTER_API_KEY");
        String fromEnv = System.getenv(envName);
        if (fromEnv != null && !fromEnv.isBlank()) return fromEnv.trim();

        return readDotEnv(plugin.getDataFolder().toPath().resolve(".env"), envName);
    }

    private static String readDotEnv(Path envPath, String key) {
        if (!Files.isReadable(envPath)) return null;
        try (BufferedReader r = Files.newBufferedReader(envPath, StandardCharsets.UTF_8)) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int eq = line.indexOf('=');
                if (eq <= 0) continue;
                if (!line.substring(0, eq).trim().equals(key)) continue;
                String value = line.substring(eq + 1).trim();
                // tolerate KEY="value" and KEY='value'
                if (value.length() >= 2
                        && (value.startsWith("\"") && value.endsWith("\"")
                        || value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1);
                }
                return value.isBlank() ? null : value;
            }
        } catch (IOException e) {
            Log.warn(MODULE, "could not read .env", "path", envPath, "error", e.getMessage());
        }
        return null;
    }

    /** A mistyped price multiplier should be dull, not catastrophic. */
    private static double clamp(double value, double min, double max) {
        return Math.min(max, Math.max(min, value));
    }

    private static TextColor color(String raw, String fallback) {
        TextColor parsed = TextColor.fromHexString(raw == null ? fallback : raw.trim());
        if (parsed != null) return parsed;
        Log.warn(MODULE, "bad colour, using default", "value", raw, "default", fallback);
        return TextColor.fromHexString(fallback);
    }

    /**
     * Sound stopped being an enum, so this goes through the registry. Config
     * holds the friendly constant name (BLOCK_CHAIN_STEP), the registry wants
     * a namespaced key (block.chain.step).
     */
    private static Sound sound(String raw) {
        String name = raw == null ? "" : raw.trim();
        String key = name.toLowerCase(Locale.ROOT).replace('_', '.');
        Sound found = Registry.SOUNDS.get(NamespacedKey.minecraft(key));
        if (found != null) return found;
        Log.warn(MODULE, "unknown speech-sound, falling back", "value", raw);
        return Registry.SOUNDS.get(NamespacedKey.minecraft("block.chain.step"));
    }
}
