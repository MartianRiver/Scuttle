package com.martianriver.scuttle.llm;

import java.util.List;

/**
 * One message in an OpenAI-compatible conversation.
 *
 * @param role       system | user | assistant | tool
 * @param content    text body; null on an assistant turn that only calls tools
 * @param toolCalls  set on assistant turns that requested tools
 * @param toolCallId set on tool-result turns, matching the call being answered
 * @param cacheable  mark the end of the prompt prefix that never changes; see
 *                   {@link OpenRouterClient} for what the client does with it
 */
public record ChatMessage(String role, String content, List<ToolCall> toolCalls,
                          String toolCallId, boolean cacheable) {

    public static ChatMessage system(String content) {
        return new ChatMessage("system", content, List.of(), null, false);
    }

    /**
     * A system message the provider should cache. Only the first one matters —
     * everything before it in the request is cached along with it, so this marks
     * a boundary rather than a single block.
     */
    public static ChatMessage systemCached(String content) {
        return new ChatMessage("system", content, List.of(), null, true);
    }

    public static ChatMessage user(String content) {
        return new ChatMessage("user", content, List.of(), null, false);
    }

    public static ChatMessage assistant(String content) {
        return new ChatMessage("assistant", content, List.of(), null, false);
    }

    public static ChatMessage assistantToolCalls(String content, List<ToolCall> calls) {
        return new ChatMessage("assistant", content, calls, null, false);
    }

    public static ChatMessage toolResult(String toolCallId, String content) {
        return new ChatMessage("tool", content, List.of(), toolCallId, false);
    }

    public boolean hasToolCalls() {
        return toolCalls != null && !toolCalls.isEmpty();
    }
}
