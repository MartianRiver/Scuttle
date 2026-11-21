package com.martianriver.scuttle.trade;

import com.martianriver.scuttle.tools.MaterialSearch;
import org.bukkit.Material;

import java.util.Map;
import java.util.UUID;

/**
 * Something Scuttle has put on the table and is waiting to hear about.
 *
 * <p>The offer lives in Java, not in the conversation. The model can propose one
 * and describe it, but the thing that actually gets executed is this record — so
 * what the player agreed to and what happens to their chest are the same thing
 * even if the model's next sentence says otherwise.
 *
 * <p>Two shapes, because money only ever moves one way in each: Scuttle sells
 * goods <em>for</em> coins, or buys a haul <em>with</em> coins. Item-for-item
 * barter is gone — that is what removed the fairness arithmetic, since exact
 * change cannot overpay.
 */
public sealed interface Offer permits Offer.Purchase, Offer.HaulSale {

    UUID player();

    long expiresAt();

    /** The price, always in credits — never shown to anyone. */
    long credits();

    default boolean expired(long now) {
        return now >= expiresAt();
    }

    /** What the player is agreeing to, in the words they'll see. */
    String describe(Coins coins);

    /** Scuttle hands over goods; the player pays coins. */
    record Purchase(UUID player, Material item, int count, long credits, long expiresAt)
            implements Offer {
        @Override
        public String describe(Coins coins) {
            return count + "x " + MaterialSearch.pretty(item)
                    + " for " + coins.describe(coins.change(credits));
        }
    }

    /**
     * The player hands over a pile; Scuttle pays coins.
     *
     * <p>{@code goods} is a snapshot taken when the offer was made. It is
     * re-checked against the real inventory on accept, because a kid can spend
     * ninety seconds putting half of it in a chest.
     */
    record HaulSale(UUID player, Map<Material, Integer> goods, long credits, long expiresAt)
            implements Offer {
        @Override
        public String describe(Coins coins) {
            return summarise() + " for " + coins.describe(coins.change(credits));
        }

        public String summarise() {
            StringBuilder sb = new StringBuilder(120);
            int shown = 0;
            for (Map.Entry<Material, Integer> e : goods.entrySet()) {
                if (shown == 4) {
                    sb.append(" and ").append(goods.size() - 4).append(" other things");
                    break;
                }
                if (shown > 0) sb.append(", ");
                sb.append(e.getValue()).append("x ").append(MaterialSearch.pretty(e.getKey()));
                shown++;
            }
            return sb.isEmpty() ? "nothing" : sb.toString();
        }
    }
}
