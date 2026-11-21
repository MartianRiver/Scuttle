package com.martianriver.scuttle.find;

import org.bukkit.Location;

/**
 * Somewhere Scuttle has found, and how it would describe getting there.
 *
 * <p>The exact spot stays in here rather than going out in the tool result. The
 * model is told the direction and the distance; Java keeps the coordinate and
 * uses it to point a compass. That way a coordinate the model never saw can't
 * be one it invents, and §14's "no arbitrary coordinates" holds by construction
 * rather than by asking the prompt nicely.
 */
public record Find(String what, Location where, String bearing, String note) {

    public Find(String what, Location where, String bearing) {
        this(what, where, bearing, null);
    }

    /** What the model is told. Deliberately has no numbers it could read out. */
    public String forModel() {
        StringBuilder sb = new StringBuilder(120);
        sb.append("Found ").append(what).append(": ").append(bearing).append('.');
        if (note != null) sb.append(' ').append(note);
        sb.append("\nYou have NOT told them yet — say it in your own words, and offer them")
                .append(" a hunch to follow. The buttons appear on their own.");
        return sb.toString();
    }
}
