package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.config.ScuttleConfig;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who Scuttle is mid-conversation with.
 *
 * <p>Having to say "scuttle" every single line makes talking to it feel like
 * operating a vending machine. So for a short while after it answers you, your
 * next message reaches it without the name — and the window refreshes each time
 * it replies, so a real back-and-forth keeps going.
 *
 * <p>Deliberately per-player: one kid chatting to Scuttle doesn't make it
 * answer everything the others say.
 */
public final class Engagement {

    private final Map<UUID, Long> lastReply = new ConcurrentHashMap<>();
    private volatile ScuttleConfig config;

    public Engagement(ScuttleConfig config) {
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    /** Called when Scuttle actually says something to this player. */
    public void touch(UUID player) {
        lastReply.put(player, System.currentTimeMillis());
    }

    public boolean engaged(UUID player) {
        int seconds = config.followOnSeconds;
        if (seconds <= 0) return false;

        Long last = lastReply.get(player);
        if (last == null) return false;
        if (System.currentTimeMillis() - last > seconds * 1000L) {
            lastReply.remove(player);
            return false;
        }
        return true;
    }

    public void end(UUID player) {
        lastReply.remove(player);
    }

    /**
     * "Alex look at this" is not for Scuttle, even mid-conversation. Cheap guard
     * against the obvious case; anything subtler is the model's problem, and a
     * false negative just means the kid types the name again.
     */
    public static boolean aimedAtSomeoneElse(Player speaker, String message) {
        String lower = message.trim().toLowerCase(Locale.ROOT);
        for (Player other : Bukkit.getOnlinePlayers()) {
            if (other.equals(speaker)) continue;
            String name = other.getName().toLowerCase(Locale.ROOT);
            if (lower.startsWith(name) || lower.startsWith("@" + name)) return true;
        }
        return false;
    }
}
