package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.find.Find;
import com.martianriver.scuttle.find.HunchDesk;
import com.martianriver.scuttle.find.OreScan;
import com.martianriver.scuttle.find.Ores;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.entity.Player;

/**
 * "scuttle, where are the closest diamonds?"
 *
 * <p>Only sees chunks the server already has loaded, which is the whole point —
 * see {@link OreScan}.
 */
public final class FindOreTool implements Tool {

    private final HunchDesk desk;
    private volatile ScuttleConfig config;

    public FindOreTool(HunchDesk desk, ScuttleConfig config) {
        this.desk = desk;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    @Override
    public String name() {
        return "find_ore";
    }

    @Override
    public String description() {
        return "Sniff out the nearest actual ore to this player, right now. Use it when they "
                + "ask where something is — \"where's the closest diamond\", \"any iron near "
                + "me\". You can only smell as far as the ground you can sense, so this fails "
                + "when they're on the surface or nowhere near any; that is a normal answer, "
                + "not an error, and the honest reply is to tell them to get underground and "
                + "ask again. Known: " + String.join(", ", Ores.all().keySet()) + ". For where "
                + "a thing turns up in general rather than where one is, use where_to_find.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("ore", "string", "What they're after, e.g. 'diamond', 'iron', "
                        + "'ancient debris'")
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
        if (!config.findEnabled) throw new ToolException("finding things is switched off");

        String query = ToolArgs.string(args, "ore");
        Ores.Ore ore = Ores.resolve(query);
        if (ore == null) {
            throw new ToolException("you can't smell '" + query + "' — you only know how to "
                    + "find: " + String.join(", ", Ores.all().keySet()));
        }

        Find find = OreScan.nearest(player.getLocation(), ore.blocks(), ore.label(),
                config.oreChunkRadius, config.oreYBand, config.oreBudgetMillis);
        if (find == null) {
            return "No " + ore.label() + " anywhere you can sense from here. That's not a"
                    + " failure — it means they're too far from any, or still up on the"
                    + " surface. Tell them so, and tell them to get underground and ask"
                    + " again. Don't guess at a direction.";
        }

        desk.park(player, find);
        return find.forModel();
    }
}
