package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.config.ScuttleConfig;
import org.bukkit.Material;

/**
 * What things cost. The trading half of the security boundary (SCUTTLE.md §6):
 * the model may <em>ask</em> for anything, and every number that decides what
 * happens is worked out here, in Java.
 *
 * <p>This used to judge fairness between two arbitrary piles — an overpay
 * ceiling, an affordability test, and a search for a counter-offer that once
 * proposed swaps this same class then refused. All of it went when money became
 * coins: exact change cannot overpay, so "can they afford it" is one subtraction
 * and belongs in the tool. What's left is pricing and the invariant it holds.
 */
public final class TradeGuard {

    private final Stash stash;
    private volatile ItemValues values;
    private volatile ScuttleConfig config;

    public TradeGuard(ItemValues values, Stash stash, ScuttleConfig config) {
        this.values = values;
        this.stash = stash;
        this.config = config;
    }

    /** Reload rebuilds the price list from values.yml; everything else stays put. */
    public void rewire(ItemValues values, ScuttleConfig config) {
        this.values = values;
        this.config = config;
    }

    public ItemValues values() {
        return values;
    }

    /**
     * What the player pays for it: value, Scuttle's margin, and how the stash is doing.
     *
     * <p>Never below the book value, however well stocked Scuttle is. The stash
     * discount used to take an iron ingot to 37 against a book of 40, and selling
     * under book is what lets anything be bought, crafted into something dearer,
     * and sold back at a profit — including into {@link Coins}, where it would
     * mint currency outright. The discount now eats into the margin instead of
     * through it, which is still a third off the unstocked price.
     */
    public long costOf(Material give, long unit, int count) {
        double factor = (1.0 + config.tradeMargin) * stash.priceFactor(give, count);
        long book = Math.max(1, unit * count);
        return Math.max(book, Math.round(unit * count * factor));
    }

    public long costOf(Material give, int count) {
        Long unit = values.value(give);
        return unit == null ? -1 : costOf(give, unit, count);
    }

    /**
     * What Scuttle will credit for the player's goods — the same margin the
     * other way, less whatever it thinks of yet another one of these.
     *
     * <p>The glut factor is the only brake on a farm. Prices can't be made
     * un-farmable by hand: {@code values.yml} rates how much of a faff a thing
     * is to get, and a hopper doesn't find anything a faff. So the number that
     * has to fall is this one, and it has to fall with supply rather than with
     * anybody's guess about which items are automatable.
     *
     * <p>It only ever reduces. Paying <em>above</em> book would let anything be
     * bought and sold straight back at a profit, which is the same hole the
     * "never sell below book" rule closes from the other side.
     */
    public long creditFor(long unit, int count) {
        return Math.max(0, Math.round(unit * count * (1.0 - config.tradeMargin)));
    }

    public long creditFor(Material want, int count) {
        Long unit = values.value(want);
        if (unit == null) return -1;
        return Math.max(0, Math.round(creditFor(unit, count) * stash.payFactor(want, count)));
    }
}
