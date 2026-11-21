package com.martianriver.scuttle.find;

import org.bukkit.Location;

/**
 * Turns two points into the sort of directions a person gives.
 *
 * <p>Coordinates are a bad interface for a nine-year-old — three axes, two of
 * them often negative, and you need F3 open to read them. So Scuttle talks the
 * way someone standing next to you would, and the exact numbers stay in Java
 * where they're used to point a compass.
 */
public final class Bearing {

    private Bearing() {
    }

    private static final String[] POINTS = {
            "south", "south-west", "west", "north-west",
            "north", "north-east", "east", "south-east"};

    /** "about 90 blocks north-west, and a good 40 below you" */
    public static String describe(Location from, Location to) {
        double dx = to.getX() - from.getX();
        double dz = to.getZ() - from.getZ();
        int dy = to.getBlockY() - from.getBlockY();
        double flat = Math.sqrt(dx * dx + dz * dz);

        StringBuilder sb = new StringBuilder(64);
        if (flat < 8) {
            sb.append("practically on top of you");
        } else {
            sb.append("about ").append(round(flat)).append(" blocks ").append(compass(dx, dz));
        }
        sb.append(", ").append(depth(dy));
        return sb.toString();
    }

    /**
     * Eight-point compass. Minecraft's south is +z and east is +x, so the angle
     * is measured off south rather than off north — getting this backwards sends
     * a child the wrong way, which is the one bug here that isn't self-correcting.
     */
    public static String compass(double dx, double dz) {
        double degrees = Math.toDegrees(Math.atan2(dx, dz));
        int index = (int) Math.round(((degrees % 360) + 360) % 360 / 45.0) % 8;
        return POINTS[index];
    }

    private static String depth(int dy) {
        if (Math.abs(dy) <= 4) return "on much the same level as you";
        if (dy < 0) {
            return dy <= -40 ? "and a long way down — " + (-dy) + " below you"
                    : "and " + (-dy) + " or so below you";
        }
        return dy >= 40 ? "and a long way up — " + dy + " above you"
                : "and " + dy + " or so above you";
    }

    /** Round to something a person would actually say: 90 blocks, not 87.3. */
    private static long round(double blocks) {
        if (blocks < 40) return Math.round(blocks / 5) * 5;
        return Math.round(blocks / 10) * 10;
    }
}
