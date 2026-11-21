package com.martianriver.scuttle.tools;

import com.google.gson.JsonObject;
import com.martianriver.scuttle.safety.Tier;
import org.bukkit.entity.Player;

/**
 * A capability the model may ask for. The model supplies typed parameters and
 * nothing else — there is no tool that takes a command string, and there never
 * will be (SCUTTLE.md §6).
 */
public interface Tool {

    /** Name the model calls. Snake case, matching the schema. */
    String name();

    String description();

    /** JSON Schema for the parameters object, as sent in the `tools` array. */
    JsonObject parameters();

    /** Lowest tier allowed to trigger this tool. */
    Tier requiredTier();

    /**
     * True if this touches blocks, entities or inventories and must therefore
     * run on the main server thread. Read-only registry lookups say true too —
     * the registry is safer read from one thread.
     */
    boolean needsMainThread();

    /**
     * Runs the tool. Arguments have already been checked against the tier, but
     * their <em>contents</em> are model-supplied and must be validated here.
     *
     * @return text handed back to the model as the tool result
     */
    String execute(Player player, JsonObject args) throws ToolException;

    /** A refusal or bad input. The message is returned to the model so Scuttle can explain it. */
    class ToolException extends Exception {
        public ToolException(String message) {
            super(message);
        }
    }
}
