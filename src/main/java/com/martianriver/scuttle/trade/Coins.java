package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Money, as actual items.
 *
 * <p>Three metals, cheapest to dearest: a copper nugget is 2, an iron ingot 40,
 * a gold ingot 90. Credits stay as the unit underneath because the finest coin
 * is still coarser than the finest good, but no player ever sees one. Every
 * number Scuttle says out loud is coins, which is the whole point: "two ingots
 * and a nugget" is a sentence a nine-year-old can act on, and "883 credits" is
 * not.
 *
 * <p>Copper is the small change, gold the big money, and every coin is a thing
 * you'd dig up anyway — so a chest of savings looks like a chest of treasure
 * rather than a bank statement. Coal was money too until 2026-08-22; dropped so
 * every coin above the smallest is a proper metal ingot rather than one of them
 * being a fuel item, and it's back to being an ordinary sellable good.
 *
 * <p><b>Face values are load-bearing and not free choices.</b> Each one has to
 * sit inside a window set by the vanilla 9:1 crafting ladder either side of it,
 * or the currency can be minted — see {@link #audit}, which re-derives every
 * window from the live price list on each boot and reload rather than trusting
 * the numbers written here. Copper *ingot* is the proof this matters: there is
 * no whole number that makes it safe, so the coin is the nugget instead.
 */
public final class Coins {

    private static final String MODULE = "coins";

    /**
     * The vanilla 9:1 ladders, smallest rung first.
     *
     * <p>Data, not logic — this is simply what the game crafts. {@link #audit}
     * walks it to work out which windows apply to which coin, so adding a metal
     * means adding a row here and nothing else.
     */
    private static final List<List<Material>> LADDERS = List.of(
            List.of(Material.COPPER_NUGGET, Material.COPPER_INGOT, Material.COPPER_BLOCK),
            List.of(Material.IRON_NUGGET, Material.IRON_INGOT, Material.IRON_BLOCK),
            List.of(Material.GOLD_NUGGET, Material.GOLD_INGOT, Material.GOLD_BLOCK));

    /** Ordered dearest first — change-making walks it in this direction. */
    public record Denom(Material material, long face, String one, String many) {
    }

    // Rebuilt on reload rather than final: the face values are config, and a
    // currency that only changes on a full restart is a currency whose safety
    // check silently reports the old numbers. That is exactly how the first
    // version of audit() passed a value it should have rejected.
    private volatile List<Denom> denominations;
    private volatile long smallest;

    public Coins(ScuttleConfig config) {
        updateConfig(config);
    }

    public void updateConfig(ScuttleConfig config) {
        this.denominations = List.of(
                new Denom(Material.GOLD_INGOT, config.faceGoldIngot, "gold ingot", "gold ingots"),
                new Denom(Material.IRON_INGOT, config.faceIronIngot, "iron ingot", "iron ingots"),
                new Denom(Material.COPPER_NUGGET, config.faceCopperNugget,
                        "copper nugget", "copper nuggets"));
        this.smallest = denominations.get(denominations.size() - 1).face();
    }

    public List<Denom> denominations() {
        return denominations;
    }

    public boolean isCoin(Material material) {
        for (Denom d : denominations) {
            if (d.material() == material) return true;
        }
        return false;
    }

    /** What a price becomes once it has to be payable in actual coins. */
    public long payable(long credits) {
        if (credits <= 0) return 0;
        return ((credits + smallest - 1) / smallest) * smallest;
    }

    /** What the player is carrying, in credits. */
    public long purse(Player player) {
        long total = 0;
        for (Denom d : denominations) {
            total += (long) Inventories.count(player, d.material()) * d.face();
        }
        return total;
    }

    /**
     * The best pile of coins worth no more than {@code credits}.
     *
     * <p>Deliberately floors. Rounding <em>up</em> would mint money: sell one
     * cobblestone worth 1 credit, get a coin worth 2, repeat. So the remainder —
     * always under one copper nugget — stays with Scuttle, which is exactly the
     * "best I can do is" it says out loud.
     *
     * <p>Fewest coins, not greedy-largest-first. The faces are not multiples of
     * one another — 90 is not a multiple of 40 — so taking the biggest coin
     * first can answer "a gold ingot and fifteen copper nuggets" where "three
     * iron ingots" is the very same money and a far better sentence to say to a
     * child. Same value either way; only the reading changes.
     */
    public Map<Material, Integer> change(long credits) {
        long left = Math.max(0, credits);
        Map<Material, Integer> tidy = fewestCoins(left);
        return tidy != null ? tidy : greedyCoins(left);
    }

    /**
     * Exact change in as few coins as possible, or null when that would be more
     * work than it is worth.
     *
     * <p>Counts in units of the smallest coin, which is only meaningful when
     * every face is a whole number of them — {@link #audit} insists on that, and
     * this falls back to greedy rather than trusting it.
     */
    private Map<Material, Integer> fewestCoins(long credits) {
        List<Denom> denoms = denominations;
        long unit = smallest;
        if (unit <= 0) return null;
        for (Denom d : denoms) {
            if (d.face() <= 0 || d.face() % unit != 0) return null;
        }
        long steps = credits / unit;
        // A dragon egg is 50,000 credits, so 25,000 steps. Well past that and
        // the answer is all gold ingots anyway and greedy finds it directly.
        if (steps > 100_000) return null;
        int n = (int) steps;

        int[] coinsUsed = new int[n + 1];
        int[] took = new int[n + 1];
        for (int i = 1; i <= n; i++) {
            coinsUsed[i] = Integer.MAX_VALUE;
            for (int d = 0; d < denoms.size(); d++) {
                int step = (int) (denoms.get(d).face() / unit);
                if (step > i || coinsUsed[i - step] == Integer.MAX_VALUE) continue;
                if (coinsUsed[i - step] + 1 < coinsUsed[i]) {
                    coinsUsed[i] = coinsUsed[i - step] + 1;
                    took[i] = d;
                }
            }
        }
        // Anything not exactly payable floors to the largest amount that is,
        // which is what the caller wants: the remainder stays with Scuttle.
        while (n > 0 && coinsUsed[n] == Integer.MAX_VALUE) n--;

        Map<Material, Integer> out = new LinkedHashMap<>();
        int[] tally = new int[denoms.size()];
        while (n > 0) {
            int d = took[n];
            tally[d]++;
            n -= (int) (denoms.get(d).face() / unit);
        }
        for (int d = 0; d < denoms.size(); d++) {
            if (tally[d] > 0) out.put(denoms.get(d).material(), tally[d]);
        }
        return out;
    }

    private Map<Material, Integer> greedyCoins(long credits) {
        Map<Material, Integer> out = new LinkedHashMap<>();
        long left = credits;
        for (Denom d : denominations) {
            int n = (int) (left / d.face());
            if (n > 0) {
                out.put(d.material(), n);
                left -= (long) n * d.face();
            }
        }
        return out;
    }

    public long valueOf(Map<Material, Integer> coins) {
        long total = 0;
        for (Denom d : denominations) {
            Integer n = coins.get(d.material());
            if (n != null) total += (long) n * d.face();
        }
        return total;
    }

    /** "three gold ingots, seven iron ingots and a copper nugget" */
    public String describe(Map<Material, Integer> coins) {
        List<String> parts = new ArrayList<>(4);
        for (Denom d : denominations) {
            Integer n = coins.get(d.material());
            if (n == null || n == 0) continue;
            parts.add(n == 1 ? article(d.one()) + d.one() : n + " " + d.many());
        }
        if (parts.isEmpty()) return "nothing";
        if (parts.size() == 1) return parts.get(0);
        return String.join(", ", parts.subList(0, parts.size() - 1))
                + " and " + parts.get(parts.size() - 1);
    }

    /** The smallest coin, for the odd line that has to name it. */
    public String smallestName() {
        return denominations.get(denominations.size() - 1).one();
    }

    /**
     * How to quote a per-item price without lying about it.
     *
     * <p>The smallest coin is worth two cobblestone, so "cobblestone: a copper
     * nugget each" reads as a doubled price and the model will duly offer two
     * blocks for two nuggets. Anything cheaper than one coin gets quoted the way
     * a market stall would — so many for a nugget.
     */
    public String priceLabel(long unitCredits) {
        if (unitCredits <= 0) return null;
        Denom small = denominations.get(denominations.size() - 1);
        long per = small.face() / Math.max(1, unitCredits);
        if (per <= 1) return describe(change(payable(unitCredits))) + " each";
        return per + " for " + article(small.one()) + small.one();
    }

    /** "an iron ingot", not "a iron ingot" — it is read aloud by a child. */
    private static String article(String word) {
        return "aeiou".indexOf(Character.toLowerCase(word.charAt(0))) >= 0 ? "an " : "a ";
    }

    /** What they'd have to hand over for this, smallest coins first so loose change gets used. */
    public Map<Material, Integer> tender(Player player, long credits) {
        Map<Material, Integer> out = new LinkedHashMap<>();
        long need = credits;
        for (int i = denominations.size() - 1; i >= 0 && need > 0; i--) {
            Denom d = denominations.get(i);
            int have = Inventories.count(player, d.material());
            if (have <= 0) continue;
            int want = (int) Math.min(have, (need + d.face() - 1) / d.face());
            if (want > 0) {
                out.put(d.material(), want);
                need -= (long) want * d.face();
            }
        }
        return need > 0 ? null : out;
    }

    /**
     * Startup check that the price table hasn't drifted under the currency.
     *
     * <p>Prices are derived from the recipe graph, so a change to {@code
     * values.yml} anywhere can quietly make a coin worth more than the goods it
     * crafts from — and that is a money printer nobody would notice until the
     * kids found it. Cheap to check, so it gets checked every boot and reload.
     *
     * <p>Every window is re-derived from the live price list rather than
     * hand-written here. That is the whole point: the copper *ingot* was ruled
     * out as a coin by exactly this arithmetic after a first pass had picked it
     * by eye, and hand-derived numbers are what let the previous version pass a
     * value it should have rejected.
     */
    public void audit(TradeGuard guard) {
        for (Denom d : denominations) {
            Long book = guard.values().value(d.material());
            if (book == null) {
                Log.warn(MODULE, "a coin has no price at all", "coin", d.one());
                continue;
            }
            // The one check that stands on its own: a coin you can obtain for
            // less than its face is a coin you can manufacture.
            if (d.face() > book) {
                Log.warn(MODULE, "coin face is above its own book value — mintable",
                        "coin", d.one(), "face", d.face(), "book", book);
            }
            if (d.face() % smallest != 0) {
                // Not a mint, but it silently eats change: every price is a whole
                // number of the smallest coin, so a face that isn't leaves a
                // remainder that can never be paid back. The old gold ladder did
                // this — an iron nugget of 4 against a gold nugget of 10 — and
                // quietly kept 2 credits of every other purchase.
                Log.warn(MODULE, "coin face is not a whole number of the smallest coin —"
                                + " change will be short-changed",
                        "coin", d.one(), "face", d.face(), "smallest", smallest);
            }
            auditLadders(guard, d);
        }
        Log.debug(MODULE, "currency audited", "denominations", denominations.size());
    }

    /** Checks a coin against whichever rungs of the 9:1 ladder it actually has. */
    private void auditLadders(TradeGuard guard, Denom coin) {
        for (List<Material> ladder : LADDERS) {
            int at = ladder.indexOf(coin.material());
            if (at < 0) continue;
            if (at + 1 < ladder.size()) smallSide(guard, coin, ladder.get(at + 1));
            if (at > 0) largeSide(guard, coin, ladder.get(at - 1));
        }
    }

    /**
     * The coin is the small half of a 9:1 pair, so nine of them craft into one
     * {@code larger}. Safe when {@code creditFor(larger) <= 9*face <= book(larger)}:
     * below that lower bound you gather coins, craft up and sell at a profit;
     * above the upper bound you buy one and break it into more money than it
     * cost.
     */
    private void smallSide(TradeGuard guard, Denom coin, Material larger) {
        Long book = guard.values().value(larger);
        if (book == null) return;
        long nine = coin.face() * 9;
        long paid = guard.creditFor(larger, 1);
        if (nine > book) {
            Log.warn(MODULE, "breaking one of these up mints money",
                    "coin", coin.one(), "from", larger, "nineCoins", nine, "book", book);
        }
        if (paid > nine) {
            Log.warn(MODULE, "crafting these up and selling mints money",
                    "coin", coin.one(), "into", larger, "nineCoins", nine, "pays", paid);
        }
    }

    /**
     * The coin is the large half, so it breaks into nine {@code smaller}. Safe
     * when {@code creditFor(smaller, 9) <= face <= 9*book(smaller)}.
     */
    private void largeSide(TradeGuard guard, Denom coin, Material smaller) {
        Long book = guard.values().value(smaller);
        if (book == null) return;
        long nine = book * 9;
        long paid = guard.creditFor(smaller, 9);
        if (coin.face() > nine) {
            Log.warn(MODULE, "crafting one of these up mints money",
                    "coin", coin.one(), "from", smaller, "face", coin.face(), "nineBooks", nine);
        }
        if (paid > coin.face()) {
            Log.warn(MODULE, "breaking one up and selling the bits mints money",
                    "coin", coin.one(), "into", smaller, "face", coin.face(), "pays", paid);
        }
    }
}
