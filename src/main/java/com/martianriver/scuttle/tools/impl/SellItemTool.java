package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.tools.Tool;
import com.martianriver.scuttle.trade.Coins;
import com.martianriver.scuttle.trade.Offer;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/**
 * Scuttle sells something and is paid in coins.
 *
 * <p>This used to be a swap of two arbitrary piles, which meant the guard had to
 * judge fairness, affordability and a counter-offer — and the counter search
 * produced offers it then refused as overpay. Coins removed all of it: the price
 * is the price, and exact change cannot overpay. What is left is "can they
 * afford it", which is one subtraction.
 */
public final class SellItemTool implements Tool {

    private static final int MAX_COUNT = 512;

    private final TradeDesk desk;

    public SellItemTool(TradeDesk desk) {
        this.desk = desk;
    }

    @Override
    public String name() {
        return "offer_sale";
    }

    @Override
    public String description() {
        return "Offer to sell the player something for coins. This is how they get anything from "
                + "you. You do NOT need to look up a price first — name the item and how many, "
                + "and you will be told the cost and whether they can afford it. If they can't, "
                + "you are told how many they CAN have, and you should immediately offer that "
                + "instead rather than describing it. Nothing moves until they press the button.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("item", "string", "What they want, e.g. 'diamond', 'elytra'")
                .required("count", "integer", "How many")
                .build();
    }

    @Override
    public Tier requiredTier() {
        return Tier.KID;
    }

    @Override
    public boolean needsMainThread() {
        return true;
    }

    @Override
    public String execute(Player player, JsonObject args) throws ToolException {
        if (!desk.shop().allows(player)) return desk.shop().refusal(player);

        String query = ToolArgs.string(args, "item");
        int count = ToolArgs.count(args, "count");
        if (count < 1 || count > MAX_COUNT) {
            throw new ToolException("that number doesn't make sense (1 to " + MAX_COUNT + ")");
        }

        MaterialSearch.Match match = MaterialSearch.find(query);
        if (match == null) throw new ToolException("there's no such thing as '" + query + "'");
        Material item = match.material();
        Coins coins = desk.coins();

        if (coins.isCoin(item)) {
            throw new ToolException(MaterialSearch.pretty(item) + " is money, not goods — you "
                    + "don't sell it, you pay with it");
        }
        if (desk.values().banned(item)) {
            throw new ToolException(MaterialSearch.pretty(item) + " is never traded, at any "
                    + "price, and no amount of asking changes that");
        }

        long price = desk.guard().costOf(item, count);
        if (price < 0) throw new ToolException("you can't put a price on " + MaterialSearch.pretty(item));

        long purse = coins.purse(player);
        int finalCount = count;
        // The smallest coin is still worth more than the cheapest goods (a copper
        // nugget is two cobblestone), so a small count often has no exact price in
        // real coins. Rounding the PRICE up instead could
        // mean paying a whole coin for one block, a markup that has nothing to do
        // with what the block is worth. Buying a few more for the same fair rate
        // is the honest fix: a market stall doesn't sell a quarter of a penny of
        // gravel either, it sells you a scoop.
        if (coins.payable(price) != price) {
            finalCount = nearestPayableCount(item, count, purse);
            price = desk.guard().costOf(item, finalCount);
        }
        price = coins.payable(price);

        long left = desk.allowanceLeft(player);
        if (price > left) {
            return "That's over what they're allowed to spend in one day — they've " + left
                    + " credits of it left and that costs " + price + ". Nothing you can do"
                    + " about it and nor can they; it resets tomorrow. Say so plainly, blame"
                    + " the rule rather than them, and offer something smaller if there is one.";
        }
        if (purse < price) {
            int afford = affordable(item, purse);
            if (afford < 1) {
                return "They can't afford even one — they've only got "
                        + coins.describe(coins.change(purse)) + ". Don't offer this again at any"
                        + " count. Either point them at something cheaper of the same sort and"
                        + " offer THAT, or tell them to sell you a haul first.";
            }
            return "Too dear: they've got " + coins.describe(coins.change(purse))
                    + " and that costs " + coins.describe(coins.change(price))
                    + ". They can afford " + afford + ". Call offer_sale again right now with"
                    + " count=" + afford + ". Do not just describe it — an offer they can't"
                    + " press a button on isn't an offer.";
        }

        Offer offer = desk.sell(player.getUniqueId(), item, finalCount, price);
        String bumped = finalCount == count ? "" : "Note: coins can't make change finer than a "
                + coins.smallestName() + ", so this is " + finalCount + " rather than the " + count
                + " they asked for, at the same fair rate — say something like \"smallest I can do"
                + " that for is " + finalCount + "\" rather than pretending they asked for "
                + finalCount + ". ";
        return bumped + "On the table: " + offer.describe(coins) + ". They can afford it. Tell "
                + "them what it costs in coins — you may say those numbers out loud, they're real"
                + " things — and don't say the swap is done; they still have to press the button.";
    }

    /**
     * The smallest count at or above {@code requested} whose price lands exactly
     * on a coin value, without straying past what they can afford. Falls back to
     * the requested count when nothing nearby works out exactly — a diamond
     * priced one credit off isn't worth chasing sixteen counts for, and the
     * caller still rounds the price up as before in that case.
     */
    private int nearestPayableCount(Material item, int requested, long purse) {
        Coins coins = desk.coins();
        int limit = Math.min(MAX_COUNT, requested + 16);
        for (int n = requested; n <= limit; n++) {
            long cost = desk.guard().costOf(item, n);
            if (cost > purse) break;
            if (coins.payable(cost) == cost) return n;
        }
        return requested;
    }

    /** How many they could have for what's in their purse. Stock moves the price, so step down. */
    private int affordable(Material item, long purse) {
        Coins coins = desk.coins();
        int n = MAX_COUNT;
        long unit = desk.guard().costOf(item, 1);
        if (unit > 0) n = (int) Math.min(MAX_COUNT, purse / unit);
        while (n > 0 && coins.payable(desk.guard().costOf(item, n)) > purse) {
            n = Math.min(n - 1, (int) (n * 0.9));
        }
        return Math.max(0, n);
    }
}
