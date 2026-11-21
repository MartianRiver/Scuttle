package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.regions.Regions;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.entity.Player;

/**
 * Letting a friend build in your place, or shutting them out again.
 *
 * <p>Only the owner may, and ownership is read out of the region rather than
 * taken from the model — so "Scuttle, I'm the owner really" changes nothing.
 * This one takes effect immediately: there is nothing to escrow because nothing
 * is created or destroyed, and a child who has just been griefed by a sibling
 * should not have to confirm twice to lock the door.
 */
public final class ClaimAccessTool implements Tool {

    private final ClaimBook book;
    private final Regions regions;

    public ClaimAccessTool(ClaimBook book, Regions regions) {
        this.book = book;
        this.regions = regions;
    }

    @Override
    public String name() {
        return "claim_access";
    }

    @Override
    public String description() {
        return "Let another player build inside one of this player's fenced-off patches, or "
                + "stop them. Use it for \"let my brother build here\", \"kick X out of my "
                + "base\". Only works on land they own. Takes effect straight away.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("player", "string", "Who they're letting in or shutting out")
                .required("allow", "boolean", "true to let them in, false to shut them out")
                .optional("claim", "string",
                        "Which patch, if they have more than one and said which. Leave out to "
                                + "use the one they're stood in.")
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
        if (!book.available()) {
            throw new ToolException("land claiming isn't set up on this server");
        }
        String who = ToolArgs.string(args, "player");
        boolean allow = ToolArgs.bool(args, "allow", true);
        String which = ToolArgs.optionalString(args, "claim");

        Regions.Box box = book.resolve(player, which);
        if (box == null) return ambiguous(player, which);
        if (!player.getUniqueId().equals(box.owner())) {
            return "No — that patch isn't theirs, so they don't get to say who's in it.";
        }

        OfflinePlayer target = findPlayer(who);
        if (target == null || target.getUniqueId().equals(player.getUniqueId())) {
            return target == null
                    ? "There's nobody called '" + who + "' on this server. Ask them to check the"
                    + " spelling — it has to match exactly."
                    : "They're already the owner; they can't let themselves in.";
        }

        World world = Bukkit.getWorld(box.world());
        if (world == null) return "I can't get at that world just now.";

        String problem = regions.setMember(world, box.id(), target.getUniqueId(),
                target.getName(), allow);
        if (problem != null) return problem;

        String name = target.getName() == null ? who : target.getName();
        return allow
                ? "Done — " + name + " can build in '" + book.label(box) + "' now. Tell them "
                + "it's done and that they can shut them out again any time by asking."
                : "Done — " + name + " is shut out of '" + book.label(box) + "'. Anything "
                + name + " already built there stays put; they just can't touch it any more.";
    }

    private String ambiguous(Player player, String which) {
        var mine = book.claimsOf(player);
        if (mine.isEmpty()) {
            return "They haven't got any land yet, so there's nothing to share. Offer to peg "
                    + "some out for them instead.";
        }
        if (which != null) {
            return "They haven't got one called '" + which + "'. Their patches are: "
                    + names(player) + ". Ask which they meant.";
        }
        return "They've got more than one patch and aren't stood in any of them, so I can't "
                + "tell which they mean. Theirs are: " + names(player) + ". Ask which.";
    }

    private String names(Player player) {
        StringBuilder sb = new StringBuilder();
        for (Regions.Box box : book.claimsOf(player)) {
            if (sb.length() > 0) sb.append(", ");
            sb.append('\'').append(book.label(box)).append('\'');
        }
        return sb.toString();
    }

    /**
     * Known players only, and matched exactly. Fuzzy-matching a name here would
     * eventually hand the keys to the wrong sibling.
     */
    private static OfflinePlayer findPlayer(String name) {
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) return online;
        for (OfflinePlayer known : Bukkit.getOfflinePlayers()) {
            if (name.equalsIgnoreCase(known.getName())) return known;
        }
        return null;
    }
}
