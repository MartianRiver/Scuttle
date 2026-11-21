package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.IOException;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Holds the one offer a player is currently deciding about, and does the swap
 * when they say yes.
 *
 * <p>The model never moves an item. It proposes, {@link TradeGuard} judges, this
 * parks the result, and nothing happens until the player themselves accepts.
 * Between the offer and the yes their inventory can change, so everything is
 * checked again at the moment of execution rather than trusted from before.
 */
public final class TradeDesk {

    private static final String MODULE = "trade";

    private final Path spendFile;
    private final Stash stash;
    private final TradeGuard guard;
    private final Coins coins;
    private final Shop shop;
    private final Map<UUID, Offer> pending = new ConcurrentHashMap<>();
    // When each offer went on the table. Kept beside the offer rather than in it
    // because it answers a question about chat routing, not about the trade:
    // land and goods can both be pending, and a bare "yes" means the newer one.
    private final Map<UUID, Long> pendingSince = new ConcurrentHashMap<>();
    private final Map<UUID, Long> spentToday = new ConcurrentHashMap<>();
    private volatile LocalDate spendDate = LocalDate.now();
    private volatile ScuttleConfig config;

    public TradeDesk(Path dataFolder, Stash stash, TradeGuard guard, Coins coins,
                     Shop shop, ScuttleConfig config) {
        this.spendFile = dataFolder.resolve("trades.yml");
        this.stash = stash;
        this.guard = guard;
        this.coins = coins;
        this.shop = shop;
        this.config = config;
        loadSpend();
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    public ItemValues values() {
        return guard.values();
    }

    public Stash stash() {
        return stash;
    }

    public TradeGuard guard() {
        return guard;
    }

    public Coins coins() {
        return coins;
    }

    public Shop shop() {
        return shop;
    }

    public long spentToday(UUID player) {
        rollDate();
        return spentToday.getOrDefault(player, 0L);
    }

    public long allowance(Tier tier) {
        return tier.isAtLeast(Tier.PARENT) ? config.tradeDailyParent : config.tradeDailyKid;
    }

    /**
     * What they've still got to spend today.
     *
     * <p>Spending only — selling a haul deliberately doesn't count against it.
     * It used to, which meant cashing in a big morning's mining could leave a
     * kid unable to buy the thing they dug it up for, and "you've moved too
     * much value today" is not a sentence that means anything to a nine-year-old
     * holding a bag of coins.
     */
    public long allowanceLeft(Player player) {
        return Math.max(0, allowance(Tier.of(player)) - spentToday(player.getUniqueId()));
    }

    /** The live offer for this player, or null if there isn't one or it went stale. */
    public Offer pendingFor(UUID player) {
        Offer offer = pending.get(player);
        if (offer == null) return null;
        if (offer.expired(System.currentTimeMillis())) {
            pending.remove(player);
            pendingSince.remove(player);
            return null;
        }
        return offer;
    }

    /** Replaces any previous offer — Scuttle only ever has one thing on the table. */
    public Offer sell(UUID player, Material item, int count, long credits) {
        return park(player, new Offer.Purchase(player, item, count, credits, deadline()));
    }

    public Offer buyHaul(UUID player, Map<Material, Integer> goods, long credits) {
        return park(player, new Offer.HaulSale(player, Map.copyOf(goods), credits, deadline()));
    }

    private Offer park(UUID player, Offer offer) {
        pending.put(player, offer);
        pendingSince.put(player, System.currentTimeMillis());
        return offer;
    }

    /** When the current offer was parked, or 0. Used to break yes/no ties. */
    public long pendingSince(UUID player) {
        return pendingFor(player) == null ? 0L : pendingSince.getOrDefault(player, 0L);
    }

    private long deadline() {
        return System.currentTimeMillis() + config.tradeOfferSeconds * 1000L;
    }

    public void clear(UUID player) {
        pending.remove(player);
        pendingSince.remove(player);
    }

    public enum Result {
        DONE, EXPIRED, GONE, NO_ROOM, NO_COINS, OUTSIDE_SHOP, OVER_ALLOWANCE, NOTHING_PENDING
    }

    /**
     * Executes the pending offer. Main thread only.
     *
     * <p>Everything is re-checked here rather than trusted from when the offer
     * was made — a kid has the whole offer window to spend their coins or stuff
     * half the haul into a chest. Take first, then give; if the give somehow
     * fails the items land at their feet rather than vanishing.
     */
    public Result accept(Player player) {
        UUID id = player.getUniqueId();
        Offer offer = pendingFor(id);
        if (offer == null) {
            return pending.containsKey(id) ? Result.EXPIRED : Result.NOTHING_PENDING;
        }
        // Checked again here and not only when the offer was made: the whole
        // point of the escrow is that walking out of the shop between the offer
        // and the yes changes the answer.
        if (!shop.allows(player)) return Result.OUTSIDE_SHOP;
        return switch (offer) {
            case Offer.Purchase purchase -> doPurchase(player, id, purchase);
            case Offer.HaulSale sale -> doHaulSale(player, id, sale);
        };
    }

    /** Scuttle hands over goods and takes coins, giving change if they overpay. */
    private Result doPurchase(Player player, UUID id, Offer.Purchase offer) {
        // Re-checked here as well as when the offer was made, like everything
        // else on this path: the whole point of an escrow is that the answer can
        // change between the offer and the yes, and two offers can be made
        // inside one window.
        if (offer.credits() > allowanceLeft(player)) return Result.OVER_ALLOWANCE;

        long price = coins.payable(offer.credits());
        Map<Material, Integer> tender = coins.tender(player, price);
        if (tender == null) return Result.NO_COINS;
        if (Inventories.roomFor(player, offer.item()) < offer.count()) return Result.NO_ROOM;

        for (Map.Entry<Material, Integer> e : tender.entrySet()) {
            if (!Inventories.remove(player, e.getKey(), e.getValue())) {
                pending.remove(id);
                return Result.NO_COINS;
            }
        }
        // They will usually have handed over more than the price; the difference
        // comes back, less whatever is smaller than the smallest coin.
        long over = coins.valueOf(tender) - price;
        if (over > 0) {
            coins.change(over).forEach((m, n) -> Inventories.give(player, m, n));
        }
        Inventories.give(player, offer.item(), offer.count());

        stash.take(offer.item(), offer.count());
        stash.save();
        charge(id, offer.credits());
        pending.remove(id);

        Log.info(MODULE, "sold",
                "player", player.getName(),
                "item", offer.count() + "x " + MaterialSearch.pretty(offer.item()),
                "price", price);
        return Result.DONE;
    }

    /** Scuttle takes the haul and pays out in coins. */
    private Result doHaulSale(Player player, UUID id, Offer.HaulSale offer) {
        // Re-price against what they actually still have, not the snapshot.
        Map<Material, Integer> actual = new java.util.LinkedHashMap<>();
        for (Map.Entry<Material, Integer> e : offer.goods().entrySet()) {
            int have = Inventories.count(player, e.getKey());
            int take = Math.min(have, e.getValue());
            if (take > 0) actual.put(e.getKey(), take);
        }
        if (actual.isEmpty()) {
            pending.remove(id);
            return Result.GONE;
        }

        Map<Material, Integer> payment = coins.change(Haul.valueOf(actual, guard));
        for (Map.Entry<Material, Integer> e : payment.entrySet()) {
            if (Inventories.roomFor(player, e.getKey()) < e.getValue()) return Result.NO_ROOM;
        }

        // Pay for what was actually taken, not what was priced. The two can only
        // differ if a removal fails, which can't happen in the same tick the
        // counts were read — but paying from the estimate rather than the receipt
        // is a duplication bug waiting for the first refactor that separates them.
        Map<Material, Integer> taken = new java.util.LinkedHashMap<>();
        for (Map.Entry<Material, Integer> e : actual.entrySet()) {
            if (Inventories.remove(player, e.getKey(), e.getValue())) {
                stash.add(e.getKey(), e.getValue());
                taken.put(e.getKey(), e.getValue());
            }
        }
        long payout = Haul.valueOf(taken, guard);
        coins.change(payout).forEach((m, n) -> Inventories.give(player, m, n));
        stash.save();
        // Deliberately not charged against the daily allowance — see allowanceLeft().
        pending.remove(id);

        Log.info(MODULE, "bought a haul",
                "player", player.getName(), "kinds", taken.size(), "paid", payout);
        return Result.DONE;
    }

    private void charge(UUID id, long credits) {
        rollDate();
        spentToday.merge(id, credits, Long::sum);
        saveSpend();
    }

    private void rollDate() {
        LocalDate today = LocalDate.now();
        if (!today.equals(spendDate)) {
            spendDate = today;
            spentToday.clear();
            saveSpend();
        }
    }

    private void loadSpend() {
        if (!spendFile.toFile().isFile()) return;
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(spendFile.toFile());

        String date = yaml.getString("date", "");
        if (!LocalDate.now().toString().equals(date)) {
            Log.debug(MODULE, "trade allowances are from another day, starting fresh");
            return;
        }
        var section = yaml.getConfigurationSection("spent");
        if (section == null) return;
        for (String key : section.getKeys(false)) {
            try {
                spentToday.put(UUID.fromString(key), section.getLong(key));
            } catch (IllegalArgumentException e) {
                Log.warn(MODULE, "skipping an unreadable player id in trades.yml", "id", key);
            }
        }
        Log.debug(MODULE, "loaded today's trade allowances", "players", spentToday.size());
    }

    private void saveSpend() {
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("date", spendDate.toString());
        spentToday.forEach((id, spent) -> yaml.set("spent." + id, spent));
        try {
            yaml.save(spendFile.toFile());
        } catch (IOException e) {
            Log.error(MODULE, "could not save trade allowances", e, "file", spendFile);
        }
    }
}
