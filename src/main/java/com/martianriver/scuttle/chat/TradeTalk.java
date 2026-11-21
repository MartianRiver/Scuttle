package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.log.AuditLog;
import com.martianriver.scuttle.trade.Offer;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.entity.Player;

import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Saying yes or no to a trade.
 *
 * <p>Shared by the buttons, {@code /scuttle yes}, and a plain "yes" typed in
 * chat while an offer is up. That last one matters for cost as much as feel:
 * agreeing to a swap shouldn't need a second trip to the model.
 */
public final class TradeTalk {

    // Wider than it looks like it needs to be, on purpose. Every phrase missing
    // from here is a full API call to work out that a kid said yes — "sounds good"
    // cost a whole turn and a duplicate offer before it was added.
    private static final Set<String> YES = Set.of(
            "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "deal", "go on", "please",
            "yes please", "do it", "y", "aye", "alright", "fine",
            "sounds good", "sounds great", "sounds fair", "go for it", "go on then",
            "lets do it", "let's do it", "i'll take it", "ill take it", "yes ok",
            "ok then", "okay then", "yeah ok", "yeah go on", "that works",
            "works for me", "deal me in", "im in", "i'm in", "yes deal", "ok deal",
            "yes pls", "pls", "y pls", "sure thing", "perfect", "great deal");

    private static final Set<String> NO = Set.of(
            "no", "nope", "nah", "no thanks", "n", "cancel", "forget it", "never mind",
            "nevermind", "leave it", "no ta", "not now", "maybe later", "nah thanks",
            "no thank you", "changed my mind", "forget that", "drop it");

    private final TradeDesk desk;
    private final Speech speech;
    private final AuditLog audit;

    public TradeTalk(TradeDesk desk, Speech speech, AuditLog audit) {
        this.desk = desk;
        this.speech = speech;
        this.audit = audit;
    }

    public boolean hasOffer(Player player) {
        return desk.pendingFor(player.getUniqueId()) != null;
    }

    public long pendingSince(Player player) {
        return desk.pendingSince(player.getUniqueId());
    }

    /** null when the message isn't an answer either way. */
    public Boolean readAnswer(String message) {
        String normalized = message.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[!.?,]+$", "");
        if (YES.contains(normalized)) return Boolean.TRUE;
        if (NO.contains(normalized)) return Boolean.FALSE;
        return null;
    }

    /** Main thread only — moves items. */
    public void accept(Player player) {
        Offer offer = desk.pendingFor(player.getUniqueId());
        TradeDesk.Result result = desk.accept(player);

        switch (result) {
            case DONE -> {
                speech.say(player, done());
                if (offer != null) {
                    String what = offer.describe(desk.coins());
                    speech.quietly(player, "Done: " + what);
                    audit.trade(player.getName(), what, offer.credits());
                }
            }
            case EXPIRED -> speech.say(player,
                    "Too slow! That one's gone cold. Ask me again and I'll work it out fresh.");
            case GONE -> speech.say(player,
                    "Hang on — you haven't got them any more. Where did they go?");
            case NO_ROOM -> speech.say(player,
                    "You're full up! Nowhere to put them. Shift something and say yes again.");
            case NO_COINS -> speech.say(player,
                    "You haven't got the coin for that any more. Sell me something and "
                            + "we'll try again.");
            case OUTSIDE_SHOP -> speech.say(player, outsideShop(player));
            case OVER_ALLOWANCE -> speech.say(player,
                    "That's your lot for today — you've spent what you're allowed to. "
                            + "Keep digging and come back tomorrow, I'll still be here.");
            case NOTHING_PENDING -> speech.say(player,
                    "I haven't offered you anything yet. Ask me for something!");
        }
    }

    public void decline(Player player) {
        if (!hasOffer(player)) {
            speech.say(player, "Nothing on the table anyway. Ask me for something!");
            return;
        }
        desk.clear(player.getUniqueId());
        speech.say(player, pick(
                "Suit yourself! Offer's off the table.",
                "Fair enough. I'll keep them, then.",
                "No? No. Right. *clank*"));
    }

    /** They said yes on the walk home. The offer keeps until they get here. */
    private String outsideShop(Player player) {
        String way = desk.shop().directions(player);
        return "Ah — not out here! Come to the shop and say that again. It's "
                + (way == null ? "where it always is" : way) + ".";
    }

    private static String done() {
        return pick(
                "Scuttling! There you go.",
                "Scuttling! Straight out the stash.",
                "Done! *rattle* Pleasure doing business.");
    }

    private static String pick(String... options) {
        return options[ThreadLocalRandom.current().nextInt(options.length)];
    }
}
