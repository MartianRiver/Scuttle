package com.martianriver.scuttle.guard;

import java.util.concurrent.atomic.AtomicReference;

/**
 * The one player Scuttle is genuinely fighting back against right now, if any.
 *
 * <p>Set by {@link GuardListener} once an attacker reaches the third hit (or is
 * {@code scuttle.guard.exempt}); read by {@code /scuttle guard fightstate},
 * which is how bot/ — a separate process with no other view into the plugin —
 * knows to actually swing at someone. Expires on its own so a bot that missed
 * a "stop" message doesn't keep chasing someone who walked off ages ago.
 */
public final class FightState {

    private record Entry(String attacker, long expiresAt) {}

    private final AtomicReference<Entry> current = new AtomicReference<>();

    public void refresh(String attackerName, long ttlMillis) {
        current.set(new Entry(attackerName, System.currentTimeMillis() + ttlMillis));
    }

    public void clear() {
        current.set(null);
    }

    /** Who to keep fighting, or null if there isn't one right now. */
    public String current() {
        Entry e = current.get();
        if (e == null) return null;
        if (System.currentTimeMillis() > e.expiresAt()) return null;
        return e.attacker();
    }
}
