package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.find.Bearing;
import com.martianriver.scuttle.regions.Regions;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.util.List;

/**
 * What ground a player has, how big, and who else can get in.
 *
 * <p>Directions rather than coordinates, same as {@code find/} — a nine-year-old
 * can follow "a hundred blocks north-west" and can't follow three numbers.
 */
public final class ListClaimsTool implements Tool {

    private final ClaimBook book;

    public ListClaimsTool(ClaimBook book) {
        this.book = book;
    }

    @Override
    public String name() {
        return "list_claims";
    }

    @Override
    public String description() {
        return "What land this player has fenced off, how big each patch is, and who they've "
                + "let in. Use it for \"what land do I have\", \"who can build in my base\", "
                + "and before telling them they're out of space.";
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
        if (!book.available()) {
            throw new ToolException("land claiming isn't set up on this server");
        }
        List<Regions.Box> mine = book.claimsOf(player);
        int allowed = book.allowance(player);
        if (mine.isEmpty()) {
            return "They haven't fenced anything off yet — none of their " + allowed
                    + ". If they've built something worth keeping, offer to peg it out.";
        }

        StringBuilder sb = new StringBuilder(200);
        sb.append("They've got ").append(mine.size()).append(" of ").append(allowed)
                .append(":\n");
        for (Regions.Box box : mine) {
            sb.append("- '").append(book.label(box)).append("', ")
                    .append(box.width()).append(" by ").append(box.depth()).append(" blocks");
            World world = Bukkit.getWorld(box.world());
            if (world != null && world.equals(player.getWorld())) {
                sb.append(", ").append(Bearing.describe(player.getLocation(),
                        box.centre(world)));
            } else {
                sb.append(", over in ").append(box.world());
            }
            sb.append(box.members().isEmpty() ? ", nobody else allowed in"
                    : ", shared with " + String.join(" and ", box.members()));
            sb.append('\n');
        }
        sb.append("Say the sizes in a way they can picture, and don't read out any numbers ")
                .append("that look like coordinates — you haven't got any.");
        return sb.toString();
    }
}
