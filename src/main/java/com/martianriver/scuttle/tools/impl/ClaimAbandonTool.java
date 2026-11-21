package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.claim.ClaimDesk;
import com.martianriver.scuttle.regions.Regions;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.entity.Player;

/**
 * Giving a patch up, usually to free a slot for somewhere better.
 *
 * <p>Nothing is broken by this — the blocks all stay exactly where they are, and
 * only the protection goes. Worth saying out loud to a child, who will otherwise
 * assume Scuttle is about to delete their house.
 */
public final class ClaimAbandonTool implements Tool {

    private final ClaimBook book;
    private final ClaimDesk desk;

    public ClaimAbandonTool(ClaimBook book, ClaimDesk desk) {
        this.book = book;
        this.desk = desk;
    }

    @Override
    public String name() {
        return "claim_abandon";
    }

    @Override
    public String description() {
        return "Give up one of the player's fenced-off patches, freeing the slot for a new one. "
                + "Use it for \"I don't need this claim any more\", \"delete my old base\". "
                + "It removes only the protection — every block they built stays exactly where "
                + "it is. Nothing happens until they press the button.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .optional("claim", "string",
                        "Which patch. Leave out to use the one they're stood in.")
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
        String which = ToolArgs.optionalString(args, "claim");
        Regions.Box box = book.resolve(player, which);
        if (box == null) {
            return "I can't tell which patch they mean. Ask them, or call list_claims and "
                    + "read them the names.";
        }
        if (!player.getUniqueId().equals(box.owner())) {
            return "No — that one isn't theirs to give up.";
        }
        desk.park(player.getUniqueId(), ClaimDesk.Kind.ABANDON, null, book.label(box),
                box.world());

        return "Ready to give up '" + book.label(box) + "', " + box.width() + " blocks across."
                + " Make sure they understand nothing gets broken — the buildings all stay,"
                + " they just stop being protected, and anyone could then change them. Ask if"
                + " they're sure. They still have to press the button.";
    }
}
