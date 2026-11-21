package com.martianriver.scuttle.chat;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/** The last few lines said on the server, so Scuttle can follow a conversation. */
public final class RecentChat {

    private static final int LINES = 6;
    private static final int MAX_LENGTH = 120;

    private final Deque<String> lines = new ArrayDeque<>();

    public synchronized void add(String speaker, String text) {
        String line = speaker + ": " + text;
        if (line.length() > MAX_LENGTH) line = line.substring(0, MAX_LENGTH) + "…";
        lines.addLast(line);
        while (lines.size() > LINES) {
            lines.pollFirst();
        }
    }

    public synchronized List<String> lines() {
        return new ArrayList<>(lines);
    }
}
