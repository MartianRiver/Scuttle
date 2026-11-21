package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.claim.ClaimDesk;
import com.martianriver.scuttle.regions.Regions;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.entity.Player;

/**
 * Making a patch bigger or smaller, round the middle it already has.
 *
 * <p>The centre deliberately does not move. A resize that recentred on wherever
 * the player happened to be standing would slide someone's protection off their
 * house without either of them noticing.
 */
public final class ClaimResizeTool implements Tool {

    private final ClaimBook book;
    private final ClaimDesk desk;

    public ClaimResizeTool(ClaimBook book, ClaimDesk desk) {
        this.book = book;
        this.desk = desk;
    }

    @Override
    public String name() {
        return "claim_resize";
    }

    @Override
    public String description() {
        return "Make one of the player's fenced-off patches bigger or smaller. Use it for "
                + "\"my claim is too small\", \"can you make it bigger\". It grows around the "
                + "same middle it already has, so it never slides off what they built. "
                + "Nothing changes until they press the button.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("blocks", "integer", "How many blocks across it should be")
                .optional("claim", "string",
                        "Which patch, if they have more than one. Leave out to use the one "
                                + "they're stood in.")
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
        int blocks = ToolArgs.count(args, "blocks");
        String which = ToolArgs.optionalString(args, "claim");

        Regions.Box box = book.resolve(player, which);
        if (box == null) {
            return "I can't tell which patch they mean. Ask them, or call list_claims and "
                    + "read them the names.";
        }
        ClaimBook.Outcome outcome = book.proposeResize(player, box, blocks);
        if (!outcome.ok()) return "No: " + outcome.refusal();

        ClaimBook.Proposal p = outcome.proposal();
        if (p.width() == box.width()) {
            return "It's already " + box.width() + " across, and that's as far as it goes. "
                    + "Say so plainly rather than pretending to change it.";
        }
        desk.park(player.getUniqueId(), ClaimDesk.Kind.RESIZE, p, book.label(box), box.world());

        boolean bigger = p.width() > box.width();
        return "Ready to take '" + book.label(box) + "' from " + box.width() + " blocks across"
                + " to " + p.width() + " — " + (bigger ? "bigger" : "smaller") + "."
                + (bigger ? "" : " Warn them that anything they built in the bit being given up"
                + " stops being protected.")
                + " They still have to press the button.";
    }
}
