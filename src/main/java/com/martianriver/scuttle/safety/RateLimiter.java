package com.martianriver.scuttle.safety;

import com.martianriver.scuttle.config.ScuttleConfig;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Per-player cooldown, per-minute and per-day caps. Checked before the API call
 * so a spamming kid costs nothing — see SCUTTLE.md §10.
 *
 * <p>State is memory-only and resets on restart. That's deliberate: the daily
 * cap exists to stop a spam loop within one session, not to be an audit record.
 */
public final class RateLimiter {

    /** Why a message was refused. Scuttle explains these in character. */
    public enum Verdict {
        ALLOW,
        COOLDOWN,
        PER_MINUTE,
        PER_DAY
    }

    public record Decision(Verdict verdict, long retryAfterSeconds) {
        public boolean allowed() {
            return verdict == Verdict.ALLOW;
        }
    }

    private static final Decision ALLOWED = new Decision(Verdict.ALLOW, 0);

    private final Map<UUID, Deque<Long>> recent = new HashMap<>();
    private final Map<UUID, Long> lastMessage = new HashMap<>();
    private final Map<UUID, Integer> todayCount = new HashMap<>();
    private final ZoneId zone = ZoneId.systemDefault();

    private ScuttleConfig config;
    private LocalDate countingDate = LocalDate.now();

    public RateLimiter(ScuttleConfig config) {
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    public synchronized Decision check(UUID player) {
        long now = System.currentTimeMillis();
        rolloverDayIfNeeded();

        Long last = lastMessage.get(player);
        if (last != null) {
            long elapsed = (now - last) / 1000L;
            if (elapsed < config.cooldownSeconds) {
                return new Decision(Verdict.COOLDOWN, config.cooldownSeconds - elapsed);
            }
        }

        Deque<Long> window = recent.computeIfAbsent(player, k -> new ArrayDeque<>());
        long cutoff = now - 60_000L;
        while (!window.isEmpty() && window.peekFirst() < cutoff) {
            window.pollFirst();
        }
        if (window.size() >= config.perMinute) {
            long oldest = window.peekFirst();
            return new Decision(Verdict.PER_MINUTE, Math.max(1, (oldest + 60_000L - now) / 1000L));
        }

        int today = todayCount.getOrDefault(player, 0);
        if (today >= config.perDay) {
            return new Decision(Verdict.PER_DAY, 0);
        }

        window.addLast(now);
        lastMessage.put(player, now);
        todayCount.put(player, today + 1);
        return ALLOWED;
    }

    public synchronized int usedToday(UUID player) {
        rolloverDayIfNeeded();
        return todayCount.getOrDefault(player, 0);
    }

    public synchronized void forget(UUID player) {
        recent.remove(player);
        lastMessage.remove(player);
    }

    private void rolloverDayIfNeeded() {
        LocalDate today = LocalDate.now(zone);
        if (!today.equals(countingDate)) {
            countingDate = today;
            todayCount.clear();
        }
    }
}
