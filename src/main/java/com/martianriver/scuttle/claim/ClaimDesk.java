package com.martianriver.scuttle.claim;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.regions.Regions;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The one land decision a player is currently sitting on, and the code that
 * carries it out when they say yes.
 *
 * <p>Same escrow as {@code TradeDesk} and {@code HunchDesk}: the model asks,
 * {@link ClaimBook} decides, this parks the decision, and nothing touches a
 * region until the player themselves presses the button. Everything is checked
 * again at that moment rather than trusted from before — a kid can walk a long
 * way in ninety seconds, and someone else can claim the ground they were stood
 * on while they think about it.
 *
 * <p>Main thread only.
 */
public final class ClaimDesk {

    private static final String MODULE = "claim";

    public enum Kind { CREATE, RESIZE, ABANDON }

    public record Pending(Kind kind, ClaimBook.Proposal proposal, String label,
                          String worldName, long parkedAt, long expiresAt) {

        public boolean expired(long now) {
            return now >= expiresAt;
        }
    }

    public enum Result { DONE, EXPIRED, NOTHING_PENDING, GONE, FAILED }

    /**
     * What happened, and why if it didn't work.
     *
     * <p>The reason rides back with the result rather than living in a field on
     * the desk: two kids confirming at the same moment would otherwise read each
     * other's excuses.
     */
    public record Done(Result result, String problem) {

        static Done ok() {
            return new Done(Result.DONE, null);
        }

        static Done no(Result result, String problem) {
            return new Done(result, problem);
        }
    }

    private final Regions regions;
    private final ClaimBook book;
    private final Map<UUID, Pending> pending = new ConcurrentHashMap<>();
    private volatile ScuttleConfig config;

    public ClaimDesk(Regions regions, ClaimBook book, ScuttleConfig config) {
        this.regions = regions;
        this.book = book;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    public Pending pendingFor(UUID player) {
        Pending parked = pending.get(player);
        if (parked == null) return null;
        if (parked.expired(System.currentTimeMillis())) {
            pending.remove(player);
            return null;
        }
        return parked;
    }

    /** When the current proposal was parked, or 0. Used to break yes/no ties. */
    public long pendingSince(UUID player) {
        Pending parked = pendingFor(player);
        return parked == null ? 0L : parked.parkedAt();
    }

    public void park(UUID player, Kind kind, ClaimBook.Proposal proposal, String label,
                     String worldName) {
        long now = System.currentTimeMillis();
        pending.put(player, new Pending(kind, proposal, label, worldName, now,
                now + config.claimOfferSeconds * 1000L));
    }

    public void clear(UUID player) {
        pending.remove(player);
    }

    /** Carries out whatever they just agreed to. Main thread only. */
    public Done accept(Player player) {
        UUID id = player.getUniqueId();
        Pending parked = pendingFor(id);
        if (parked == null) {
            return Done.no(pending.containsKey(id) ? Result.EXPIRED : Result.NOTHING_PENDING,
                    null);
        }
        pending.remove(id);

        return switch (parked.kind()) {
            case CREATE -> doCreate(player, parked);
            case RESIZE -> doResize(player, parked);
            case ABANDON -> doAbandon(player, parked);
        };
    }

    private Done doCreate(Player player, Pending parked) {
        ClaimBook.Proposal p = parked.proposal();
        // Re-run the whole check, not just the overlap: their allowance may have
        // gone in the meantime, and so may the ground. Deliberately recheck()
        // rather than propose() — propose centres on where they are standing
        // *now*, so it would fence off wherever they wandered to while deciding
        // instead of the square they actually agreed to.
        ClaimBook.Outcome fresh = book.recheck(player, p);
        if (!fresh.ok()) return Done.no(Result.GONE, fresh.refusal());
        ClaimBook.Proposal now = fresh.proposal();
        String problem = regions.create(now.world(), now.id(),
                now.minX(), now.minY(), now.minZ(), now.maxX(), now.maxY(), now.maxZ(),
                player.getUniqueId(), "Entering " + now.label());
        if (problem != null) return Done.no(Result.FAILED, problem);

        Log.info(MODULE, "claim staked", "player", player.getName(), "id", now.id(),
                "blocks", now.blocks());
        return Done.ok();
    }

    private Done doResize(Player player, Pending parked) {
        Regions.Box box = book.resolve(player, parked.label());
        if (box == null) return Done.no(Result.GONE, "I can't find that patch any more.");

        ClaimBook.Outcome fresh = book.proposeResize(player, box, parked.proposal().blocks());
        if (!fresh.ok()) return Done.no(Result.GONE, fresh.refusal());
        ClaimBook.Proposal now = fresh.proposal();
        String problem = regions.reshape(now.world(), box.id(),
                now.minX(), now.minY(), now.minZ(), now.maxX(), now.maxY(), now.maxZ());
        if (problem != null) return Done.no(Result.FAILED, problem);

        Log.info(MODULE, "claim resized", "player", player.getName(), "id", box.id(),
                "blocks", now.blocks());
        return Done.ok();
    }

    private Done doAbandon(Player player, Pending parked) {
        Regions.Box box = book.resolve(player, parked.label());
        if (box == null) return Done.no(Result.GONE, "I can't find that patch any more.");
        if (!player.getUniqueId().equals(box.owner())) {
            return Done.no(Result.GONE, "that one isn't theirs to give up.");
        }
        World world = Bukkit.getWorld(box.world());
        if (world == null) return Done.no(Result.FAILED, "I can't get at that world just now.");

        String problem = regions.remove(world, box.id());
        if (problem != null) return Done.no(Result.FAILED, problem);

        Log.info(MODULE, "claim given up", "player", player.getName(), "id", box.id());
        return Done.ok();
    }
}
