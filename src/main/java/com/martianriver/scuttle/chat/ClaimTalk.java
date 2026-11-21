package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.claim.ClaimDesk;
import com.martianriver.scuttle.log.AuditLog;
import org.bukkit.entity.Player;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Saying yes or no to a piece of land.
 *
 * <p>Deliberately the same shape as {@link TradeTalk}: buttons, {@code /scuttle
 * claim}, or a plain "yes" typed in chat. A kid shouldn't have to learn two ways
 * of agreeing with Scuttle, and the bare "yes" saves an API call either way.
 */
public final class ClaimTalk {

    private final ClaimDesk desk;
    private final Speech speech;
    private final AuditLog audit;

    public ClaimTalk(ClaimDesk desk, Speech speech, AuditLog audit) {
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

    /** Main thread only — changes regions. */
    public void accept(Player player) {
        ClaimDesk.Pending parked = desk.pendingFor(player.getUniqueId());
        ClaimDesk.Done done = desk.accept(player);

        switch (done.result()) {
            case DONE -> {
                speech.say(player, wellDone(parked));
                if (parked != null) {
                    audit.note(player.getName(), "claim " + parked.kind().name().toLowerCase()
                            + " '" + parked.label() + "'");
                }
            }
            case EXPIRED -> speech.say(player,
                    "Too slow — I've let that one go. Ask me again and I'll measure it out fresh.");
            case GONE -> speech.say(player, done.problem() == null
                    ? "Something's changed since I offered that. Ask me again?"
                    : "Can't, sorry — " + done.problem());
            case FAILED -> speech.say(player, done.problem() == null
                    ? "That jammed. Tell an adult and I'll try again after."
                    : done.problem());
            case NOTHING_PENDING -> speech.say(player,
                    "I haven't offered you any land. Stand where you want it and ask!");
        }
    }

    public void decline(Player player) {
        if (!hasOffer(player)) {
            speech.say(player, "Nothing to say no to. Stand where you want land and ask me!");
            return;
        }
        desk.clear(player.getUniqueId());
        speech.say(player, pick(
                "Right you are. I'll leave the ground as it is.",
                "Fair enough — no fence, then.",
                "Suit yourself! *clank*"));
    }

    private static String wellDone(ClaimDesk.Pending parked) {
        if (parked == null) return "Done!";
        return switch (parked.kind()) {
            case CREATE -> "Pegged out! '" + parked.label() + "' is yours — nobody else can "
                    + "build there or open your chests. Walk the edge and you'll see where it "
                    + "starts.";
            case RESIZE -> "Done — '" + parked.label() + "' is a different size now. Walk out "
                    + "to the edge and you'll see where it stops.";
            case ABANDON -> "Fence is down. '" + parked.label() + "' is open ground again — "
                    + "everything you built is still standing, it's just not protected now.";
        };
    }

    private static String pick(String... options) {
        return options[ThreadLocalRandom.current().nextInt(options.length)];
    }
}
