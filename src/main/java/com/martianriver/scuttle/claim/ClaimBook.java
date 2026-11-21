package com.martianriver.scuttle.claim;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.regions.Regions;
import com.martianriver.scuttle.safety.Tier;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Who may fence off what, and how big.
 *
 * <p>The security boundary for land, in the same sense as {@code TradeGuard} is
 * for money (SCUTTLE.md §6): the model may <em>ask</em> for a claim of any size
 * anywhere, and every number that decides what actually happens is worked out
 * here. The model never supplies a coordinate — a claim is always centred on the
 * player who asked for it — so the worst a jailbroken model can do is request a
 * box round a child who is standing somewhere they are allowed to stand.
 *
 * <p>Ownership is never taken from the model either. It is read back out of the
 * region's own owner list, which is what WorldGuard itself enforces against.
 *
 * <p>Main thread only.
 */
public final class ClaimBook {

    /** A claim worked out and checked, waiting for the player to say yes. */
    public record Proposal(String id, String label, World world,
                           int minX, int minY, int minZ, int maxX, int maxY, int maxZ,
                           int blocks, boolean fullHeight) {

        public int width() {
            return maxX - minX + 1;
        }
    }

    /** Either a proposal or the reason there isn't one. Never both. */
    public record Outcome(Proposal proposal, String refusal) {

        static Outcome no(String why) {
            return new Outcome(null, why);
        }

        static Outcome yes(Proposal proposal) {
            return new Outcome(proposal, null);
        }

        public boolean ok() {
            return proposal != null;
        }
    }

    private final Regions regions;
    private volatile ScuttleConfig config;

    public ClaimBook(Regions regions, ScuttleConfig config) {
        this.regions = regions;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    public boolean available() {
        return config.claimsEnabled && regions != null;
    }

    public String prefix() {
        return config.claimPrefix;
    }

    public int allowance(Player player) {
        return Tier.of(player).isAtLeast(Tier.PARENT)
                ? config.claimsPerParent : config.claimsPerKid;
    }

    public List<Regions.Box> claimsOf(Player player) {
        return regions.claimsOf(player.getUniqueId(), config.claimPrefix);
    }

    public Regions.Box claimAt(Location where) {
        return regions.claimAt(where, config.claimPrefix);
    }

    /** The friendly half of a claim id — what a kid called it. */
    public String label(Regions.Box box) {
        return label(box.id());
    }

    public String label(String id) {
        int cut = id.lastIndexOf("--");
        if (cut >= 0) return id.substring(cut + 2);
        return id.startsWith(config.claimPrefix) ? id.substring(config.claimPrefix.length()) : id;
    }

    /**
     * Which claim a command is about.
     *
     * <p>Standing in one means that one — which is how a person would mean it.
     * Otherwise a name, otherwise the only one they've got. Anything else is
     * genuinely ambiguous and says so rather than guessing, because guessing
     * wrong here hands the wrong person the keys to the wrong house.
     */
    public Regions.Box resolve(Player player, String name) {
        List<Regions.Box> mine = claimsOf(player);
        if (mine.isEmpty()) return null;

        if (name != null && !name.isBlank()) {
            String want = slug(name);
            for (Regions.Box box : mine) {
                if (label(box).equals(want)) return box;
            }
            return null;
        }
        Regions.Box here = claimAt(player.getLocation());
        if (here != null && player.getUniqueId().equals(here.owner())) return here;
        return mine.size() == 1 ? mine.get(0) : null;
    }

    /** Works out a claim centred on the player, and checks every rule against it. */
    public Outcome propose(Player player, String name, Integer requested) {
        if (!available()) {
            return Outcome.no("land claiming is switched off on this server.");
        }
        List<Regions.Box> mine = claimsOf(player);
        int allowed = allowance(player);
        if (mine.size() >= allowed) {
            return Outcome.no("they've already got " + mine.size() + " of " + allowed
                    + " patches, which is the lot. They'd have to give one up first —"
                    + " tell them which ones they have and let them choose.");
        }

        Location at = player.getLocation();
        World world = at.getWorld();
        if (world == null) return Outcome.no("I can't tell where they're standing.");

        int blocks = clamp(requested == null ? config.claimDefaultBlocks : requested,
                config.claimMinBlocks, config.claimMaxBlocks);

        Regions.Box standing = claimAt(at);
        if (standing != null) {
            boolean theirs = player.getUniqueId().equals(standing.owner());
            return Outcome.no(theirs
                    ? "they're stood inside their own patch '" + label(standing) + "' already."
                    + " If they want it bigger, that's a resize, not a new one."
                    : "that ground already belongs to someone else. They'll need to walk"
                    + " somewhere unclaimed.");
        }

        int half = blocks / 2;
        int minX = at.getBlockX() - half;
        int maxX = minX + blocks - 1;
        int minZ = at.getBlockZ() - half;
        int maxZ = minZ + blocks - 1;
        int minY = config.claimFullHeight ? world.getMinHeight()
                : Math.max(world.getMinHeight(), at.getBlockY() - config.claimHeightBand);
        int maxY = config.claimFullHeight ? world.getMaxHeight() - 1
                : Math.min(world.getMaxHeight() - 1, at.getBlockY() + config.claimHeightBand);

        String tooClose = spawnCheck(world, minX, minZ, maxX, maxZ);
        if (tooClose != null) return Outcome.no(tooClose);

        List<String> clash = regions.overlaps(world, minX, minY, minZ, maxX, maxY, maxZ, null);
        if (!clash.isEmpty()) {
            return Outcome.no("a " + blocks + "-block patch there would run into "
                    + describeClash(clash) + ". They could ask for a smaller one, or move"
                    + " along and try again.");
        }

        String id = uniqueId(player, world, name);
        return Outcome.yes(new Proposal(id, label(id), world, minX, minY, minZ,
                maxX, maxY, maxZ, blocks, config.claimFullHeight));
    }

    /**
     * The same rules again, against ground that was measured out earlier.
     *
     * <p>What the escrow needs on the yes, and not the same thing as calling
     * {@link #propose} twice: propose centres on wherever the player is
     * standing *now*, so re-proposing would quietly fence off somewhere they
     * walked to while they were deciding. They agreed to a specific square, so
     * that square is what gets re-checked — the ground can be taken while they
     * think, but it can't move.
     */
    public Outcome recheck(Player player, Proposal p) {
        if (!available()) {
            return Outcome.no("land claiming is switched off on this server.");
        }
        List<Regions.Box> mine = claimsOf(player);
        int allowed = allowance(player);
        if (mine.size() >= allowed) {
            return Outcome.no("they've used up all " + allowed + " of their patches since I"
                    + " measured that out. They'd have to give one up first.");
        }
        String tooClose = spawnCheck(p.world(), p.minX(), p.minZ(), p.maxX(), p.maxZ());
        if (tooClose != null) return Outcome.no(tooClose);

        List<String> clash = regions.overlaps(p.world(), p.minX(), p.minY(), p.minZ(),
                p.maxX(), p.maxY(), p.maxZ(), null);
        if (!clash.isEmpty()) {
            return Outcome.no("someone's spoken for that ground while they were thinking about"
                    + " it. They'll need to find another spot.");
        }
        // The id may have been taken in the meantime by their own second claim.
        String id = regions.exists(p.world(), p.id()) ? uniqueId(player, p.world(), p.label())
                : p.id();
        return Outcome.yes(new Proposal(id, label(id), p.world(),
                p.minX(), p.minY(), p.minZ(), p.maxX(), p.maxY(), p.maxZ(),
                p.blocks(), p.fullHeight()));
    }

    /** Same rules, but round an existing claim's middle rather than the player. */
    public Outcome proposeResize(Player player, Regions.Box box, int requested) {
        if (!available()) return Outcome.no("land claiming is switched off on this server.");
        if (!player.getUniqueId().equals(box.owner())) {
            return Outcome.no("that patch isn't theirs to change.");
        }
        World world = org.bukkit.Bukkit.getWorld(box.world());
        if (world == null) return Outcome.no("I can't get at that world just now.");

        int blocks = clamp(requested, config.claimMinBlocks, config.claimMaxBlocks);
        int centreX = (box.minX() + box.maxX()) / 2;
        int centreZ = (box.minZ() + box.maxZ()) / 2;
        int half = blocks / 2;
        int minX = centreX - half;
        int maxX = minX + blocks - 1;
        int minZ = centreZ - half;
        int maxZ = minZ + blocks - 1;

        // Checked on the way up as well as on the way in: a patch pegged out just
        // beyond the buffer could otherwise be grown straight over spawn, and the
        // overlap check only helps if spawn happens to be a region.
        String tooClose = spawnCheck(world, minX, minZ, maxX, maxZ);
        if (tooClose != null) return Outcome.no(tooClose);

        List<String> clash =
                regions.overlaps(world, minX, box.minY(), minZ, maxX, box.maxY(), maxZ, box.id());
        if (!clash.isEmpty()) {
            return Outcome.no("it can't grow that way — it would run into "
                    + describeClash(clash) + ". A smaller change might fit.");
        }
        return Outcome.yes(new Proposal(box.id(), label(box), world,
                minX, box.minY(), minZ, maxX, box.maxY(), maxZ, blocks,
                config.claimFullHeight));
    }

    /**
     * Measures the claim's nearest edge, not its middle. "The first N blocks
     * stay everyone's" is a statement about the ground, so a big claim centred
     * just outside the buffer still must not reach into it.
     */
    private String spawnCheck(World world, int minX, int minZ, int maxX, int maxZ) {
        int keep = config.claimSpawnBuffer;
        if (keep <= 0) return null;
        Location spawn = world.getSpawnLocation();
        if (spawn.getWorld() == null || !spawn.getWorld().equals(world)) return null;

        // Distance from spawn to the box, which is zero when spawn is inside it.
        double dx = Math.max(0, Math.max(minX - spawn.getX(), spawn.getX() - maxX));
        double dz = Math.max(0, Math.max(minZ - spawn.getZ(), spawn.getZ() - maxZ));
        if (Math.sqrt(dx * dx + dz * dz) >= keep) return null;
        return "that's too close to spawn — the first " + keep + " blocks stay everyone's."
                + " Tell them to head out a bit and ask again.";
    }

    private static String describeClash(List<String> ids) {
        if (ids.size() == 1) return "somewhere that's already spoken for";
        return "a couple of places that are already spoken for";
    }

    private String uniqueId(Player player, World world, String name) {
        String owner = slug(player.getName());
        String wanted = slug(name == null || name.isBlank() ? "home" : name);
        if (wanted.isEmpty()) wanted = "home";

        String base = config.claimPrefix + owner + "--" + wanted;
        if (!regions.exists(world, base)) return base;
        for (int n = 2; n < 100; n++) {
            String tryId = base + n;
            if (!regions.exists(world, tryId)) return tryId;
        }
        return base + System.currentTimeMillis() % 1000;
    }

    /**
     * Region ids are not free text — WorldGuard wants something tame, and a kid
     * will happily call a place "MY BASE!!! :)".
     */
    public static String slug(String raw) {
        String s = raw.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-");
        s = s.replaceAll("-{2,}", "-").replaceAll("^-|-$", "");
        return s.length() > 24 ? s.substring(0, 24).replaceAll("-$", "") : s;
    }

    private static int clamp(int value, int low, int high) {
        return Math.max(low, Math.min(high, value));
    }
}
