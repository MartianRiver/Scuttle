package com.martianriver.scuttle.agent;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.llm.ChatMessage;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Sliding window of the last few turns per player (SCUTTLE.md §9). This is the
 * main cost lever after model choice, so it stays small and drops old entries
 * rather than summarising them.
 *
 * <p>Tool calls and their results are not kept — only what was said. Replaying
 * a stale lookup would be worse than looking it up again.
 */
public final class History {

    private record Entry(String role, String content, long at) {
    }

    private final Map<UUID, Deque<Entry>> byPlayer = new HashMap<>();
    private ScuttleConfig config;

    public History(ScuttleConfig config) {
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    public synchronized List<ChatMessage> recall(UUID player) {
        Deque<Entry> entries = byPlayer.get(player);
        if (entries == null || entries.isEmpty()) return List.of();

        expire(entries);

        List<ChatMessage> out = new ArrayList<>(entries.size());
        for (Entry e : entries) {
            out.add(new ChatMessage(e.role(), e.content(), List.of(), null, false));
        }
        return out;
    }

    public synchronized void remember(UUID player, String question, String answer) {
        Deque<Entry> entries = byPlayer.computeIfAbsent(player, k -> new ArrayDeque<>());
        long now = System.currentTimeMillis();
        entries.addLast(new Entry("user", question, now));
        entries.addLast(new Entry("assistant", answer, now));
        trim(entries);
    }

    public synchronized void forget(UUID player) {
        byPlayer.remove(player);
    }

    public synchronized void forgetAll() {
        byPlayer.clear();
    }

    private void trim(Deque<Entry> entries) {
        while (entries.size() > config.historyWindow) {
            entries.pollFirst();
        }
        alignToUser(entries);
    }

    /** A conversation resumed an hour later isn't the same conversation. */
    private void expire(Deque<Entry> entries) {
        long cutoff = System.currentTimeMillis() - config.historyExpireMinutes * 60_000L;
        while (!entries.isEmpty() && entries.peekFirst().at() < cutoff) {
            entries.pollFirst();
        }
        alignToUser(entries);
    }

    /** History must start on a user turn — a dangling reply confuses the model. */
    private void alignToUser(Deque<Entry> entries) {
        while (!entries.isEmpty() && !"user".equals(entries.peekFirst().role())) {
            entries.pollFirst();
        }
    }
}
