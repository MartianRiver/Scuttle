package com.martianriver.scuttle.tools.impl;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.martianriver.scuttle.tools.Tool;

/**
 * Reading model-supplied arguments, and building the schemas that describe
 * them. Arguments are untrusted: the model can send the wrong type, a missing
 * key, or nothing at all, and none of that should reach a tool body.
 */
final class ToolArgs {

    private ToolArgs() {
    }

    static String string(JsonObject args, String key) throws Tool.ToolException {
        JsonElement el = args == null ? null : args.get(key);
        if (el == null || el.isJsonNull() || !el.isJsonPrimitive()) {
            throw new Tool.ToolException("missing '" + key + "'");
        }
        String value = el.getAsString().trim();
        if (value.isEmpty()) throw new Tool.ToolException("'" + key + "' was empty");
        return value;
    }

    /** Models send counts as "10" as often as 10, so both are accepted. */
    static int count(JsonObject args, String key) throws Tool.ToolException {
        JsonElement el = args == null ? null : args.get(key);
        if (el == null || el.isJsonNull() || !el.isJsonPrimitive()) {
            throw new Tool.ToolException("missing '" + key + "'");
        }
        try {
            return Integer.parseInt(el.getAsString().trim());
        } catch (NumberFormatException e) {
            throw new Tool.ToolException("'" + key + "' has to be a whole number");
        }
    }

    /** Null when the model left it out, which for an optional argument is fine. */
    static String optionalString(JsonObject args, String key) {
        JsonElement el = args == null ? null : args.get(key);
        if (el == null || el.isJsonNull() || !el.isJsonPrimitive()) return null;
        String value = el.getAsString().trim();
        return value.isEmpty() ? null : value;
    }

    /** Null rather than a default, so a tool can tell "not asked" from "asked for 0". */
    static Integer optionalInt(JsonObject args, String key) {
        JsonElement el = args == null ? null : args.get(key);
        if (el == null || el.isJsonNull() || !el.isJsonPrimitive()) return null;
        try {
            return Integer.valueOf(el.getAsString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static boolean bool(JsonObject args, String key, boolean fallback) {
        JsonElement el = args == null ? null : args.get(key);
        if (el == null || el.isJsonNull() || !el.isJsonPrimitive()) return fallback;
        try {
            return el.getAsBoolean();
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /** Builds the JSON Schema object sent in the tools array. */
    static Schema schema() {
        return new Schema();
    }

    static final class Schema {
        private final JsonObject properties = new JsonObject();
        private final JsonArray required = new JsonArray();

        Schema required(String name, String type, String description) {
            add(name, type, description);
            required.add(name);
            return this;
        }

        Schema optional(String name, String type, String description) {
            add(name, type, description);
            return this;
        }

        private void add(String name, String type, String description) {
            JsonObject prop = new JsonObject();
            prop.addProperty("type", type);
            prop.addProperty("description", description);
            properties.add(name, prop);
        }

        JsonObject build() {
            JsonObject schema = new JsonObject();
            schema.addProperty("type", "object");
            schema.add("properties", properties);
            schema.add("required", required);
            return schema;
        }
    }
}
