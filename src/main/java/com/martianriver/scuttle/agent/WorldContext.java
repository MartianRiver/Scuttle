package com.martianriver.scuttle.agent;

import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The invisible preamble from SCUTTLE.md §8 — where the player is standing and
 * what's around them. This is what makes Scuttle sound like it lives here.
 *
 * <p>Every getter used below touches the world, so {@link #capture} must run on
 * the main thread. It's a plain record afterwards and safe to hand to the async
 * turn.
 */
public record WorldContext(
        String playerName,
        Tier tier,
        String world,
        String dimension,
        int x, int y, int z,
        String biome,
        String timeOfDay,
        String weather,
        String heldItem,
        int health,
        int food,
        List<String> nearby,
        List<String> recentChat) {

    private static final int SCAN_RADIUS = 5;
    private static final int MAX_NEARBY = 8;

    /** Blocks worth mentioning. Stone and dirt are noise; a spawner is a story. */
    private static final Set<Material> NOTABLE = EnumSet.of(
            Material.DIAMOND_ORE, Material.DEEPSLATE_DIAMOND_ORE,
            Material.EMERALD_ORE, Material.DEEPSLATE_EMERALD_ORE,
            Material.GOLD_ORE, Material.DEEPSLATE_GOLD_ORE,
            Material.IRON_ORE, Material.DEEPSLATE_IRON_ORE,
            Material.COAL_ORE, Material.DEEPSLATE_COAL_ORE,
            Material.REDSTONE_ORE, Material.DEEPSLATE_REDSTONE_ORE,
            Material.LAPIS_ORE, Material.DEEPSLATE_LAPIS_ORE,
            Material.ANCIENT_DEBRIS, Material.NETHER_GOLD_ORE, Material.NETHER_QUARTZ_ORE,
            Material.SPAWNER, Material.TRIAL_SPAWNER, Material.VAULT,
            Material.CHEST, Material.TRAPPED_CHEST, Material.ENDER_CHEST, Material.BARREL,
            Material.FURNACE, Material.BLAST_FURNACE, Material.SMOKER,
            Material.CRAFTING_TABLE, Material.ENCHANTING_TABLE, Material.ANVIL,
            Material.BREWING_STAND, Material.BEACON, Material.CONDUIT,
            Material.LAVA, Material.WATER, Material.NETHER_PORTAL, Material.END_PORTAL_FRAME);

    public static WorldContext capture(Player player, List<String> recentChat) {
        Location loc = player.getLocation();
        World world = player.getWorld();

        ItemStack held = player.getInventory().getItemInMainHand();
        String heldName = held == null || held.getType().isAir()
                ? "nothing"
                : held.getAmount() + "x " + MaterialSearch.pretty(held.getType());

        return new WorldContext(
                player.getName(),
                Tier.of(player),
                world.getName(),
                dimensionName(world),
                loc.getBlockX(), loc.getBlockY(), loc.getBlockZ(),
                biomeOf(loc),
                timeOfDay(world.getTime()),
                weather(world),
                heldName,
                (int) Math.round(player.getHealth()),
                player.getFoodLevel(),
                scanNearby(loc),
                List.copyOf(recentChat));
    }

    /** Rendered into the system prompt, one fact per line — cheap for the model to read. */
    public String render() {
        StringBuilder sb = new StringBuilder(256);
        sb.append("RIGHT NOW:\n");
        sb.append("- Talking to: ").append(playerName)
                .append(" (permission level: ").append(tier.name().toLowerCase()).append(")\n");
        sb.append("- Standing in: ").append(biome).append(", ").append(dimension)
                .append(" at x=").append(x).append(" y=").append(y).append(" z=").append(z).append('\n');
        sb.append("- Time: ").append(timeOfDay).append(", ").append(weather).append('\n');
        sb.append("- Holding: ").append(heldItem).append('\n');
        sb.append("- Health ").append(health).append("/20, hunger ").append(food).append("/20\n");
        if (!nearby.isEmpty()) {
            sb.append("- Nearby: ").append(String.join(", ", nearby)).append('\n');
        }
        if (!recentChat.isEmpty()) {
            sb.append("- Last few lines of chat:\n");
            for (String line : recentChat) {
                sb.append("    ").append(line).append('\n');
            }
        }
        return sb.toString();
    }

    private static String dimensionName(World world) {
        return switch (world.getEnvironment()) {
            case NETHER -> "the Nether";
            case THE_END -> "the End";
            default -> "the Overworld";
        };
    }

    private static String biomeOf(Location loc) {
        // Biome stopped being an enum; the key's value ("swamp") is the readable part.
        return loc.getBlock().getBiome().getKey().getKey().replace('_', ' ');
    }

    private static String timeOfDay(long ticks) {
        if (ticks < 1000) return "sunrise";
        if (ticks < 6000) return "morning";
        if (ticks < 9000) return "midday";
        if (ticks < 12000) return "afternoon";
        if (ticks < 13800) return "sunset";
        if (ticks < 18000) return "night";
        if (ticks < 23000) return "the small hours";
        return "just before dawn";
    }

    private static String weather(World world) {
        if (world.isThundering()) return "a thunderstorm";
        if (world.hasStorm()) return "raining";
        return "clear";
    }

    private static List<String> scanNearby(Location centre) {
        Set<String> found = new LinkedHashSet<>();
        World world = centre.getWorld();
        int cx = centre.getBlockX();
        int cy = centre.getBlockY();
        int cz = centre.getBlockZ();

        for (int dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
            for (int dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
                for (int dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
                    Block block = world.getBlockAt(cx + dx, cy + dy, cz + dz);
                    Material type = block.getType();
                    if (NOTABLE.contains(type)) {
                        found.add(MaterialSearch.pretty(type));
                        if (found.size() >= MAX_NEARBY) return new ArrayList<>(found);
                    }
                }
            }
        }
        return new ArrayList<>(found);
    }
}
