package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.find.Find;
import com.martianriver.scuttle.find.HunchDesk;
import com.martianriver.scuttle.find.PlaceFinder;
import com.martianriver.scuttle.find.PlaceSearch;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.Tool;
import org.bukkit.entity.Player;

/**
 * "where's a good cave for mining?" / "where's the nearest village?"
 *
 * <p>Unlike {@link FindOreTool} this uses the same locator vanilla's
 * {@code /locate} does, so it works at range and doesn't care what's loaded.
 */
public final class FindPlaceTool implements Tool {

    private final HunchDesk desk;
    private volatile ScuttleConfig config;

    public FindPlaceTool(HunchDesk desk, ScuttleConfig config) {
        this.desk = desk;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    @Override
    public String name() {
        return "find_place";
    }

    @Override
    public String description() {
        return "Find the nearest real place of a given kind — a structure or a biome. Villages, "
                + "mineshafts, strongholds, ancient cities, ruined portals, buried treasure, "
                + "trial chambers, monuments, fortresses; and any biome, so \"a cave for "
                + "mining\" (lush and dripstone caves), a desert, a jungle, mushroom fields. "
                + "Works at a long distance, unlike find_ore. Use the kid's own words for the "
                + "place; it handles the fuzzy matching.";
    }

    @Override
    public JsonObject parameters() {
        return ToolArgs.schema()
                .required("place", "string", "The kind of place, e.g. 'mineshaft', 'village', "
                        + "'cave', 'lush cave', 'desert', 'ancient city'")
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

        String query = ToolArgs.string(args, "place");
        PlaceSearch.Place place = PlaceSearch.resolve(query);
        if (place == null) {
            throw new ToolException("no such place as '" + query + "' — it isn't a structure or"
                    + " a biome this game has");
        }

        Find find = PlaceFinder.find(player.getLocation(), place,
                config.structureRadiusChunks, config.biomeRadiusBlocks);
        if (find == null) {
            return "No " + place.label() + " within range of here. Some things simply aren't in"
                    + " this part of the world, and some are in another dimension entirely —"
                    + " say which you think it is rather than guessing at a direction.";
        }

        desk.park(player, find);
        return find.forModel();
    }
}
