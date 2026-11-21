package com.martianriver.scuttle.llm;

import java.util.List;

/**
 * One response from the model.
 *
 * @param text      assistant text; may be blank when the turn is only tool calls
 * @param toolCalls tools the model wants run before it can answer
 * @param model     which model actually served this (differs from the requested
 *                  one when OpenRouter failed over)
 * @param costUsd   what OpenRouter charged, or 0 if it didn't report a cost
 * @param cachedTokens      prompt tokens served from cache, billed at ~10%
 * @param cacheWriteTokens  prompt tokens written into the cache, billed at ~125%
 */
public record LlmReply(String text,
                       List<ToolCall> toolCalls,
                       String model,
                       int promptTokens,
                       int completionTokens,
                       double costUsd,
                       int cachedTokens,
                       int cacheWriteTokens) {

    public boolean wantsTools() {
        return toolCalls != null && !toolCalls.isEmpty();
    }
}
