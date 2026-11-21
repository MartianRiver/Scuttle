package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.claim.ClaimDesk;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.entity.Player;

/**
 * "scuttle can you protect my house?"
 *
 * <p>Takes no coordinates, on purpose — a claim is always a box round the player
 * who asked for it, worked out by {@link ClaimBook}. So the model cannot fence
 * off someone else's build, or a chunk of spawn, however it is asked to.
 */
public final class ClaimLandTool implements Tool {

    private final ClaimBook book;
    private final ClaimDesk desk;

    public ClaimLandTool(ClaimBook book, ClaimDesk desk) {
        this.book = book;
        this.desk = desk;
    }

    @Override
    public String name() {
        return "claim_land";
    }

    @Override
    public String description() {
        return "Fence off the ground the player is standing on so only they can build there. "
                + "Use it whenever they want somewhere kept safe — \"protect my house\", "
                + "\"can I claim this\", \"someone keeps breaking my stuff\". You do NOT choose "
                + "where: it is always a square around them, so tell them to go and stand in "
                + "the middle of what they want kept first. Nothing is fenced off until they "
                + "press the button.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .optional("name", "string",
                        "What they want to call it, e.g. 'treehouse'. Leave out if they "
                                + "haven't said.")
                .optional("blocks", "integer",
                        "How many blocks across, if they asked for a size. Leave out for the "
                                + "usual size.")
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
        String name = ToolArgs.optionalString(args, "name");
        Integer blocks = ToolArgs.optionalInt(args, "blocks");

        ClaimBook.Outcome outcome = book.propose(player, name, blocks);
        if (!outcome.ok()) return "No: " + outcome.refusal();

        ClaimBook.Proposal p = outcome.proposal();
        desk.park(player.getUniqueId(), ClaimDesk.Kind.CREATE, p, p.label(),
                p.world().getName());

        int used = book.claimsOf(player).size();
        return "Ready to peg out '" + p.label() + "' — " + p.width() + " blocks across, "
                + "centred where they're stood"
                + (p.fullHeight() ? ", all the way from bedrock to sky" : "")
                + ". That'd be their " + ordinal(used + 1) + " of " + book.allowance(player)
                + ". Tell them how big it is in a way a kid can picture — paces, or how many "
                + "houses — and that nobody else will be able to build or open chests inside "
                + "it. They still have to press the button.";
    }

    private static String ordinal(int n) {
        return switch (n) {
            case 1 -> "first";
            case 2 -> "second";
            case 3 -> "third";
            default -> n + "th";
        };
    }
}
