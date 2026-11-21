package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import com.martianriver.scuttle.trade.Coins;
import com.martianriver.scuttle.trade.Haul;
import com.martianriver.scuttle.trade.Offer;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.Map;

/**
 * "scuttle, buy my haul" — the other half of the loop, and the one that pays for
 * everything else.
 *
 * <p>Takes no arguments on purpose. The model does not get to choose what to buy
 * or what to leave; {@link Haul} decides, in Java, and the player sees the whole
 * list before anything moves.
 */
public final class BuyHaulTool implements Tool {

    private final TradeDesk desk;

    public BuyHaulTool(TradeDesk desk) {
        this.desk = desk;
    }

    @Override
    public String name() {
        return "buy_haul";
    }

    @Override
    public String description() {
        return "Buy everything the player has been mining, in one go, and pay them in coins. "
                + "Use it whenever they want to cash in — \"buy my stuff\", \"I've been mining\", "
                + "\"how much for this lot\". It takes nothing from you: it works out what they "
                + "are carrying that is worth buying, skips their tools, armour and money, and "
                + "puts the whole lot on the table as one offer. Anything they want to keep "
                + "they should put in a chest first — say so if they seem unsure.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema().build();
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

        Coins coins = desk.coins();
        Map<Material, Integer> goods = Haul.gather(player, desk.guard(), coins);
        if (goods.isEmpty()) {
            return "They've got nothing worth buying — no ore, no stone, nothing but their kit."
                    + " Tell them so cheerfully and send them off to dig.";
        }

        long payout = Haul.valueOf(goods, desk.guard());
        Map<Material, Integer> payment = coins.change(payout);
        if (coins.valueOf(payment) <= 0) {
            return "The whole lot isn't worth a single " + coins.smallestName() + ". Say so —"
                    + " kindly, and tell them to come back with a proper pile.";
        }

        Offer offer = desk.buyHaul(player.getUniqueId(), goods, payout);
        return "On the table: " + offer.describe(coins) + ".\nSay what you're taking and what"
                + " you'll pay, in coins — you may say those numbers, they're real items. This"
                + " is a \"best I can do is\" price: anything left over that won't make a whole"
                + " " + coins.smallestName() + ", you keep, and you can be cheerfully"
                + " unapologetic about that. They still have to press the button.";
    }
}
