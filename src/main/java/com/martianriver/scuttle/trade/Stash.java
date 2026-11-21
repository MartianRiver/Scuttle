package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Scuttle's Stash — the double chest it is very proud of, as a file.
 *
 * <p>Supply isn't actually limited yet: Scuttle will always find you one
 * eventually. What the stash changes is the price. Something it has on hand is
 * cheap because it's right there; something it hasn't costs more because it has
 * to go and get it. Selling to Scuttle puts the items in, so a kid dumping
 * cobblestone makes cobblestone cheaper for everyone — which is the bit that
 * should end up being fun.
 *
 * <p>When Scuttle can mine (SCUTTLE.md Phase 3) it fills this itself.
 */
public final class Stash {

    private static final String MODULE = "stash";

    /**
     * What Scuttle starts life owning, so the first trades aren't all markup.
     *
     * <p>No coins in here. Coal and iron ingots used to be seeded and then became
     * currency, which left the model being shown a stash full of things it would
     * refuse to sell.
     */
    private static final Map<Material, Integer> SEED = Map.of(
            Material.COBBLESTONE, 2400,
            Material.DIRT, 1200,
            Material.OAK_LOG, 512,
            Material.SAND, 640,
            Material.GRAVEL, 320,
            Material.TORCH, 384,
            Material.WHEAT, 128,
            Material.GLASS, 256,
            Material.STICK, 512,
            Material.DIAMOND, 3);

    private final Path file;
    private final Map<Material, Integer> stock = new EnumMap<>(Material.class);
    private volatile ScuttleConfig config;

    public Stash(Path dataFolder, ScuttleConfig config) {
        this.file = dataFolder.resolve("stash.yml");
        this.config = config;
        load();
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    public synchronized int stockOf(Material material) {
        return stock.getOrDefault(material, 0);
    }

    /** Scuttle hands items over. Stock floors at zero — it can still supply them. */
    public synchronized void take(Material material, int count) {
        int left = Math.max(0, stockOf(material) - count);
        if (left == 0) {
            stock.remove(material);
        } else {
            stock.put(material, left);
        }
    }

    public synchronized void add(Material material, int count) {
        if (count <= 0) return;
        stock.merge(material, count, Integer::sum);
    }

    /**
     * How much Scuttle marks the price up or down for having this in the chest.
     * Enough to notice, not enough to make the value table meaningless.
     */
    public synchronized double priceFactor(Material material, int wanted) {
        int have = stockOf(material);
        if (have >= wanted) return config.stockedDiscount;
        if (have > 0) return 1.0;
        return config.unstockedMarkup;
    }

    /**
     * The other half of that, and the one that was missing: how much less
     * Scuttle will <em>pay</em> for something it is already sick of.
     *
     * <p>Without this the feedback loop only ran one way. Dumping forty
     * thousand bones made bones cheaper to buy and did nothing at all to what
     * Scuttle would pay for the next forty thousand, so every AFK farm was an
     * unbounded income — the audit measured gunpowder and slime paying exactly
     * what a <em>mined</em> iron ingot pays, from a build-once machine.
     *
     * <p>The rule a kid can actually hold in their head: <b>full price for
     * about a backpack of anything, less after that.</b> Measured at the
     * midpoint of the sale rather than the start, so one enormous drop-off is
     * priced like the several smaller ones it could have been split into
     * instead of sneaking in under the threshold.
     */
    public synchronized double payFactor(Material material, int selling) {
        int enough = config.gluttedAt;
        if (enough <= 0) return 1.0;
        double after = stockOf(material) + selling / 2.0;
        if (after <= enough) return 1.0;
        return Math.max(config.gluttedFloor, enough / after);
    }

    /** How Scuttle describes its own supply — the model turns this into a line of chat. */
    public synchronized String describe(Material material, int wanted) {
        int have = stockOf(material);
        if (have >= wanted) return "in the stash (" + have + " on hand), so it's cheap";
        if (have > 0) return "only " + have + " in the stash, the rest has to be fetched";
        return "none in the stash, would have to go and get them";
    }

    public synchronized int kinds() {
        return stock.size();
    }

    /**
     * The chest, most-plentiful first, for the turn preamble.
     *
     * <p>Without this the model has no idea what's in stock and confidently
     * invents it — "I haven't got any diamonds right now" while three sit in
     * the chest. It used to learn stock as a side effect of {@code price_check},
     * which is exactly the round trip the preamble exists to remove.
     *
     * <p>Copies the entries rather than handing back a live view: the caller
     * formats them off the lock and the stock moves under it on every swap.
     */
    public synchronized List<Map.Entry<Material, Integer>> top(int limit) {
        return stock.entrySet().stream()
                .sorted(Map.Entry.<Material, Integer>comparingByValue(Comparator.reverseOrder()))
                .limit(limit)
                .<Map.Entry<Material, Integer>>map(e -> Map.entry(e.getKey(), e.getValue()))
                .toList();
    }

    private synchronized void load() {
        if (!file.toFile().isFile()) {
            stock.putAll(SEED);
            save();
            Log.info(MODULE, "started a new stash", "kinds", stock.size());
            return;
        }
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file.toFile());
        for (String key : yaml.getKeys(false)) {
            Material m = Material.matchMaterial(key.toUpperCase(Locale.ROOT));
            if (m == null || !m.isItem()) {
                Log.warn(MODULE, "stash names something that isn't an item", "name", key);
                continue;
            }
            int count = yaml.getInt(key, 0);
            if (count > 0) stock.put(m, count);
        }
        Log.debug(MODULE, "loaded stash", "kinds", stock.size());
    }

    public synchronized void save() {
        YamlConfiguration yaml = new YamlConfiguration();
        stock.forEach((material, count) -> yaml.set(material.name(), count));
        try {
            yaml.save(file.toFile());
        } catch (IOException e) {
            Log.error(MODULE, "could not save the stash", e, "file", file);
        }
    }
}
