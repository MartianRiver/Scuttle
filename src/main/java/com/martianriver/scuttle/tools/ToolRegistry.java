package com.martianriver.scuttle.tools;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.llm.ToolCall;
import com.martianriver.scuttle.safety.Tier;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Holds the tool catalogue, renders it as an OpenAI-compatible {@code tools}
 * array, and dispatches calls.
 *
 * <p>This is the security boundary. Every call is checked against the
 * allowlist and the caller's tier before it runs, and anything touching the
 * world hops to the main thread here rather than in the tool itself — so the
 * async-call → runTask() pattern lives in exactly one place.
 */
public final class ToolRegistry {

    private static final String MODULE = "tools";
    private static final long MAIN_THREAD_TIMEOUT_SECONDS = 5;

    private final Plugin plugin;
    private final Map<String, Tool> tools = new LinkedHashMap<>();
    private JsonArray cachedSchema;

    public ToolRegistry(Plugin plugin) {
        this.plugin = plugin;
    }

    public void register(Tool tool) {
        tools.put(tool.name(), tool);
        cachedSchema = null;
        Log.debug(MODULE, "registered tool", "name", tool.name(), "tier", tool.requiredTier());
    }

    public int size() {
        return tools.size();
    }

    /** The `tools` array sent on every request. Stable order, so it caches well. */
    public JsonArray schema() {
        if (cachedSchema != null) return cachedSchema;

        JsonArray arr = new JsonArray();
        for (Tool tool : tools.values()) {
            JsonObject fn = new JsonObject();
            fn.addProperty("name", tool.name());
            fn.addProperty("description", tool.description());
            fn.add("parameters", tool.parameters());

            JsonObject entry = new JsonObject();
            entry.addProperty("type", "function");
            entry.add("function", fn);
            arr.add(entry);
        }
        cachedSchema = arr;
        return arr;
    }

    /**
     * Validates and runs one call. Never throws — a refusal comes back as text
     * for the model, so Scuttle can explain it in character instead of the
     * turn collapsing.
     *
     * <p>Must be called off the main thread.
     */
    public String dispatch(Player player, ToolCall call) {
        Tool tool = tools.get(call.name());
        if (tool == null) {
            // A jailbroken model can name anything it likes; nothing outside the
            // allowlist is reachable.
            Log.warn(MODULE, "model asked for an unknown tool", "name", call.name());
            return "DENIED: there is no tool called '" + call.name() + "'.";
        }

        Tier tier = Tier.of(player);
        if (!tier.isAtLeast(tool.requiredTier())) {
            Log.info(MODULE, "tool denied by tier",
                    "tool", tool.name(), "player", player.getName(),
                    "has", tier, "needs", tool.requiredTier());
            return "DENIED: " + player.getName() + " is not allowed to use " + tool.name() + ".";
        }

        try {
            String result = tool.needsMainThread()
                    ? runOnMainThread(player, tool, call.arguments())
                    : tool.execute(player, call.arguments());
            Log.debug(MODULE, "tool ok", "tool", tool.name(), "player", player.getName());
            return result;
        } catch (Tool.ToolException e) {
            Log.debug(MODULE, "tool refused", "tool", tool.name(), "reason", e.getMessage());
            return "DENIED: " + e.getMessage();
        } catch (Exception e) {
            Log.error(MODULE, "tool threw", e, "tool", tool.name());
            return "ERROR: " + tool.name() + " failed unexpectedly.";
        }
    }

    private String runOnMainThread(Player player, Tool tool, JsonObject args) throws Exception {
        Future<String> future = Bukkit.getScheduler()
                .callSyncMethod(plugin, () -> tool.execute(player, args));
        try {
            return future.get(MAIN_THREAD_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Tool.ToolException te) throw te;
            throw e;
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new Tool.ToolException(tool.name() + " took too long and was cancelled.");
        }
    }
}
