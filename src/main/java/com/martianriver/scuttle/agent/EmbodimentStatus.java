package com.martianriver.scuttle.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * What Scuttle's embodied body (the mineflayer process in {@code bot/}) is doing right
 * now. Pushed here over RCON via {@code /scuttle embodiment <json>} rather than a shared
 * file — the bot and the plugin run on different machines (a separate box vs. the game host),
 * so there's no filesystem to share.
 */
public final class EmbodimentStatus {

    private static final long STALE_AFTER_MILLIS = 5 * 60 * 1000;

    private record Snapshot(String task, String location, List<String> nearbyPlayers, long atMillis) {}

    private final AtomicReference<Snapshot> current = new AtomicReference<>();

    /** Returns false on unparseable input rather than throwing — a bad payload shouldn't kill the command. */
    public boolean updateFromJson(String json) {
        try {
            JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
            String task = obj.has("task") ? obj.get("task").getAsString() : "";
            String location = obj.has("location") ? obj.get("location").getAsString() : "";
            List<String> nearby = new ArrayList<>();
            if (obj.has("nearbyPlayers")) {
                JsonArray arr = obj.getAsJsonArray("nearbyPlayers");
                for (JsonElement e : arr) nearby.add(e.getAsString());
            }
            current.set(new Snapshot(task, location, nearby, System.currentTimeMillis()));
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Empty when the bot has never reported in, or hasn't recently — fails open into silence. */
    public String render() {
        Snapshot s = current.get();
        if (s == null) return "";
        if (System.currentTimeMillis() - s.atMillis() > STALE_AFTER_MILLIS) return "";

        StringBuilder sb = new StringBuilder(128);
        sb.append("YOUR BODY RIGHT NOW:\n");
        sb.append("- Doing: ").append(s.task().isBlank() ? "nothing in particular" : s.task()).append('\n');
        if (!s.location().isBlank()) {
            sb.append("- Near: ").append(s.location()).append('\n');
        }
        if (!s.nearbyPlayers().isEmpty()) {
            sb.append("- Players nearby: ").append(String.join(", ", s.nearbyPlayers())).append('\n');
        }
        return sb.toString();
    }
}
