package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.tools.MaterialSearch;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What the player has and what Scuttle has, captured before the turn starts
 * rather than fetched by the model.
 *
 * <p>Asking for this cost a whole round trip on nearly every trading turn, to
 * say something the server already knew. It got shorter when money became coins:
 * the player's side used to be sixteen priced lines and is now their purse plus
 * a glance at what's worth buying off them.
 *
 * <p>Main thread only, same as {@link Inventories}.
 */
public record Pocket(String purse, List<String> haul, long haulWorth, List<String> stash,
                     long allowanceLeft, String pending, boolean inShop, String shopWay) {

    private static final int MAX_HAUL_KINDS = 6;
    private static final int MAX_STASH_KINDS = 12;

    public static Pocket capture(Player player, TradeDesk desk) {
        Coins coins = desk.coins();
        Map<Material, Integer> goods = Haul.gather(player, desk.guard(), coins);
        long haulWorth = Haul.valueOf(goods, desk.guard());

        List<String> haul = new ArrayList<>();
        int shown = 0;
        for (Map.Entry<Material, Integer> e : goods.entrySet()) {
            if (shown++ >= MAX_HAUL_KINDS) continue;
            haul.add(e.getValue() + "x " + MaterialSearch.pretty(e.getKey()));
        }
        if (shown > MAX_HAUL_KINDS) haul.add("and " + (shown - MAX_HAUL_KINDS) + " other kinds");

        // Coins are filtered rather than assumed absent: an old stash.yml can
        // still hold something that has since become money, and listing it here
        // would have the model cheerfully offering to sell its own currency.
        List<String> stash = new ArrayList<>();
        for (Map.Entry<Material, Integer> entry : desk.stash().top(MAX_STASH_KINDS)) {
            if (coins.isCoin(entry.getKey())) continue;
            String label = coins.priceLabel(desk.guard().costOf(entry.getKey(), 1));
            stash.add(entry.getValue() + "x " + MaterialSearch.pretty(entry.getKey())
                    + (label == null ? "" : " — " + label));
        }

        Offer offer = desk.pendingFor(player.getUniqueId());
        Shop shop = desk.shop();
        boolean inShop = !shop.gated() || shop.allows(player);
        return new Pocket(coins.describe(coins.change(coins.purse(player))),
                List.copyOf(haul), haulWorth, List.copyOf(stash),
                desk.allowanceLeft(player),
                offer == null ? null : offer.describe(coins),
                inShop, shop.gated() ? shop.directions(player) : null);
    }

    public String render() {
        StringBuilder sb = new StringBuilder(600);

        if (!inShop) {
            sb.append("WHERE THEY ARE: out in the world, not in your shop.\n");
            if (shopWay != null) {
                // Spelled out because "it's 240 blocks north-west" is ambiguous
                // about which end is which, and Sonnet read it backwards — it
                // sent a kid south-east. Directions that reverse are worse than
                // no directions at all.
                sb.append("THE WAY BACK TO YOUR SHOP, from where they're standing: ")
                        .append(shopWay).append('\n');
            }
            sb.append("Talk prices all you like out here, and tell them what the haul in\n")
                    .append("their bag is worth — that's what makes the walk back worth making.\n")
                    .append("But nothing changes hands anywhere but the shop, so don't try to\n")
                    .append("buy or sell; tell them to come and see you.\n\n");
        }

        sb.append("WHAT THEY'RE CARRYING AS MONEY: ").append(purse).append('\n')
                .append("That's their whole purse. Coins are the only thing you take as")
                .append(" payment — you never swap goods for goods any more.\n");

        sb.append("\nWHAT THEY'RE CARRYING THAT YOU'D BUY:\n");
        if (haul.isEmpty()) {
            sb.append("- nothing. No ore, no stone, nothing but their own kit.\n");
        } else {
            for (String line : haul) sb.append("- ").append(line).append('\n');
            if (inShop) {
                sb.append("Call buy_haul to put the whole lot on the table. Don't itemise it")
                        .append(" yourself and don't work out what it's worth — the tool does")
                        .append(" both, and it skips their tools, armour and money for you.\n");
            } else {
                sb.append("Worth having, and you'd buy it — when they get here. Say so.\n");
            }
        }

        sb.append("\nWHAT'S IN YOUR STASH RIGHT NOW, and what one of each costs them:\n");
        if (stash.isEmpty()) {
            sb.append("- nothing — the chest is bare\n");
        } else {
            for (String line : stash) sb.append("- ").append(line).append('\n');
        }
        sb.append("This is the real chest. Never say you haven't got something without\n")
                .append("looking here first. Anything not on the list you can still sell them —\n")
                .append("you just have to go and fetch it, so it costs more and you grumble\n")
                .append("about the walk.\n");

        if (pending != null) {
            sb.append("\nALREADY ON THE TABLE: ").append(pending)
                    .append(". They haven't answered yet and the buttons are under your last\n")
                    .append("message. Don't offer it again. If they want something different,\n")
                    .append("offer that instead — it replaces this one.\n");
        }

        sb.append("\nYou may say coin amounts out loud. Gold blocks, ingots, nuggets and iron\n")
                .append("nuggets are real things they can hold and count, so \"three ingots and\n")
                .append("a couple of nuggets\" is a useful sentence. What you must never mention\n")
                .append("is the bookkeeping underneath it.\n");
        return sb.toString();
    }
}
