package com.martianriver.scuttle.llm;

import com.google.gson.JsonObject;

/**
 * A tool the model asked for. {@code arguments} is whatever JSON the model
 * produced — it is model-supplied and untrusted, so nothing here is validated.
 * Validation happens in the safety layer before execution.
 */
public record ToolCall(String id, String name, JsonObject arguments) {
}
