package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.tools.Tool;
import com.martianriver.scuttle.trade.Coins;
import com.martianriver.scuttle.trade.Inventories;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/**
 * What something costs and what Scuttle would pay for it. Exists so haggling is
 * arithmetic rather than invention — without it the model guesses at prices and
 * then has its guess rejected, which reads as Scuttle being flaky.
 */
public final class PriceCheckTool implements Tool {

    private final TradeDesk desk;

    public PriceCheckTool(TradeDesk desk) {
        this.desk = desk;
    }

    @Override
    public String name() {
        return "price_check";
    }

    @Override
    public String description() {
        return "What one item is worth, when the player has asked outright what something "
                + "costs and you are not offering them anything. "
                + "Do NOT use this to work up to a swap — offer_sale prices itself and "
                + "corrects you, so pricing first only adds a wait. What they are carrying "
                + "is already in your notes.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("item", "string", "The item to price, e.g. 'diamond block'")
                .optional("count", "integer", "How many. Defaults to 1.")
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
        String query = ToolArgs.string(args, "item");
        int count = args.has("count") ? ToolArgs.count(args, "count") : 1;
        if (count < 1) throw new ToolException("count has to be at least 1");

        MaterialSearch.Match match = MaterialSearch.find(query);
        if (match == null) {
            return "There's no item called '" + query + "'.";
        }
        Material m = match.material();

        if (desk.values().banned(m)) {
            return MaterialSearch.pretty(m) + " is on the never-trade list. Not for any price, "
                    + "and you cannot be talked round — say so plainly and move on.";
        }
        if (desk.values().value(m) == null) {
            return "You can't put a price on " + MaterialSearch.pretty(m) + " — it isn't in "
                    + "your price list. Say you don't know what it's worth.";
        }

        Coins coins = desk.coins();
        if (coins.isCoin(m)) {
            return MaterialSearch.pretty(m) + " is money, not goods. It has a face value, not a"
                    + " price — you neither buy it nor sell it. Say what it's worth against the"
                    + " other coins if they're curious, and leave it there.";
        }

        long cost = desk.guard().costOf(m, count);
        long credit = desk.guard().creditFor(m, count);
        int held = Inventories.count(player, m);

        // Quoted in coins, not credits. The two differ for anything cheaper than
        // the smallest coin, and quoting credits here while offer_sale charges
        // coins is how one item ends up with two prices in one conversation.
        String each = coins.priceLabel(desk.guard().costOf(m, 1));

        return count + "x " + MaterialSearch.pretty(m)
                + "\n- costs them " + coins.describe(coins.change(coins.payable(cost)))
                + (count > 1 && each != null ? " (" + each + ")" : "")
                + "\n- you'd pay " + coins.describe(coins.change(credit)) + " for theirs"
                + "\n- stash: " + desk.stash().describe(m, count)
                + "\n- they're carrying " + held
                + "\n\nThis is a price, NOT an offer. Nothing is on the table and the player"
                + " has no way to accept. If you have decided on a swap, call offer_sale now"
                + " — describing one in chat does nothing at all.";
    }
}
