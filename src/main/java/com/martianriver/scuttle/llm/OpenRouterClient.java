package com.martianriver.scuttle.llm;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import org.bukkit.Bukkit;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * OpenRouter's chat-completions endpoint over plain HTTP — there's no official
 * Java SDK, and the OpenAI-compatible shape is small enough not to need one.
 *
 * <p>Every method here blocks. None of them may run on the main server thread;
 * {@link #complete} enforces that rather than trusting callers.
 */
public final class OpenRouterClient {

    private static final String MODULE = "llm";
    private static final URI ENDPOINT = URI.create("https://openrouter.ai/api/v1/chat/completions");

    private final HttpClient http;
    private final ScuttleConfig config;
    private final Gson gson = new Gson();

    public OpenRouterClient(ScuttleConfig config) {
        this.config = config;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    /** Thrown for anything the caller should turn into an in-character apology. */
    public static class LlmException extends Exception {
        public LlmException(String message) {
            super(message);
        }

        public LlmException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public LlmReply complete(String model, List<ChatMessage> messages, JsonArray tools)
            throws LlmException {
        return complete(model, messages, tools, config.maxReplyTokens);
    }

    /** {@code maxTokens} is separate for the yes/no classifier, which needs about four. */
    public LlmReply complete(String model, List<ChatMessage> messages, JsonArray tools,
                             int maxTokens) throws LlmException {

        if (Bukkit.isPrimaryThread()) {
            // Would freeze every player on the server for the duration of the call.
            throw new IllegalStateException("OpenRouter call attempted on the main thread");
        }
        if (!config.hasApiKey()) {
            throw new LlmException("no OpenRouter API key configured");
        }

        String body = gson.toJson(buildRequest(model, messages, tools, maxTokens));
        Log.debug(MODULE, "request", "model", model, "messages", messages.size(),
                "caching", config.promptCaching, "bytes", body.length());
        Log.trace(MODULE, "request body", "json", body);

        int attempts = Math.max(1, config.maxRetries + 1);
        LlmException last = null;

        for (int attempt = 1; attempt <= attempts; attempt++) {
            try {
                return send(body, attempt);
            } catch (LlmException e) {
                last = e;
                if (attempt < attempts) {
                    backoff(attempt);
                }
            }
        }
        throw last;
    }

    private LlmReply send(String body, int attempt) throws LlmException {
        HttpRequest request = HttpRequest.newBuilder(ENDPOINT)
                .timeout(Duration.ofSeconds(config.timeoutSeconds))
                .header("Authorization", "Bearer " + config.apiKey)
                .header("Content-Type", "application/json")
                // OpenRouter uses these for its dashboard attribution.
                .header("X-Title", "Scuttle")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new LlmException("network error talking to OpenRouter", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmException("interrupted while talking to OpenRouter", e);
        }

        int status = response.statusCode();
        if (status != 200) {
            Log.warn(MODULE, "non-200 from OpenRouter",
                    "status", status, "attempt", attempt, "body", truncate(response.body(), 400));
            throw new LlmException("OpenRouter returned HTTP " + status);
        }

        return parse(response.body());
    }

    private JsonObject buildRequest(String model, List<ChatMessage> messages,
                                    JsonArray tools, int maxTokens) {
        JsonObject root = new JsonObject();
        root.addProperty("model", model);

        // OpenRouter's own failover: if `model` is down or rate-limited it walks
        // this list rather than erroring.
        if (config.modelFallbacks != null && !config.modelFallbacks.isEmpty()) {
            JsonArray models = new JsonArray();
            models.add(model);
            for (String fallback : config.modelFallbacks) {
                if (!fallback.equals(model)) models.add(fallback);
            }
            root.add("models", models);
        }

        root.addProperty("max_tokens", maxTokens);

        // Nearly every current model turns reasoning on unless told not to, and
        // Scuttle has nothing to reason about — it looks a thing up and says one
        // sentence. Left on, the thinking tokens come out of max_tokens as well as
        // the clock, which truncates replies mid-word on the chattier models.
        //
        // "effort: low" rather than "enabled: false": some endpoints (Gemini Flash,
        // Grok) make reasoning mandatory and reject the latter outright with a 400.
        // Low effort is accepted everywhere and measures 0 reasoning tokens on both.
        if (!config.reasoning) {
            JsonObject reasoning = new JsonObject();
            reasoning.addProperty("effort", "low");
            root.add("reasoning", reasoning);
        }

        JsonArray msgs = new JsonArray();
        for (ChatMessage m : messages) {
            msgs.add(serialize(m));
        }
        root.add("messages", msgs);

        if (tools != null && !tools.isEmpty()) {
            root.add("tools", tools);
        }

        // Ask OpenRouter to report what the call actually cost, so the budget
        // tracker works off real numbers instead of a token-price table we'd
        // have to keep in sync.
        JsonObject usage = new JsonObject();
        usage.addProperty("include", true);
        root.add("usage", usage);

        return root;
    }

    private JsonObject serialize(ChatMessage m) {
        JsonObject o = new JsonObject();
        o.addProperty("role", m.role());

        String content = m.content() == null ? "" : m.content();
        if (m.cacheable() && config.promptCaching) {
            o.add("content", cacheableContent(content));
        } else {
            o.addProperty("content", content);
        }

        if (m.toolCallId() != null) {
            o.addProperty("tool_call_id", m.toolCallId());
        }
        if (m.hasToolCalls()) {
            JsonArray calls = new JsonArray();
            for (ToolCall call : m.toolCalls()) {
                JsonObject fn = new JsonObject();
                fn.addProperty("name", call.name());
                fn.addProperty("arguments", gson.toJson(call.arguments()));

                JsonObject c = new JsonObject();
                c.addProperty("id", call.id());
                c.addProperty("type", "function");
                c.add("function", fn);
                calls.add(c);
            }
            o.add("tool_calls", calls);
        }
        return o;
    }

    /**
     * A cache breakpoint has to hang off a content *block*, so a marked message
     * stops being a plain string. Everything ahead of the breakpoint gets cached
     * too — and tool schemas sit ahead of the system prompt — so this one mark
     * on the persona covers the whole static half of the request.
     *
     * <p>Measured on 2026-08-15: 1,655 of 1,822 prompt tokens cached, prompt cost
     * $0.00364 -> $0.00067 on a hit, +23% on the write that seeds it.
     */
    private static JsonArray cacheableContent(String text) {
        JsonObject ephemeral = new JsonObject();
        ephemeral.addProperty("type", "ephemeral");

        JsonObject block = new JsonObject();
        block.addProperty("type", "text");
        block.addProperty("text", text);
        block.add("cache_control", ephemeral);

        JsonArray content = new JsonArray();
        content.add(block);
        return content;
    }

    private LlmReply parse(String rawBody) throws LlmException {
        JsonObject root;
        try {
            root = JsonParser.parseString(rawBody).getAsJsonObject();
        } catch (JsonSyntaxException | IllegalStateException e) {
            throw new LlmException("could not parse OpenRouter response", e);
        }

        if (root.has("error") && !root.get("error").isJsonNull()) {
            throw new LlmException("OpenRouter error: " + truncate(root.get("error").toString(), 300));
        }

        JsonArray choices = root.getAsJsonArray("choices");
        if (choices == null || choices.isEmpty()) {
            throw new LlmException("OpenRouter returned no choices");
        }

        JsonObject message = choices.get(0).getAsJsonObject().getAsJsonObject("message");
        String text = optString(message, "content");
        List<ToolCall> calls = parseToolCalls(message);

        String servedBy = optString(root, "model");
        int promptTokens = 0;
        int completionTokens = 0;
        double cost = 0.0;
        int cachedTokens = 0;
        int cacheWriteTokens = 0;
        JsonObject usage = root.getAsJsonObject("usage");
        if (usage != null) {
            promptTokens = optInt(usage, "prompt_tokens");
            completionTokens = optInt(usage, "completion_tokens");
            cost = optDouble(usage, "cost");
            JsonObject details = usage.getAsJsonObject("prompt_tokens_details");
            if (details != null) {
                cachedTokens = optInt(details, "cached_tokens");
                cacheWriteTokens = optInt(details, "cache_write_tokens");
            }
        }

        return new LlmReply(text == null ? "" : text, calls, servedBy,
                promptTokens, completionTokens, cost, cachedTokens, cacheWriteTokens);
    }

    private List<ToolCall> parseToolCalls(JsonObject message) {
        JsonArray raw = message.getAsJsonArray("tool_calls");
        if (raw == null || raw.isEmpty()) return List.of();

        List<ToolCall> calls = new java.util.ArrayList<>(raw.size());
        for (JsonElement el : raw) {
            JsonObject c = el.getAsJsonObject();
            JsonObject fn = c.getAsJsonObject("function");
            if (fn == null) continue;

            String name = optString(fn, "name");
            if (name == null) continue;

            // `arguments` arrives as a JSON *string*. A model can emit malformed
            // JSON here; that's a bad tool call, not a crash.
            JsonObject args = new JsonObject();
            String argsRaw = optString(fn, "arguments");
            if (argsRaw != null && !argsRaw.isBlank()) {
                try {
                    JsonElement parsed = JsonParser.parseString(argsRaw);
                    if (parsed.isJsonObject()) args = parsed.getAsJsonObject();
                } catch (JsonSyntaxException e) {
                    Log.warn(MODULE, "model sent unparseable tool arguments",
                            "tool", name, "raw", truncate(argsRaw, 200));
                }
            }
            calls.add(new ToolCall(optString(c, "id"), name, args));
        }
        return calls;
    }

    private void backoff(int attempt) {
        long millis = Math.min(4000L, 400L * (1L << (attempt - 1)));
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String optString(JsonObject o, String key) {
        JsonElement el = o == null ? null : o.get(key);
        return el == null || el.isJsonNull() ? null : el.getAsString();
    }

    private static int optInt(JsonObject o, String key) {
        JsonElement el = o == null ? null : o.get(key);
        return el == null || el.isJsonNull() ? 0 : el.getAsInt();
    }

    private static double optDouble(JsonObject o, String key) {
        JsonElement el = o == null ? null : o.get(key);
        return el == null || el.isJsonNull() ? 0.0 : el.getAsDouble();
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }
}
